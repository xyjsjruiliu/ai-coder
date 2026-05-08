/**
 * Unit tests for write_file tool.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileTool } from '../../src/tools/write_file.js';
import type { ToolContext } from '../../src/tools/types.js';

describe('write_file tool', () => {
  let tmpDir: string;
  let context: ToolContext;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-coder-write-'));
    context = {
      workspaceRoot: tmpDir,
      approver: async () => true, // auto-approve for tests
    };
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates a new file', async () => {
    const result = await writeFileTool.execute(
      { path: 'hello.txt', content: 'Hello, World!' },
      context,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.path).toBe('hello.txt');
    expect(parsed.bytesWritten).toBe(13);
    expect(parsed.overwritten).toBe(false);

    const disk = await fs.readFile(path.join(tmpDir, 'hello.txt'), 'utf-8');
    expect(disk).toBe('Hello, World!');
  });

  it('overwrites an existing file', async () => {
    await fs.writeFile(path.join(tmpDir, 'existing.txt'), 'old content');
    const result = await writeFileTool.execute(
      { path: 'existing.txt', content: 'new content' },
      context,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.overwritten).toBe(true);
  });

  it('creates parent directories automatically', async () => {
    const result = await writeFileTool.execute(
      { path: 'deep/nested/dir/file.txt', content: 'nested' },
      context,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);

    const disk = await fs.readFile(path.join(tmpDir, 'deep/nested/dir/file.txt'), 'utf-8');
    expect(disk).toBe('nested');
  });

  it('blocks path traversal (../)', async () => {
    const result = await writeFileTool.execute(
      { path: '../outside.txt', content: 'escape' },
      context,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('Path traversal');
  });

  it('blocks absolute paths', async () => {
    const result = await writeFileTool.execute(
      { path: '/etc/passwd', content: 'hack' },
      context,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('Path traversal');
  });

  it('returns error when path is missing', async () => {
    const result = await writeFileTool.execute(
      { content: 'test' },
      context,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('path is required');
  });

  it('returns error when path is empty', async () => {
    const result = await writeFileTool.execute(
      { path: '', content: 'test' },
      context,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('path is required');
  });

  it('returns error when content is missing', async () => {
    const result = await writeFileTool.execute(
      { path: 'test.txt' },
      context,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('content is required');
  });

  it('writes empty content', async () => {
    const result = await writeFileTool.execute(
      { path: 'empty.txt', content: '' },
      context,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.bytesWritten).toBe(0);
  });

  it('writes content with unicode characters', async () => {
    const unicode = '你好世界 🌍 émoji';
    const result = await writeFileTool.execute(
      { path: 'unicode.txt', content: unicode },
      context,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);

    const disk = await fs.readFile(path.join(tmpDir, 'unicode.txt'), 'utf-8');
    expect(disk).toBe(unicode);
  });

  it('writes large content', async () => {
    const large = 'x'.repeat(100_000);
    const result = await writeFileTool.execute(
      { path: 'large.txt', content: large },
      context,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.bytesWritten).toBe(100_000);
  });

  it('denies when approver returns false', async () => {
    const deniedContext: ToolContext = {
      workspaceRoot: tmpDir,
      approver: async () => false,
    };
    const result = await writeFileTool.execute(
      { path: 'denied.txt', content: 'nope' },
      deniedContext,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('denied');
  });
});
