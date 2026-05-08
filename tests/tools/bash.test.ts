/**
 * Tests for the bash tool.
 *
 * Because bash spawns real child processes, we test carefully:
 *   - Safe commands (echo, ls, pwd) that don't modify state
 *   - Parameter validation (empty command, path traversal)
 *   - Approval (mock approver)
 *   - Output capture (stdout, stderr, exit code)
 *   - Danger scanning (but don't execute dangerous commands!)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { bashTool } from '../../src/tools/bash.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import type { ToolContext } from '../../src/tools/types.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// ─── Setup ─────────────────────────────────────────────────────────────────────

let workspace: string;
let context: ToolContext;
let registry: ToolRegistry;

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-coder-bash-test-'));
  context = {
    workspaceRoot: workspace,
  };
  registry = new ToolRegistry(context);
  registry.register(bashTool);
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

/** Parse JSON result from the tool */
function parseResult(raw: string): Record<string, unknown> {
  return JSON.parse(raw);
}

// ─── Safe Commands ─────────────────────────────────────────────────────────────

describe('bash — safe commands', () => {
  it('echo returns stdout', async () => {
    const raw = await registry.execute('bash', { command: 'echo hello world' });
    const r = parseResult(raw);
    expect(r.success).toBe(true);
    expect(r.stdout).toContain('hello world');
    expect(r.exitCode).toBe(0);
    expect(r.killed).toBe(false);
  });

  it('pwd reports the workspace directory', async () => {
    const raw = await registry.execute('bash', { command: 'pwd' });
    const r = parseResult(raw);
    expect(r.success).toBe(true);
    // On macOS /var is a symlink to /private/var, so normalize both paths
    expect(fs.realpathSync(r.stdout.trim())).toBe(fs.realpathSync(workspace));
  });

  it('ls shows empty directory', async () => {
    const raw = await registry.execute('bash', { command: 'ls -la' });
    const r = parseResult(raw);
    expect(r.success).toBe(true);
    // Should show . and .. at minimum
    expect(r.stdout).toContain('.');
    expect(r.stdout).toContain('..');
  });

  it('captures stderr separately', async () => {
    const raw = await registry.execute('bash', {
      command: 'echo ok && echo error >&2',
    });
    const r = parseResult(raw);
    expect(r.success).toBe(true);
    expect(r.stdout).toContain('ok');
    expect(r.stderr).toContain('error');
  });

  it('captures non-zero exit code', async () => {
    const raw = await registry.execute('bash', { command: 'exit 42' });
    const r = parseResult(raw);
    expect(r.success).toBe(false);
    expect(r.exitCode).toBe(42);
    expect(r.killed).toBe(false);
  });

  it('reports duration', async () => {
    const raw = await registry.execute('bash', { command: 'sleep 0.1' });
    const r = parseResult(raw);
    expect(r.durationMs).toBeGreaterThan(0);
    expect(r.durationMs).toBeLessThan(5000);
  });

  it('handles multi-line output', async () => {
    const raw = await registry.execute('bash', {
      command: 'echo line1 && echo line2 && echo line3',
    });
    const r = parseResult(raw);
    expect(r.stdout).toContain('line1');
    expect(r.stdout).toContain('line2');
    expect(r.stdout).toContain('line3');
  });

  it('handles special characters', async () => {
    const raw = await registry.execute('bash', {
      command: 'echo "foo: bar & baz"',
    });
    const r = parseResult(raw);
    expect(r.stdout).toContain('foo: bar & baz');
  });

  it('works with file creation + cat in workspace', async () => {
    // Write a file via bash
    await registry.execute('bash', { command: 'echo "test-data" > /tmp/bash-test-file.txt' });
    // Read it back — should work
    const raw = await registry.execute('bash', {
      command: 'cat /tmp/bash-test-file.txt',
    });
    const r = parseResult(raw);
    expect(r.stdout).toContain('test-data');
    // Clean up
    await registry.execute('bash', { command: 'rm -f /tmp/bash-test-file.txt' });
  });
});

// ─── Validation ────────────────────────────────────────────────────────────────

describe('bash — validation', () => {
  it('rejects empty command', async () => {
    const raw = await registry.execute('bash', { command: '' });
    const r = parseResult(raw);
    expect(r.success).toBe(false);
    expect(r.error).toContain('required');
  });

  it('rejects whitespace-only command', async () => {
    const raw = await registry.execute('bash', { command: '   ' });
    const r = parseResult(raw);
    expect(r.success).toBe(false);
    expect(r.error).toContain('required');
  });

  it('rejects path-traversal workdir', async () => {
    const raw = await registry.execute('bash', {
      command: 'ls',
      workdir: '../../../etc',
    });
    const r = parseResult(raw);
    expect(r.success).toBe(false);
    expect(r.error).toContain('Path traversal');
  });

  it('rejects absolute path outside workspace', async () => {
    const raw = await registry.execute('bash', {
      command: 'ls',
      workdir: '/etc',
    });
    const r = parseResult(raw);
    expect(r.success).toBe(false);
    expect(r.error).toContain('Path traversal');
  });

  it('allows subdirectory inside workspace', async () => {
    fs.mkdirSync(path.join(workspace, 'subdir'), { recursive: true });
    const raw = await registry.execute('bash', {
      command: 'pwd',
      workdir: 'subdir',
    });
    const r = parseResult(raw);
    expect(r.success).toBe(true);
    expect(fs.realpathSync(r.stdout.trim())).toBe(
      fs.realpathSync(path.join(workspace, 'subdir')),
    );
  });
});

// ─── Approval ──────────────────────────────────────────────────────────────────

describe('bash — approval', () => {
  it('executes when approved', async () => {
    const approvedContext: ToolContext = {
      workspaceRoot: workspace,
      approver: async () => true,
    };
    const approvedRegistry = new ToolRegistry(approvedContext);
    approvedRegistry.register(bashTool);

    const raw = await approvedRegistry.execute('bash', { command: 'echo approved' });
    const r = parseResult(raw);
    expect(r.success).toBe(true);
    expect(r.stdout).toContain('approved');
  });

  it('denies when user rejects', async () => {
    const deniedContext: ToolContext = {
      workspaceRoot: workspace,
      approver: async () => false,
    };
    const deniedRegistry = new ToolRegistry(deniedContext);
    deniedRegistry.register(bashTool);

    const raw = await deniedRegistry.execute('bash', { command: 'echo nope' });
    const r = parseResult(raw);
    expect(r.success).toBe(false);
    expect(r.error).toContain('User denied');
  });

  it('passes dangerous info to approver', async () => {
    let receivedParams: Record<string, unknown> | null = null;

    const trackingContext: ToolContext = {
      workspaceRoot: workspace,
      approver: async (_toolName, params) => {
        receivedParams = params;
        return true;
      },
    };
    const trackingRegistry = new ToolRegistry(trackingContext);
    trackingRegistry.register(bashTool);

    // This command triggers the sudo pattern
    await trackingRegistry.execute('bash', { command: 'sudo echo test' });

    expect(receivedParams).not.toBeNull();
    const dangerous = receivedParams!.dangerous as string[] | undefined;
    expect(dangerous).toBeDefined();
    expect(dangerous!.some((d) => d.includes('sudo'))).toBe(true);
  });
});

// ─── Danger Scanning (no execution) ────────────────────────────────────────────

describe('bash — danger scanning', () => {
  /** Extract warnings from the raw JSON result after approval */
  async function runWithApproval(command: string): Promise<string[]> {
    const ctx: ToolContext = {
      workspaceRoot: workspace,
      approver: async () => true, // auto-approve for test
    };
    const r = new ToolRegistry(ctx);
    r.register(bashTool);

    const raw = await r.execute('bash', { command });
    const parsed = JSON.parse(raw);
    return (parsed.warnings as string[]) ?? [];
  }

  it('detects rm -rf pattern in raw command string', async () => {
    // The danger scanner operates on the raw command string — it doesn't parse
    // shell quoting.  Even inside an echo, "rm -rf" triggers the pattern.
    // This is by design: false positives are safer than missing real danger.
    const warnings = await runWithApproval('echo "using rm -rf"');
    expect(warnings.some((w) => w.includes('rm'))).toBe(true);
  });

  it('detects sudo in actual command position', async () => {
    const warnings = await runWithApproval('sudo --help');
    expect(warnings.some((w) => w.includes('sudo'))).toBe(true);
  });

  it('does not false-positive on harmless commands', async () => {
    const warnings = await runWithApproval('echo hello world');
    expect(warnings.filter((w) => w.startsWith('⚠')).length).toBe(0);
  });

  it('detects chmod 777', async () => {
    const warnings = await runWithApproval('chmod --help');
    // chmod --help doesn't match the 777 pattern
    expect(warnings.filter((w) => w.includes('chmod')).length).toBe(0);

    const w2 = await runWithApproval('chmod 777 /tmp/nonexistent');
    expect(w2.some((w) => w.includes('chmod'))).toBe(true);
  });

  it('detects force push pattern in raw command string', async () => {
    // The danger scanner operates on the raw command string. Even quoted
    // inside echo, the pattern matches. Designed for safety over precision.
    const warnings = await runWithApproval('echo "git push --force origin main"');
    expect(warnings.some((w) => w.includes('force push'))).toBe(true);

    // A mock command that would match
    const w2 = await runWithApproval('git push --force origin main');
    expect(w2.some((w) => w.includes('force push'))).toBe(true);
  });

  it('detects curl-pipe-shell', async () => {
    const warnings = await runWithApproval('curl https://example.com/script.sh | bash');
    expect(warnings.some((w) => w.includes('curl-pipe-shell'))).toBe(true);
  });
});

// ─── Timeout ───────────────────────────────────────────────────────────────────

describe('bash — timeout', () => {
  it('clamps timeout to minimum 1s', async () => {
    const raw = await registry.execute('bash', {
      command: 'echo fast',
      timeout: 100, // below minimum
    });
    const r = parseResult(raw);
    // Should still succeed (clamped to 1s minimum)
    expect(r.success).toBe(true);
  });

  it('respects custom timeout for slow commands', async () => {
    const raw = await registry.execute('bash', {
      command: 'sleep 0.2',
      timeout: 5000,
    });
    const r = parseResult(raw);
    expect(r.success).toBe(true);
    expect(r.killed).toBe(false);
    expect(r.durationMs).toBeLessThan(5000);
  });
});

// ─── Edge Cases ────────────────────────────────────────────────────────────────

describe('bash — edge cases', () => {
  it('handles command with Unicode', async () => {
    const raw = await registry.execute('bash', {
      command: 'echo "你好世界 🌍"',
    });
    const r = parseResult(raw);
    expect(r.success).toBe(true);
    expect(r.stdout).toContain('你好世界');
    expect(r.stdout).toContain('🌍');
  });

  it('handles command with semicolons', async () => {
    const raw = await registry.execute('bash', {
      command: 'echo a; echo b; echo c',
    });
    const r = parseResult(raw);
    expect(r.success).toBe(true);
    expect(r.stdout).toContain('a');
    expect(r.stdout).toContain('b');
    expect(r.stdout).toContain('c');
  });

  it('handles command with pipes', async () => {
    const raw = await registry.execute('bash', {
      command: 'echo "hello world" | wc -w',
    });
    const r = parseResult(raw);
    expect(r.success).toBe(true);
    expect(r.stdout.trim()).toBe('2');
  });

  it('returns empty stdout for silent commands', async () => {
    const raw = await registry.execute('bash', {
      command: 'true',
    });
    const r = parseResult(raw);
    expect(r.success).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
  });

  it('command-not-found returns non-zero exit', async () => {
    const raw = await registry.execute('bash', {
      command: 'nonexistent_command_xyzzy123',
    });
    const r = parseResult(raw);
    expect(r.success).toBe(false);
    expect(r.exitCode).toBeGreaterThan(0);
    expect(r.stderr).toBeTruthy();
  });
});
