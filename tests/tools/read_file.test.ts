/**
 * Tests for the read_file tool.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { readFileTool } from '../../src/tools/read_file.js';
import type { ToolContext } from '../../src/tools/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let workspace: string;
let ctx: ToolContext;

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-coder-test-'));
  ctx = { workspaceRoot: workspace };
});

afterEach(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

async function createFile(relPath: string, content: string): Promise<string> {
  const abs = path.join(workspace, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf-8');
  return abs;
}

function parseResult(result: string): any {
  return JSON.parse(result);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('read_file', () => {
  // ── Basic reads ──────────────────────────────────────────────────────────

  it('should read a simple text file', async () => {
    await createFile('hello.txt', 'Hello, world!\n');
    const result = parseResult(await readFileTool.execute({ path: 'hello.txt' }, ctx));

    expect(result.success).toBe(true);
    expect(result.path).toBe('hello.txt');
    expect(result.content).toContain('Hello, world!');
    expect(result.totalLines).toBe(1);
  });

  it('should return line numbers', async () => {
    await createFile('nums.txt', 'line one\nline two\nline three\n');
    const result = parseResult(await readFileTool.execute({ path: 'nums.txt' }, ctx));

    expect(result.content).toBe(
      '1|line one\n2|line two\n3|line three',
    );
    expect(result.totalLines).toBe(3);
  });

  // ── Empty files ──────────────────────────────────────────────────────────

  it('should handle empty files', async () => {
    await createFile('empty.txt', '');
    const result = parseResult(await readFileTool.execute({ path: 'empty.txt' }, ctx));

    expect(result.success).toBe(true);
    expect(result.content).toBe('');
    expect(result.totalLines).toBe(0);
    expect(result.size).toBe(0);
  });

  it('should handle files with only newlines', async () => {
    await createFile('blanks.txt', '\n\n\n');
    const result = parseResult(await readFileTool.execute({ path: 'blanks.txt' }, ctx));

    expect(result.success).toBe(true);
    expect(result.totalLines).toBe(3);
  });

  // ── Offset / limit ───────────────────────────────────────────────────────

  it('should respect offset', async () => {
    await createFile('long.txt', 'A\nB\nC\nD\nE\n');
    const result = parseResult(await readFileTool.execute(
      { path: 'long.txt', offset: 3 },
      ctx,
    ));

    expect(result.content).toBe('3|C\n4|D\n5|E');
    expect(result.offset).toBe(3);
  });

  it('should respect limit', async () => {
    await createFile('long.txt', 'A\nB\nC\nD\nE\n');
    const result = parseResult(await readFileTool.execute(
      { path: 'long.txt', limit: 2 },
      ctx,
    ));

    expect(result.content).toBe('1|A\n2|B');
    expect(result.limit).toBe(2);
    expect(result.linesReturned).toBe(2);
  });

  it('should combine offset and limit', async () => {
    await createFile('long.txt', 'A\nB\nC\nD\nE\nF\n');
    const result = parseResult(await readFileTool.execute(
      { path: 'long.txt', offset: 2, limit: 3 },
      ctx,
    ));

    expect(result.content).toBe('2|B\n3|C\n4|D');
    expect(result.offset).toBe(2);
    expect(result.linesReturned).toBe(3);
  });

  it('should clamp offset beyond file length', async () => {
    await createFile('short.txt', 'A\nB\n');
    const result = parseResult(await readFileTool.execute(
      { path: 'short.txt', offset: 100 },
      ctx,
    ));

    expect(result.success).toBe(true);
    expect(result.offset).toBe(2);  // clamped to last line
    expect(result.linesReturned).toBe(1);
  });

  it('should clamp limit to MAX_LIMIT', async () => {
    const lines = Array.from({ length: 2500 }, (_, i) => `line ${i + 1}`);
    await createFile('huge.txt', lines.join('\n') + '\n');
    const result = parseResult(await readFileTool.execute(
      { path: 'huge.txt', limit: 9999 },
      ctx,
    ));

    expect(result.success).toBe(true);
    expect(result.linesReturned).toBe(2000);  // clamped to MAX_LIMIT
  });

  it('should default to offset 1 and limit 500', async () => {
    const lines = Array.from({ length: 3 }, (_, i) => `L${i + 1}`);
    await createFile('defaults.txt', lines.join('\n') + '\n');
    const result = parseResult(await readFileTool.execute({ path: 'defaults.txt' }, ctx));

    expect(result.offset).toBe(1);
    expect(result.limit).toBe(500);
    expect(result.linesReturned).toBe(3);
  });

  // ── Error cases ───────────────────────────────────────────────────────────

  it('should error on missing path', async () => {
    const result = parseResult(await readFileTool.execute({}, ctx));
    expect(result.success).toBe(false);
    expect(result.error).toContain('path is required');
  });

  it('should error on empty path', async () => {
    const result = parseResult(await readFileTool.execute({ path: '' }, ctx));
    expect(result.success).toBe(false);
    expect(result.error).toContain('path is required');
  });

  it('should error on file not found', async () => {
    const result = parseResult(await readFileTool.execute(
      { path: 'nonexistent.txt' },
      ctx,
    ));
    expect(result.success).toBe(false);
    expect(result.error).toContain('File not found');
  });

  it('should error on directory', async () => {
    await fs.mkdir(path.join(workspace, 'subdir'));
    const result = parseResult(await readFileTool.execute(
      { path: 'subdir' },
      ctx,
    ));
    expect(result.success).toBe(false);
    expect(result.error).toContain('is a directory');
  });

  // ── Path traversal ───────────────────────────────────────────────────────

  it('should block path traversal via ../', async () => {
    const result = parseResult(await readFileTool.execute(
      { path: '../etc/passwd' },
      ctx,
    ));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Path traversal');
  });

  it('should block path traversal with nested ../', async () => {
    const result = parseResult(await readFileTool.execute(
      { path: 'subdir/../../secret.txt' },
      ctx,
    ));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Path traversal');
  });

  it('should block absolute paths outside workspace', async () => {
    const result = parseResult(await readFileTool.execute(
      { path: '/etc/passwd' },
      ctx,
    ));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Path traversal');
  });

  it('should allow paths that resolve inside workspace', async () => {
    await createFile('dir/file.txt', 'safe\n');
    // "dir/../dir/file.txt" resolves inside workspace
    const result = parseResult(await readFileTool.execute(
      { path: 'dir/../dir/file.txt' },
      ctx,
    ));
    expect(result.success).toBe(true);
  });

  // ── Binary detection ─────────────────────────────────────────────────────

  it('should reject binary files', async () => {
    const buf = Buffer.alloc(100, 65);  // all 'A'
    buf[50] = 0;  // null byte in the middle
    await fs.writeFile(path.join(workspace, 'bin.bin'), buf);
    const result = parseResult(await readFileTool.execute(
      { path: 'bin.bin' },
      ctx,
    ));
    expect(result.success).toBe(false);
    expect(result.error).toContain('binary');
  });

  it('should accept non-binary files with high bytes', async () => {
    // UTF-8 with non-ASCII but no null bytes
    await createFile('utf8.txt', 'Hello — world — café\n');
    const result = parseResult(await readFileTool.execute({ path: 'utf8.txt' }, ctx));
    expect(result.success).toBe(true);
  });

  // ── Nested files ─────────────────────────────────────────────────────────

  it('should read files in subdirectories', async () => {
    await createFile('src/utils/helper.ts', 'export const x = 1;\n');
    const result = parseResult(await readFileTool.execute(
      { path: 'src/utils/helper.ts' },
      ctx,
    ));
    expect(result.success).toBe(true);
    expect(result.content).toContain('export const x = 1;');
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  it('should handle a single line without trailing newline', async () => {
    await createFile('no-nl.txt', 'just one line');
    const result = parseResult(await readFileTool.execute(
      { path: 'no-nl.txt' },
      ctx,
    ));
    expect(result.success).toBe(true);
    expect(result.totalLines).toBe(1);
    expect(result.content).toBe('1|just one line');
  });

  it('should handle Windows-style line endings (\\r\\n)', async () => {
    await createFile('crlf.txt', 'line1\r\nline2\r\nline3\r\n');
    const result = parseResult(await readFileTool.execute(
      { path: 'crlf.txt' },
      ctx,
    ));
    expect(result.success).toBe(true);
    expect(result.totalLines).toBe(3);
  });

  it('should handle offset=1 explicitly', async () => {
    await createFile('nums.txt', 'one\ntwo\n');
    const result = parseResult(await readFileTool.execute(
      { path: 'nums.txt', offset: 1 },
      ctx,
    ));
    expect(result.offset).toBe(1);
    expect(result.content).toContain('1|one');
  });
});
