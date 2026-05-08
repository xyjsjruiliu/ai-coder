/**
 * read_file tool — read a file (or portion) and return its contents.
 *
 * Security:
 *   - All paths are sandboxed within workspaceRoot
 *   - Path traversal (../) attempts are blocked
 *   - Binary files are detected and rejected
 *
 * Pagination:
 *   - offset: 1-indexed line number to start from (default 1)
 *   - limit: max lines to return (default 500, max 2000)
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Tool, ToolContext } from './types.js';

// ─── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;
const BINARY_CHECK_BYTES = 4096;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Resolve a relative path safely within workspaceRoot. */
function resolvePath(relativePath: string, workspaceRoot: string): string {
  const resolved = path.resolve(workspaceRoot, relativePath);

  // Must stay within workspaceRoot
  if (!resolved.startsWith(workspaceRoot + path.sep) && resolved !== workspaceRoot) {
    throw new Error(
      `Path traversal detected: "${relativePath}" escapes workspace root. ` +
      `All file access must be within the project.`,
    );
  }

  return resolved;
}

/** Check if a file is binary by scanning for null bytes in the first chunk. */
async function isBinaryFile(filePath: string): Promise<boolean> {
  const fd = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(BINARY_CHECK_BYTES);
    const { bytesRead } = await fd.read(buffer, 0, BINARY_CHECK_BYTES, 0);
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) return true;
    }
    return false;
  } finally {
    await fd.close();
  }
}

// ─── Tool Definition ───────────────────────────────────────────────────────────

export const readFileTool: Tool = {
  name: 'read_file',
  description:
    'Read a file from the project. ' +
    'Use offset and limit to paginate through long files. ' +
    'Returns the file content with line numbers.',

  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to read, relative to the project root.',
      },
      offset: {
        type: 'integer',
        description: 'Line number to start reading from (1-indexed, default: 1).',
        default: 1,
      },
      limit: {
        type: 'integer',
        description: `Maximum number of lines to return (default: ${DEFAULT_LIMIT}, max: ${MAX_LIMIT}).`,
        default: DEFAULT_LIMIT,
      },
    },
    required: ['path'],
    additionalProperties: false,
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const offset = typeof args.offset === 'number' ? args.offset : 1;
    const limit = typeof args.limit === 'number' ? args.limit : DEFAULT_LIMIT;

    // ── Validate arguments ──────────────────────────────────────────────────
    if (args.path === undefined || args.path === null || String(args.path).trim() === '') {
      return JSON.stringify({ success: false, error: 'path is required' });
    }

    const filePath = String(args.path);
    const clampedLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
    const clampedOffset = Math.max(1, offset);

    // ── Resolve & sandbox ───────────────────────────────────────────────────
    let resolved: string;
    try {
      resolved = resolvePath(filePath, context.workspaceRoot);
    } catch (err: any) {
      return JSON.stringify({ success: false, error: err.message });
    }

    // ── Stat + existence ────────────────────────────────────────────────────
    try {
      const stat = await fs.stat(resolved);

      if (stat.isDirectory()) {
        return JSON.stringify({
          success: false,
          error: `"${filePath}" is a directory, not a file. Use a file path instead.`,
        });
      }

      if (stat.size === 0) {
        return JSON.stringify({
          success: true,
          path: filePath,
          content: '',
          totalLines: 0,
          offset: clampedOffset,
          limit: clampedLimit,
          size: 0,
        });
      }

      // Binary check (skip for very small files)
      if (stat.size > 0) {
        const binary = await isBinaryFile(resolved);
        if (binary) {
          return JSON.stringify({
            success: false,
            error: `"${filePath}" appears to be a binary file (contains null bytes). Cannot display.`,
          });
        }
      }
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return JSON.stringify({
          success: false,
          error: `File not found: "${filePath}"`,
        });
      }
      return JSON.stringify({
        success: false,
        error: `Cannot access "${filePath}": ${err.message}`,
      });
    }

    // ── Read ─────────────────────────────────────────────────────────────────
    try {
      const raw = await fs.readFile(resolved, 'utf-8');
      const allLines = raw.split('\n');

      // Remove trailing empty string from split if file ends with \n
      if (allLines.length > 0 && allLines[allLines.length - 1] === '' && raw.endsWith('\n')) {
        allLines.pop();
      }

      const totalLines = allLines.length;

      // Clamp offset to valid range
      const effectiveOffset = Math.min(clampedOffset, totalLines > 0 ? totalLines : 1);

      // Slice the requested range
      const startIdx = effectiveOffset - 1;
      const endIdx = Math.min(startIdx + clampedLimit, totalLines);
      const selectedLines = allLines.slice(startIdx, endIdx);

      // Format with line numbers
      const content = selectedLines
        .map((line, i) => `${effectiveOffset + i}|${line}`)
        .join('\n');

      return JSON.stringify({
        success: true,
        path: filePath,
        content,
        totalLines,
        offset: effectiveOffset,
        limit: clampedLimit,
        linesReturned: selectedLines.length,
      });
    } catch (err: any) {
      return JSON.stringify({
        success: false,
        error: `Failed to read "${filePath}": ${err.message}`,
      });
    }
  },
};
