/**
 * WorkspaceTrustManager — persists and queries workspace trust decisions.
 *
 * Trust data is stored in ~/.ai-coder/trusted_workspaces.json as a simple
 * JSON array of absolute paths.
 *
 * The user is prompted on first visit to a directory; subsequent visits
 * to the same (or parent) directories are auto-trusted.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── Paths ─────────────────────────────────────────────────────────────────────

const CONFIG_DIR = path.join(os.homedir(), '.ai-coder');
const TRUST_FILE = path.join(CONFIG_DIR, 'trusted_workspaces.json');

// ─── Helpers ───────────────────────────────────────────────────────────────────

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function readTrustFile(): string[] {
  try {
    if (!fs.existsSync(TRUST_FILE)) return [];
    const raw = fs.readFileSync(TRUST_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is string => typeof p === 'string');
  } catch {
    return [];
  }
}

function writeTrustFile(paths: string[]): void {
  ensureConfigDir();
  fs.writeFileSync(TRUST_FILE, JSON.stringify(paths, null, 2), 'utf-8');
}

/** Normalise a path for comparison: resolve + strip trailing slash. */
function normalize(p: string): string {
  return path.resolve(p).replace(/\/+$/, '');
}

// ─── Manager ───────────────────────────────────────────────────────────────────

export class WorkspaceTrustManager {
  private trusted: Set<string>;

  constructor() {
    this.trusted = new Set(readTrustFile().map(normalize));
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  /**
   * Check whether a workspace is trusted.
   * A workspace is trusted if it or any of its ancestor directories is in
   * the trust file.
   */
  isTrusted(workspaceRoot: string): boolean {
    const root = normalize(workspaceRoot);

    // Direct match
    if (this.trusted.has(root)) return true;

    // Ancestor match: walk up
    let current = root;
    while (true) {
      if (this.trusted.has(current)) return true;
      const parent = path.dirname(current);
      if (parent === current) break; // reached filesystem root
      current = parent;
    }

    return false;
  }

  // ── Mutations ──────────────────────────────────────────────────────────────

  /**
   * Trust a workspace and persist.
   */
  trust(workspaceRoot: string): void {
    const root = normalize(workspaceRoot);
    this.trusted.add(root);
    writeTrustFile([...this.trusted].sort());
  }

  /**
   * Remove trust for a workspace.
   */
  untrust(workspaceRoot: string): void {
    const root = normalize(workspaceRoot);
    this.trusted.delete(root);
    // Also remove child entries
    for (const t of this.trusted) {
      if (t.startsWith(root + path.sep)) {
        this.trusted.delete(t);
      }
    }
    writeTrustFile([...this.trusted].sort());
  }
}

// ─── Interactive trust prompt (runs BEFORE Ink TUI starts) ─────────────────────

/**
 * Prompt the user to trust a workspace via synchronous /dev/tty read.
 *
 * This MUST run before Ink takes over the terminal. Ink raw-mode prevents
 * any React-based keyboard handling from working for trust dialogs.
 *
 * Returns true if the user trusts the workspace, false otherwise.
 */
export function promptWorkspaceTrust(workspaceRoot: string): boolean {
  let fd = -1;
  try {
    fd = fs.openSync('/dev/tty', 'r');
  } catch {
    // No TTY available (e.g., piped input, CI) → auto-trust
    return true;
  }

  const buf = Buffer.alloc(1);

  // Print the trust prompt
  process.stderr.write('\n');
  process.stderr.write('═══════════════════════════════════════\n');
  process.stderr.write('  Trust this workspace?\n');
  process.stderr.write(`  ${workspaceRoot}\n`);
  process.stderr.write('\n');
  process.stderr.write('  AI tools can read, write, edit files,\n');
  process.stderr.write('  and execute commands in this directory.\n');
  process.stderr.write('\n');
  process.stderr.write('  [y] Yes, trust   [n] Restricted (plan)\n');
  process.stderr.write('═══════════════════════════════════════\n');
  process.stderr.write('> ');

  // Block until y/n (case-insensitive)
  while (true) {
    const bytesRead = fs.readSync(fd, buf, 0, 1, null);
    if (bytesRead === 0) {
      // EOF → don't trust
      process.stderr.write('\n');
      fs.closeSync(fd);
      return false;
    }

    const char = String.fromCharCode(buf[0]).toLowerCase();
    if (char === 'y') {
      process.stderr.write('y\n\n✅ Workspace trusted.\n\n');
      fs.closeSync(fd);
      return true;
    }
    if (char === 'n') {
      process.stderr.write('n\n\n⚠ Running in restricted (plan) mode.\n\n');
      fs.closeSync(fd);
      return false;
    }
    // Ignore other keys
  }
}
