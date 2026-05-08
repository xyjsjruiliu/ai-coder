/**
 * web_search tool — search the web via DuckDuckGo Lite and return results.
 *
 * Uses DuckDuckGo Lite (no API key, no JavaScript dependency).
 * Returns structured results with title, snippet, and URL.
 * No approval needed — read-only external operation.
 */

import type { Tool, ToolContext } from './types.js';

interface SearchResultItem {
  title: string;
  snippet: string;
  url: string;
}

function parseDuckDuckGoLite(html: string): SearchResultItem[] {
  const results: SearchResultItem[] = [];

  const linkRegex =
    /<a[^>]*href="[^"]*uddg=([^"&]*)[^"]*"[^>]*class="result-link"[^>]*>([^<]*)<\/a>/gi;
  for (const m of html.matchAll(linkRegex)) {
    try {
      const url = decodeURIComponent(m[1]);
      const title = m[2].replace(/<[^>]+>/g, '').trim();
      if (url && title && url.startsWith('http')) {
        results.push({ title, snippet: '', url });
      }
    } catch {
      // skip malformed entry
    }
  }

  const snippetRegex =
    /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;
  const snippets: string[] = [];
  for (const m of html.matchAll(snippetRegex)) {
    snippets.push(m[1].replace(/<[^>]+>/g, '').trim());
  }
  for (let i = 0; i < results.length && i < snippets.length; i++) {
    results[i].snippet = snippets[i];
  }

  return results;
}

export const webSearchTool: Tool = {
  name: 'web_search',
  description:
    'Searches the web using DuckDuckGo Lite. IMPORTANT: Use SPARINGLY — first try to answer from your own knowledge. Only use this when you genuinely need current/recent information (e.g., latest docs, news, or facts beyond your training cutoff). For most programming questions, your built-in knowledge is sufficient. When you do search, ONE well-crafted query is usually enough — do NOT re-search with slightly different wording. Default to maxResults=5 unless you have a specific reason for more. No API key required.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query. Be specific for better results.',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum results to return. Default: 10, Max: 20.',
      },
    },
    required: ['query'],
  },

  async execute(
    args: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<string> {
    const query = String(args.query ?? '').trim();
    if (!query) {
      return JSON.stringify({ success: false, error: 'Query is required.' });
    }

    const maxResults = Math.min(
      typeof args.maxResults === 'number' && args.maxResults > 0
        ? args.maxResults
        : 10,
      20,
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const url =
        'https://lite.duckduckgo.com/lite/?' +
        new URLSearchParams({ q: query });

      const resp = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'AI-Coder/0.1.0',
          Accept: 'text/html',
        },
      });

      if (!resp.ok) {
        return JSON.stringify({
          success: false,
          error: `Search failed: HTTP ${resp.status}`,
        });
      }

      const html = await resp.text();
      const raw = parseDuckDuckGoLite(html);
      const results = raw.slice(0, maxResults);

      return JSON.stringify({
        success: true,
        query,
        resultCount: results.length,
        results,
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return JSON.stringify({
          success: false,
          error: 'Search timed out after 15 seconds.',
        });
      }
      return JSON.stringify({
        success: false,
        error: `Search failed: ${err.message}`,
      });
    } finally {
      clearTimeout(timeout);
    }
  },
};
