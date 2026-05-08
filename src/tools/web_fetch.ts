/**
 * web_fetch tool — fetch a URL and return the extracted plain text.
 *
 * Uses Node.js native fetch() with 10s timeout.
 * Strips HTML tags, handles JSON responses directly.
 * No approval needed — read-only external operation.
 */

import type { Tool, ToolContext } from './types.js';

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

export const webFetchTool: Tool = {
  name: 'web_fetch',
  description:
    'Fetches content from a URL and returns extracted plain text. IMPORTANT: Use SPARINGLY — fetch only the 1-2 MOST RELEVANT pages, never more. Use web_search first to find URLs, then fetch only the top result(s) that look most promising. Do NOT fetch every search result — pick the best one. For simple queries, you often don\'t need to fetch at all — the search snippets are enough. Strips HTML tags and returns clean text.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch. Must start with http:// or https://.',
      },
      maxChars: {
        type: 'number',
        description:
          'Maximum characters to return. Default: 50000. Useful for trimming large pages.',
      },
    },
    required: ['url'],
  },

  async execute(
    args: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<string> {
    const url = String(args.url ?? '');
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      return JSON.stringify({
        success: false,
        error: 'Invalid URL. Must start with http:// or https://.',
      });
    }

    const maxChars =
      typeof args.maxChars === 'number' && args.maxChars > 0
        ? Math.min(args.maxChars, 50000)
        : 50000;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'AI-Coder/0.1.0',
          Accept: 'text/html, text/plain, application/json, */*',
        },
        redirect: 'follow',
      });

      if (!resp.ok) {
        return JSON.stringify({
          success: false,
          error: `HTTP ${resp.status} ${resp.statusText}`,
        });
      }

      const contentType = resp.headers.get('content-type') || '';
      let text: string;

      if (contentType.includes('application/json')) {
        text = JSON.stringify(await resp.json(), null, 2);
      } else if (
        contentType.includes('text/html') ||
        contentType.includes('text/plain') ||
        !contentType
      ) {
        const raw = await resp.text();
        text =
          contentType.includes('text/html') || !contentType
            ? stripHtml(raw)
            : raw;
      } else {
        return JSON.stringify({
          success: false,
          error: `Unsupported content type: ${contentType}`,
        });
      }

      const truncated =
        text.length > maxChars
          ? text.slice(0, maxChars) +
            `\n\n[... truncated at ${maxChars} of ${text.length} characters]`
          : text;

      return JSON.stringify({
        success: true,
        url,
        contentType,
        status: resp.status,
        length: truncated.length,
        text: truncated,
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return JSON.stringify({
          success: false,
          error: 'Request timed out after 10 seconds.',
        });
      }
      return JSON.stringify({
        success: false,
        error: `Fetch failed: ${err.message}`,
      });
    } finally {
      clearTimeout(timeout);
    }
  },
};
