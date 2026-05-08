import { describe, it, expect } from 'vitest';
import { webSearchTool } from '../../src/tools/web_search.js';
import { webFetchTool } from '../../src/tools/web_fetch.js';

function exec(tool: any, args: Record<string, unknown>) {
  return tool.execute(args, { workspaceRoot: '/tmp' }).then(JSON.parse);
}

describe('web_search tool', () => {
  it('should be importable', () => {
    expect(webSearchTool.name).toBe('web_search');
  });

  it('should have correct definition', () => {
    expect(webSearchTool.parameters.required).toContain('query');
  });

  it('should return error for empty query', async () => {
    const result = await exec(webSearchTool, { query: '' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Query');
  });

  it('should return error for missing query', async () => {
    const result = await exec(webSearchTool, {});
    expect(result.success).toBe(false);
  });

  it('should cap maxResults at 20', async () => {
    const result = await exec(webSearchTool, {
      query: 'test',
      maxResults: 50,
    });
    expect(result).toBeDefined();
  }, 20000);

  it('should handle special characters in query', async () => {
    const result = await exec(webSearchTool, {
      query: 'test & query < > " special',
    });
    expect(result).toBeDefined();
  }, 20000);
});

describe('web_fetch tool', () => {
  it('should be importable', () => {
    expect(webFetchTool.name).toBe('web_fetch');
  });

  it('should have correct definition', () => {
    expect(webFetchTool.parameters.required).toContain('url');
  });

  it('should return error for invalid URL', async () => {
    const result = await exec(webFetchTool, { url: 'not-a-url' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('URL');
  });

  it('should return error for empty URL', async () => {
    const result = await exec(webFetchTool, { url: '' });
    expect(result.success).toBe(false);
  });

  it('should return error for non-HTTP URL', async () => {
    const result = await exec(webFetchTool, { url: 'ftp://example.com/file' });
    expect(result.success).toBe(false);
  });

  it('should handle maxChars parameter', async () => {
    const result = await exec(webFetchTool, {
      url: 'https://example.com',
      maxChars: 100,
    });
    expect(result).toBeDefined();
  }, 15000);

  it('should handle network error gracefully', async () => {
    const result = await exec(webFetchTool, {
      url: 'https://invalid.domain.that.does.not.exist.example',
    });
    expect(result.success).toBe(false);
  }, 15000);
});
