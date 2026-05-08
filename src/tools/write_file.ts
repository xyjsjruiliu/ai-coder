/**
 * write_file tool — create or overwrite a file.
 *
 * Security:
 *   - Paths are sandboxed within workspaceRoot
 *   - Path traversal attempts are blocked
 *   - Destructive operation → requires approval via context.approver
 *
 * Behavior:
 *   - Creates parent directories automatically
 *   - Reports whether the file was newly created or overwritten
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Tool, ToolContext } from './types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Resolve a relative path safely within workspaceRoot. */
function resolvePath(relativePath: string, workspaceRoot: string): string {
  const resolved = path.resolve(workspaceRoot, relativePath);

  if (!resolved.startsWith(workspaceRoot + path.sep) && resolved !== workspaceRoot) {
    throw new Error(
      `Path traversal detected: "${relativePath}" escapes workspace root. ` +
      `All file access must be within the project.`,
    );
  }

  return resolved;
}

// ─── Tool Definition ───────────────────────────────────────────────────────────

export const writeFileTool: Tool = {
  name: 'write_file',
  description:
    'Write content to a file, creating it if it does not exist and overwriting if it does. ' +
    'Parent directories are created automatically. ' +
    'Use this to create new files or update existing ones.',

  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to write, relative to the project root.',
      },
      content: {
        type: 'string',
        description: 'The content to write to the file.',
      },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    // ── Validate arguments ──────────────────────────────────────────────────
    if (args.path === undefined || args.path === null || String(args.path).trim() === '') {
      return JSON.stringify({ success: false, error: 'path is required' });
    }
    if (args.content === undefined || args.content === null) {
      return JSON.stringify({ success: false, error: 'content is required' });
    }

    const filePath = String(args.path);
    const content = String(args.content);

    // ── Resolve & sandbox ───────────────────────────────────────────────────
    let resolved: string;
    try {
      resolved = resolvePath(filePath, context.workspaceRoot);
    } catch (err: any) {
      return JSON.stringify({ success: false, error: err.message });
    }

    // ── Approval ────────────────────────────────────────────────────────────
    if (context.approver) {
      const approved = await context.approver('write_file', { path: filePath, content });
      if (!approved) {
        return JSON.stringify({ success: false, error: 'User denied write_file approval.' });
      }
    }

    // ── Check if file exists (for overwrite detection) ─────────────────────
    let existed = false;
    try {
      await fs.stat(resolved);
      existed = true;
    } catch {
      // File doesn't exist — that's fine
    }

    // ── Create parent directories ───────────────────────────────────────────
    try {
      await fs.mkdir(path.dirname(resolved), { recursive: true });
    } catch (err: any) {
      return JSON.stringify({
        success: false,
        error: `Failed to create parent directory for "${filePath}": ${err.message}`,
      });
    }

    // ── Write ───────────────────────────────────────────────────────────────
    try {
      await fs.writeFile(resolved, content, 'utf-8');
      const bytesWritten = Buffer.byteLength(content, 'utf-8');

      return JSON.stringify({
        success: true,
        path: filePath,
        bytesWritten,
        overwritten: existed,
      });
    } catch (err: any) {
      return JSON.stringify({
        success: false,
        error: `Failed to write "${filePath}": ${err.message}`,
      });
    }
  },
};
