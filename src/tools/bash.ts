/**
 * bash tool — execute shell commands with safety guards.
 *
 * Features:
 *   - Workspace-bound execution (workdir restricted)
 *   - Approval required (via context.approver)
 *   - Dangerous command detection (warns but doesn't block)
 *   - Timeout (default 120s)
 *   - Output truncation (50KB stdout + stderr combined)
 *   - Structured result (stdout, stderr, exitCode, killed)
 */

import { exec, type ExecException } from 'node:child_process';
import { resolve, normalize, isAbsolute } from 'node:path';
import type { Tool, ToolContext } from './types.js';

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Maximum combined output (stdout + stderr) in bytes before truncation. */
const MAX_OUTPUT = 50_000; // 50 KB

/** Default command timeout in milliseconds. */
const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes

/** Hard cap on timeout to prevent abuse. */
const MAX_TIMEOUT_MS = 300_000; // 5 minutes

// ─── Dangerous Command Patterns ────────────────────────────────────────────────

/**
 * Patterns that trigger an escalated warning.
 * These don't block execution — they just make the approval prompt louder.
 */
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f?\s*)+/i, label: 'destructive remove (rm -rf)' },
  { pattern: />\s*\/dev\/(sd|nvme|disk|md)/i, label: 'writing to block device' },
  { pattern: /\bmkfs\./, label: 'filesystem formatting' },
  { pattern: /\bdd\s+if=/, label: 'disk imaging (dd)' },
  { pattern: /:\(\)\s*\{/, label: 'fork bomb' },
  { pattern: /\bchmod\s+(-R\s+)?777\b/i, label: 'world-writable chmod' },
  { pattern: /\bsudo\b/i, label: 'privilege escalation (sudo)' },
  { pattern: /\bgit\s+push\s+.*(--force|--force-with-lease)/i, label: 'force push' },
  { pattern: /\b(shutdown|reboot|halt|poweroff)\b/i, label: 'system power control' },
  { pattern: /\b(curl|wget)\b.*\|\s*(ba)?sh/i, label: 'curl-pipe-shell (RCE risk)' },
];

/** Check a command string for dangerous patterns. */
function scanDangerous(command: string): string[] {
  const hits: string[] = [];
  for (const { pattern, label } of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      hits.push(label);
    }
  }
  return hits;
}

// ─── Path Validation ───────────────────────────────────────────────────────────

/** Resolve and validate a workdir — must stay inside workspaceRoot. */
function resolveWorkdir(workdir: string | undefined, workspaceRoot: string): string {
  const root = resolve(workspaceRoot);
  const target = workdir ? resolve(root, workdir) : root;
  const normalized = normalize(target);

  // Must be under workspace root
  if (!normalized.startsWith(root + '/') && normalized !== root) {
    throw new Error(
      `Path traversal detected: "${workdir}" resolves outside workspace "${root}"`,
    );
  }

  return normalized;
}

// ─── Execution ──────────────────────────────────────────────────────────────────

interface BashResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  /** True if killed by timeout. */
  killed: boolean;
  /** Approximate wall-clock duration in ms. */
  durationMs: number;
  /** Warning messages (e.g. dangerous patterns detected). */
  warnings: string[];
}

function runCommand(command: string, cwd: string, timeoutMs: number): Promise<BashResult> {
  const start = Date.now();

  return new Promise((resolve) => {
    const child = exec(
      command,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT * 2, // per-stream buffer before Node throws
        shell: '/bin/bash',
        env: { ...process.env, HOME: process.env.HOME || '/root' },
      },
      (error: ExecException | null, stdout: string, stderr: string) => {
        const durationMs = Date.now() - start;
        const killed = error?.killed ?? false;
        const exitCode = error ? (error.code ?? 1) : 0;

        // Truncate output
        const combined = stdout + stderr;
        if (combined.length > MAX_OUTPUT) {
          const half = Math.floor(MAX_OUTPUT / 2);
          const truncStdout = stdout.length > half ? stdout.slice(0, half) : stdout;
          const truncStderr =
            stderr.length > MAX_OUTPUT - truncStdout.length
              ? stderr.slice(0, MAX_OUTPUT - truncStdout.length)
              : stderr;
          resolve({
            success: false,
            stdout: truncStdout,
            stderr: truncStderr + `\n[output truncated at ${MAX_OUTPUT} bytes]`,
            exitCode: killed ? null : exitCode,
            killed,
            durationMs,
            warnings: [],
          });
          return;
        }

        resolve({
          success: exitCode === 0 && !killed,
          stdout,
          stderr: stderr || '',
          exitCode: killed ? null : exitCode,
          killed,
          durationMs,
          warnings: [],
        });
      },
    );
  });
}

// ─── Tool Definition ───────────────────────────────────────────────────────────

export const bashTool: Tool = {
  name: 'bash',
  description:
    'Execute a shell command in the workspace. ' +
    'Returns stdout, stderr, and exit code. ' +
    'Command runs with a 120-second timeout. ' +
    'Output is truncated at 50KB. ' +
    'Always use this for file operations, builds, tests, git, and package management. ' +
    'Avoid running long-lived servers or interactive programs.',

  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute (e.g., "ls -la", "npm test").',
      },
      workdir: {
        type: 'string',
        description:
          'Optional working directory relative to workspace root. Defaults to workspace root.',
      },
      timeout: {
        type: 'number',
        description: `Optional timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS}, max: ${MAX_TIMEOUT_MS}).`,
      },
    },
    required: ['command'],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const command = String(args.command ?? '').trim();
    const workdir = args.workdir ? String(args.workdir) : undefined;
    const timeout = typeof args.timeout === 'number' ? args.timeout : DEFAULT_TIMEOUT_MS;

    // ── Validate ──────────────────────────────────────────────────────────
    if (!command) {
      return JSON.stringify({
        success: false,
        error: 'command is required and cannot be empty',
      });
    }

    // Validate timeout
    const effectiveTimeout = Math.min(Math.max(1000, timeout), MAX_TIMEOUT_MS);
    if (timeout < 1000 || timeout > MAX_TIMEOUT_MS) {
      // clamped silently, but note in warnings
    }

    let cwd: string;
    try {
      cwd = resolveWorkdir(workdir, context.workspaceRoot);
    } catch (e: any) {
      return JSON.stringify({ success: false, error: e.message });
    }

    // ── Scan for danger ───────────────────────────────────────────────────
    const dangerousHits = scanDangerous(command);

    // ── Approval ──────────────────────────────────────────────────────────
    if (context.approver) {
      const approved = await context.approver('bash', {
        command,
        workdir,
        timeout: effectiveTimeout,
        dangerous: dangerousHits.length > 0 ? dangerousHits : undefined,
      });
      if (!approved) {
        return JSON.stringify({ success: false, error: 'User denied command execution.' });
      }
    }

    // ── Execute ───────────────────────────────────────────────────────────
    const result = await runCommand(command, cwd, effectiveTimeout);

    // Attach warnings
    result.warnings = [
      ...dangerousHits.map((h) => `⚠ dangerous pattern: ${h}`),
      ...(timeout !== effectiveTimeout ? [`⚠ timeout clamped from ${timeout}ms to ${effectiveTimeout}ms`] : []),
    ];

    return JSON.stringify(result);
  },
};
