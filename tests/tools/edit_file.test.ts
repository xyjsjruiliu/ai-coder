/**
 * Unit tests for edit_file tool.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { editFileTool } from '../../src/tools/edit_file.js';
import type { ToolContext } from '../../src/tools/types.js';

describe('edit_file tool', () => {
  let tmpDir: string;
  let context: ToolContext;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-coder-edit-'));
    context = {
      workspaceRoot: tmpDir,
      approver: async () => true,
    };
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function createFile(name: string, content: string): Promise<void> {
    await fs.writeFile(path.join(tmpDir, name), content);
  }

  it('replaces a unique string in a file', async () => {
    await createFile('test.txt', 'Hello, World!');
    const result = await editFileTool.execute(
      { path: 'test.txt', old_string: 'World', new_string: 'Universe' },
      context,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.replaced).toBe(true);
    expect(parsed.occurrences).toBe(1);

    const disk = await fs.readFile(path.join(tmpDir, 'test.txt'), 'utf-8');
    expect(disk).toBe('Hello, Universe!');
  });

  it('replaces all occurrences when replace_all is true', async () => {
    await createFile('test.txt', 'foo bar foo baz foo');
    const result = await editFileTool.execute(
      { path: 'test.txt', old_string: 'foo', new_string: 'qux', replace_all: true },
      context,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.occurrences).toBe(3);

    const disk = await fs.readFile(path.join(tmpDir, 'test.txt'), 'utf-8');
    expect(disk).toBe('qux bar qux baz qux');
  });

  it('fails when old_string is not unique and replace_all is false', async () => {
    await createFile('dup.txt', 'line1\nmiddle\nline2\nmiddle\nline3');
    const result = await editFileTool.execute(
      { path: 'dup.txt', old_string: 'middle', new_string: 'replaced', replace_all: false },
      context,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('not unique');
    expect(parsed.error).toContain('2 matches');
  });

  it('fails when old_string is not found', async () => {
    await createFile('test.txt', 'Hello, World!');
    const result = await editFileTool.execute(
      { path: 'test.txt', old_string: 'NotFound', new_string: 'x' },
      context,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('not found');
  });

  it('blocks path traversal', async () => {
    const result = await editFileTool.execute(
      { path: '../../secret.txt', old_string: 'a', new_string: 'b' },
      context,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('Path traversal');
  });

  it('fails when file does not exist', async () => {
    const result = await editFileTool.execute(
      { path: 'nonexistent.txt', old_string: 'a', new_string: 'b' },
      context,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('not found');
  });

  it('fails when path is a directory', async () => {
    await fs.mkdir(path.join(tmpDir, 'subdir'));
    const result = await editFileTool.execute(
      { path: 'subdir', old_string: 'a', new_string: 'b' },
      context,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('directory');
  });

  it('returns error when path is missing', async () => {
    const result = await editFileTool.execute(
      { old_string: 'a', new_string: 'b' },
      context,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('path is required');
  });

  it('returns error when old_string is empty', async () => {
    await createFile('test.txt', 'content');
    const result = await editFileTool.execute(
      { path: 'test.txt', old_string: '', new_string: 'b' },
      context,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('non-empty');
  });

  it('replaces with empty string (deletion)', async () => {
    await createFile('test.txt', 'keep DELETE_ME done');
    const result = await editFileTool.execute(
      { path: 'test.txt', old_string: 'DELETE_ME ', new_string: '' },
      context,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);

    const disk = await fs.readFile(path.join(tmpDir, 'test.txt'), 'utf-8');
    expect(disk).toBe('keep done');
  });

  it('respects whitespace sensitivity', async () => {
    await createFile('ws.txt', 'hello  world'); // double space
    const result = await editFileTool.execute(
      { path: 'ws.txt', old_string: 'hello world', new_string: 'hi' }, // single space
      context,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('not found');
  });

  it('denies when approver returns false', async () => {
    await createFile('test.txt', 'Hello');
    const deniedContext: ToolContext = {
      workspaceRoot: tmpDir,
      approver: async () => false,
    };
    const result = await editFileTool.execute(
      { path: 'test.txt', old_string: 'Hello', new_string: 'Bye' },
      deniedContext,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('denied');
  });

  it('handles multiline old_string', async () => {
    await createFile('multiline.txt', 'line1\nline2\nline3\nline4');
    const result = await editFileTool.execute(
      {
        path: 'multiline.txt',
        old_string: 'line2\nline3',
        new_string: 'REPLACED',
      },
      context,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);

    const disk = await fs.readFile(path.join(tmpDir, 'multiline.txt'), 'utf-8');
    expect(disk).toBe('line1\nREPLACED\nline4');
  });

  it('handles replace_all with no matches as error', async () => {
    await createFile('test.txt', 'aaa');
    const result = await editFileTool.execute(
      { path: 'test.txt', old_string: 'bbb', new_string: 'ccc', replace_all: true },
      context,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('not found');
  });
});
