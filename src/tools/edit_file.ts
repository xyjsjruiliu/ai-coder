/**
 * edit_file tool — find-and-replace string substitution in a file.
 *
 * This is the most complex tool. It mimics Claude Code's Edit tool behavior:
 *
 *   - old_string must be unique in the file (unless replace_all is true)
 *   - If not unique and replace_all=false → error with context showing all matches
 *   - replace_all=true → replaces all occurrences
 *   - Whitespace-sensitive: exact match required
 *   - Requires approval (destructive write operation)
 *
 * Security:
 *   - Paths sandboxed within workspaceRoot
 *   - Path traversal blocked
 *   - Binary files rejected (delegates to read_file)
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Tool, ToolContext } from './types.js';

// ─── Constants ─────────────────────────────────────────────────────────────────

const CONTEXT_LINES = 2; // lines of surrounding context when showing match locations

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolvePath(relativePath: string, workspaceRoot: string): string {
  const resolved = path.resolve(workspaceRoot, relativePath);
  if (!resolved.startsWith(workspaceRoot + path.sep) && resolved !== workspaceRoot) {
    throw new Error(
      `Path traversal detected: "${relativePath}" escapes workspace root.`,
    );
  }
  return resolved;
}

/** Check if a file is binary by scanning for null bytes. */
async function isBinaryFile(filePath: string): Promise<boolean> {
  const fd = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await fd.read(buffer, 0, 4096, 0);
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) return true;
    }
    return false;
  } finally {
    await fd.close();
  }
}

/** Find all occurrences of old_string in content. Returns start indices (0-based). */
function findAllOccurrences(content: string, oldStr: string): number[] {
  const indices: number[] = [];
  let pos = 0;
  while ((pos = content.indexOf(oldStr, pos)) !== -1) {
    indices.push(pos);
    pos += oldStr.length;
  }
  return indices;
}

/** Build a line-number-aware context snippet around a position in content. */
function positionContext(
  content: string,
  pos: number,
  matchLen: number,
): { line: number; snippet: string } {
  // Find line number by counting newlines before pos
  const before = content.slice(0, pos);
  const line = before.split('\n').length;

  // Extract surrounding lines
  const allLines = content.split('\n');
  const matchLineIdx = line - 1;
  const startIdx = Math.max(0, matchLineIdx - CONTEXT_LINES);
  const endIdx = Math.min(allLines.length, matchLineIdx + CONTEXT_LINES + 1);

  const snippet = allLines
    .slice(startIdx, endIdx)
    .map((l, i) => {
      const lineNum = startIdx + i + 1;
      const marker = lineNum === line ? '>>>' : '   ';
      return `${marker} ${String(lineNum).padStart(4)}| ${l}`;
    })
    .join('\n');

  return { line, snippet };
}

// ─── Tool Definition ───────────────────────────────────────────────────────────

export const editFileTool: Tool = {
  name: 'edit_file',
  description:
    'Edit a file by finding and replacing a string. ' +
    'The old_string must exactly match (including whitespace) and must be unique ' +
    'in the file unless replace_all is true. ' +
    'Include enough surrounding context in old_string to make it unique.',

  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to edit, relative to the project root.',
      },
      old_string: {
        type: 'string',
        description:
          'The exact text to find and replace. Must be unique in the file unless replace_all is true.',
      },
      new_string: {
        type: 'string',
        description: 'The replacement text.',
      },
      replace_all: {
        type: 'boolean',
        description: 'If true, replace all occurrences instead of just one (default: false).',
        default: false,
      },
    },
    required: ['path', 'old_string', 'new_string'],
    additionalProperties: false,
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    // ── Validate arguments ──────────────────────────────────────────────────
    if (!args.path || String(args.path).trim() === '') {
      return JSON.stringify({ success: false, error: 'path is required' });
    }
    if (args.old_string === undefined || args.old_string === null || String(args.old_string) === '') {
      return JSON.stringify({ success: false, error: 'old_string must be a non-empty string' });
    }

    const filePath = String(args.path);
    const oldStr = String(args.old_string);
    const newStr = String(args.new_string ?? '');
    const replaceAll = args.replace_all === true;

    // ── Resolve & sandbox ───────────────────────────────────────────────────
    let resolved: string;
    try {
      resolved = resolvePath(filePath, context.workspaceRoot);
    } catch (err: any) {
      return JSON.stringify({ success: false, error: err.message });
    }

    // ── Read file ───────────────────────────────────────────────────────────
    let original: string;
    try {
      const stat = await fs.stat(resolved);

      if (stat.isDirectory()) {
        return JSON.stringify({
          success: false,
          error: `"${filePath}" is a directory, not a file.`,
        });
      }

      if (stat.size > 0) {
        const binary = await isBinaryFile(resolved);
        if (binary) {
          return JSON.stringify({
            success: false,
            error: `"${filePath}" appears to be a binary file. Cannot edit.`,
          });
        }
      }

      original = await fs.readFile(resolved, 'utf-8');
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return JSON.stringify({ success: false, error: `File not found: "${filePath}"` });
      }
      return JSON.stringify({
        success: false,
        error: `Cannot read "${filePath}": ${err.message}`,
      });
    }

    // ── Find occurrences ────────────────────────────────────────────────────
    const occurrences = findAllOccurrences(original, oldStr);

    if (occurrences.length === 0) {
      return JSON.stringify({
        success: false,
        error: `old_string not found in "${filePath}". Ensure the exact text (including whitespace) matches.`,
      });
    }

    if (!replaceAll && occurrences.length > 1) {
      // Build ambiguity report
      const locations = occurrences.map((pos) => positionContext(original, pos, oldStr.length));
      const report = locations
        .map((loc) => `  Line ${loc.line}:\n${loc.snippet}`)
        .join('\n\n');

      return JSON.stringify({
        success: false,
        error:
          `old_string is not unique in "${filePath}" (found ${occurrences.length} matches). ` +
          `Add more surrounding context to make it unique, or use replace_all: true.\n\n` +
          `Matches:\n${report}`,
      });
    }

    // ── Approval ────────────────────────────────────────────────────────────
    if (context.approver) {
      const approved = await context.approver('edit_file', {
        path: filePath,
        old_string: oldStr,
        new_string: newStr,
      });
      if (!approved) {
        return JSON.stringify({ success: false, error: 'User denied edit_file approval.' });
      }
    }

    // ── Perform replacement ─────────────────────────────────────────────────
    const newContent = replaceAll
      ? original.replaceAll(oldStr, newStr)
      : original.replace(oldStr, newStr);

    // ── Write ───────────────────────────────────────────────────────────────
    try {
      await fs.writeFile(resolved, newContent, 'utf-8');
      return JSON.stringify({
        success: true,
        path: filePath,
        replaced: true,
        occurrences: replaceAll ? occurrences.length : 1,
      });
    } catch (err: any) {
      return JSON.stringify({
        success: false,
        error: `Failed to write "${filePath}": ${err.message}`,
      });
    }
  },
};
