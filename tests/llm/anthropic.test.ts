/**
 * Tests: AnthropicProvider
 *
 * Covers:
 * - buildRequest: message conversion, system extraction, tool formatting
 * - buildRequest: ContentBlock[] handling (text, tool_use, tool_result, thinking)
 * - buildRequest: image base64 detection
 * - buildRequest: defaults (model, max_tokens, temperature)
 * - chat(): error handling (401, 429, 529, 500, network error)
 * - chat(): stream event parsing (text_delta, tool_call, tool_input, stop)
 * - chat(): edge cases (empty messages, no tools, abort signal)
 * - handleError: status code classification
 * - listModels: success and error paths
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from '../../src/llm/anthropic.js';
import { ProviderError, ProviderErrorCode } from '../../src/llm/types.js';
import type { UnifiedMessage, ToolDefinition } from '../../src/llm/types.js';

// ─── Test Helpers ─────────────────────────────────────────────────────────

function mockFetchResponse(status: number, body: any, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers as any),
    body: null as ReadableStream | null,
    json: async () => body,
  };
}

function textStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index++]));
      } else {
        controller.close();
      }
    },
  });
}

function mockStreamingResponse(chunks: string[], status = 200) {
  return {
    ok: true,
    status,
    headers: new Headers() as any,
    body: textStream(chunks),
    json: async () => ({}),
  };
}

const TEST_API_KEY = 'sk-ant-test-key-12345';

// ─── Sample Data ──────────────────────────────────────────────────────────

const sampleTextMessage: UnifiedMessage = {
  role: 'user',
  content: 'Hello, world!',
};

const sampleMessages: UnifiedMessage[] = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'What is TypeScript?' },
];

const sampleTool: ToolDefinition = {
  name: 'read_file',
  description: 'Read a file',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path' },
    },
    required: ['path'],
  },
};

describe('AnthropicProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // buildRequest()
  // ═══════════════════════════════════════════════════════════════════════

  describe('buildRequest', () => {
    const provider = new AnthropicProvider(TEST_API_KEY);

    it('should extract system message to top-level system field', () => {
      const req = provider.buildRequest([
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hi' },
      ]);

      expect(req.system).toBe('You are a helpful assistant.');
      expect(req.messages).toHaveLength(1);
      expect(req.messages[0]).toEqual({ role: 'user', content: 'Hi' });
    });

    it('should merge multiple system messages', () => {
      const req = provider.buildRequest([
        { role: 'system', content: 'You are helpful.' },
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'Hi' },
      ]);

      expect(req.system).toBe('You are helpful.\n\nBe concise.');
      expect(req.messages).toHaveLength(1);
    });

    it('should handle no system messages', () => {
      const req = provider.buildRequest([
        { role: 'user', content: 'Hi' },
      ]);

      expect(req.system).toBe('');
      expect(req.messages).toHaveLength(1);
    });

    it('should apply defaults when opts is undefined', () => {
      const req = provider.buildRequest(sampleMessages);

      expect(req.model).toBe('claude-sonnet-4-20250514');
      expect(req.max_tokens).toBe(4096);
      expect(req.temperature).toBe(0);
      expect(req.stream).toBe(true);
      expect(req.tools).toEqual([]);
    });

    it('should override defaults from opts', () => {
      const req = provider.buildRequest(sampleMessages, {
        model: 'claude-opus-4-20250514',
        max_tokens: 1024,
        temperature: 0.7,
      });

      expect(req.model).toBe('claude-opus-4-20250514');
      expect(req.max_tokens).toBe(1024);
      expect(req.temperature).toBe(0.7);
    });

    it('should format tools in Anthropic schema', () => {
      const req = provider.buildRequest(sampleMessages, {
        tools: [sampleTool],
      });

      expect(req.tools).toHaveLength(1);
      expect(req.tools[0]).toEqual({
        name: 'read_file',
        description: 'Read a file',
        input_schema: sampleTool.input_schema,
      });
    });

    it('should pass through system from opts', () => {
      const req = provider.buildRequest(
        [{ role: 'user', content: 'Hi' }],
        { system: 'Custom system prompt' },
      );

      expect(req.system).toBe('Custom system prompt');
    });

    it('should merge system from messages and opts', () => {
      const req = provider.buildRequest(
        [
          { role: 'system', content: 'From messages' },
          { role: 'user', content: 'Hi' },
        ],
        { system: 'From opts' },
      );

      expect(req.system).toBe('From opts\n\nFrom messages');
    });

    // ── ContentBlock[] handling ──────────────────────────────────────────

    it('should convert text ContentBlock to Anthropic format', () => {
      const req = provider.buildRequest([
        {
          role: 'user',
          content: [{ type: 'text', text: 'Hello from block' }],
        },
      ]);

      expect(req.messages).toHaveLength(1);
      const content = req.messages[0].content as any[];
      expect(content).toHaveLength(1);
      expect(content[0].type).toBe('text');
      expect(content[0].text).toBe('Hello from block');
    });

    it('should convert tool_use ContentBlock', () => {
      const req = provider.buildRequest([
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tool_123', name: 'read', input: { path: 'test.ts' } }],
        },
      ]);

      const content = req.messages[0].content as any[];
      expect(content[0].type).toBe('tool_use');
      expect(content[0].id).toBe('tool_123');
      expect(content[0].input).toEqual({ path: 'test.ts' });
    });

    it('should convert tool_result ContentBlock with error prefix', () => {
      const req = provider.buildRequest([
        {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: 'tool_123',
            content: 'File not found',
            is_error: true,
          }],
        },
      ]);

      const content = req.messages[0].content as any[];
      expect(content[0].type).toBe('tool_result');
      expect(content[0].content).toBe('Error: File not found');
    });

    it('should convert tool_result ContentBlock without error prefix', () => {
      const req = provider.buildRequest([
        {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: 'tool_123',
            content: 'File contents here',
            is_error: false,
          }],
        },
      ]);

      const content = req.messages[0].content as any[];
      expect(content[0].type).toBe('tool_result');
      expect(content[0].content).toBe('File contents here');
    });

    it('should convert thinking ContentBlock', () => {
      const req = provider.buildRequest([
        {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'Let me think...', signature: 'sig123' }],
        },
      ]);

      const content = req.messages[0].content as any[];
      expect(content[0].type).toBe('thinking');
      expect(content[0].thinking).toBe('Let me think...');
    });

    it('should handle mixed ContentBlock array', () => {
      const req = provider.buildRequest([
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Sure!' },
            { type: 'tool_use', id: 't1', name: 'read', input: {} },
          ],
        },
      ]);

      const content = req.messages[0].content as any[];
      expect(content).toHaveLength(2);
      expect(content[0].type).toBe('text');
      expect(content[1].type).toBe('tool_use');
    });

    // ── Image Handling ───────────────────────────────────────────────────

    it('should detect base64 PNG image in string content', () => {
      const req = provider.buildRequest([
        { role: 'user', content: 'data:image/png;base64,iVBORw0KGgo=' },
      ]);

      const content = req.messages[0].content as any[];
      expect(content[0].type).toBe('image');
      expect(content[0].source.type).toBe('base64');
      expect(content[0].source.media_type).toBe('image/png');
    });

    it('should detect base64 JPEG image in string content', () => {
      const req = provider.buildRequest([
        { role: 'user', content: 'data:image/jpeg;base64,/9j/4AAQ=' },
      ]);

      const content = req.messages[0].content as any[];
      expect(content[0].source.media_type).toBe('image/jpeg');
    });

    it('should handle unknown ContentBlock type gracefully', () => {
      const req = provider.buildRequest([
        {
          role: 'user',
          content: [{ type: 'unknown_block' as any, data: '???' }],
        },
      ]);

      const content = req.messages[0].content as any[];
      expect(content).toHaveLength(1);
      expect(content[0].type).toBe('text');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // chat() — Stream Parsing
  // ═══════════════════════════════════════════════════════════════════════

  describe('chat() stream parsing', () => {
    it('should yield text_delta chunks', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockStreamingResponse([
          'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" World"}}\n\n',
          'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":10,"output_tokens":5}}\n\n',
        ]) as any,
      );

      const provider = new AnthropicProvider(TEST_API_KEY);
      const chunks: any[] = [];

      for await (const chunk of provider.chat([sampleTextMessage])) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toEqual({ type: 'text_delta', data: 'Hello' });
      expect(chunks[1]).toEqual({ type: 'text_delta', data: ' World' });
      expect(chunks[2]).toMatchObject({
        type: 'stop',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      });
    });

    it('should yield tool_call chunks', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockStreamingResponse([
          'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_123","name":"read_file"}}\n\n',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\": \\"test.ts\\"}"}}\n\n',
          'data: {"type":"content_block_stop","index":0}\n\n',
          'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"input_tokens":20,"output_tokens":10}}\n\n',
        ]) as any,
      );

      const provider = new AnthropicProvider(TEST_API_KEY);
      const chunks: any[] = [];

      for await (const chunk of provider.chat([sampleTextMessage])) {
        chunks.push(chunk);
      }

      const toolCalls = chunks.filter((c: any) => c.type === 'tool_call');
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].data).toEqual({ id: 'toolu_123', name: 'read_file' });

      const toolInputs = chunks.filter((c: any) => c.type === 'tool_input');
      expect(toolInputs).toHaveLength(1);
      expect(toolInputs[0].data.arguments).toBe('{"path": "test.ts"}');
    });

    it('should yield stop without usage when usage missing', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockStreamingResponse([
          'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
        ]) as any,
      );

      const provider = new AnthropicProvider(TEST_API_KEY);
      const chunks: any[] = [];

      for await (const chunk of provider.chat([sampleTextMessage])) {
        chunks.push(chunk);
      }

      expect(chunks[0]).toMatchObject({
        type: 'stop',
        stop_reason: 'end_turn',
      });
      expect(chunks[0].usage).toBeUndefined();
    });

    it('should yield thinking_delta chunks', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockStreamingResponse([
          'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Let me analyze"}}\n\n',
          'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
        ]) as any,
      );

      const provider = new AnthropicProvider(TEST_API_KEY);
      const chunks: any[] = [];

      for await (const chunk of provider.chat([sampleTextMessage])) {
        chunks.push(chunk);
      }

      const thinking = chunks.find((c: any) => c.type === 'thinking_delta');
      expect(thinking).toBeDefined();
      expect(thinking!.data).toBe('Let me analyze');
    });

    it('should handle empty stream', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockStreamingResponse([]) as any,
      );

      const provider = new AnthropicProvider(TEST_API_KEY);
      const chunks: any[] = [];

      for await (const chunk of provider.chat([sampleTextMessage])) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(0);
    });

    it('should skip [DONE] in Anthropic stream', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockStreamingResponse([
          'data: [DONE]\n\n',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"real"}}\n\n',
          'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
        ]) as any,
      );

      const provider = new AnthropicProvider(TEST_API_KEY);
      const chunks: any[] = [];

      for await (const chunk of provider.chat([sampleTextMessage])) {
        chunks.push(chunk);
      }

      // [DONE] should be skipped as invalid event
      expect(chunks).toHaveLength(2);
      expect(chunks[0].type).toBe('text_delta');
    });

    it('should handle error event in stream', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockStreamingResponse([
          'data: {"type":"error","error":{"type":"api_error","message":"Something went wrong"}}\n\n',
        ]) as any,
      );

      const provider = new AnthropicProvider(TEST_API_KEY);

      await expect(async () => {
        for await (const _ of provider.chat([sampleTextMessage])) { void _; }
      }).rejects.toThrow(ProviderError);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // chat() — Error Handling
  // ═══════════════════════════════════════════════════════════════════════

  describe('chat() error handling', () => {
    it('should throw AUTH_ERROR for 401', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse(401, { error: { message: 'Invalid key' } }) as any,
      );

      const provider = new AnthropicProvider(TEST_API_KEY);

      await expect(async () => {
        for await (const _ of provider.chat([sampleTextMessage])) { /* */ }
      }).rejects.toThrow(ProviderError);

      try {
        for await (const _ of provider.chat([sampleTextMessage])) { /* */ }
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderError);
        expect((err as ProviderError).code).toBe(ProviderErrorCode.AUTH_ERROR);
        expect((err as ProviderError).status).toBe(401);
        expect((err as ProviderError).isRetryable).toBe(false);
      }
    });

    it('should throw RATE_LIMITED for 429', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse(429, { error: { message: 'Too many requests' } }, {
          'Retry-After': '30',
        }) as any,
      );

      const provider = new AnthropicProvider(TEST_API_KEY);

      try {
        for await (const _ of provider.chat([sampleTextMessage])) { /* */ }
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as ProviderError).code).toBe(ProviderErrorCode.RATE_LIMITED);
        expect((err as ProviderError).status).toBe(429);
        expect((err as ProviderError).retryAfterMs).toBe(30000);
        expect((err as ProviderError).isRetryable).toBe(true);
      }
    });

    it('should throw RATE_LIMITED for 429 without Retry-After', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse(429, { error: { message: 'Rate limit' } }) as any,
      );

      const provider = new AnthropicProvider(TEST_API_KEY);

      try {
        for await (const _ of provider.chat([sampleTextMessage])) { /* */ }
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as ProviderError).code).toBe(ProviderErrorCode.RATE_LIMITED);
        expect((err as ProviderError).retryAfterMs).toBeUndefined();
      }
    });

    it('should throw OVERLOADED for 529', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse(529, { error: { message: 'Overloaded' } }) as any,
      );

      const provider = new AnthropicProvider(TEST_API_KEY);

      try {
        for await (const _ of provider.chat([sampleTextMessage])) { /* */ }
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as ProviderError).code).toBe(ProviderErrorCode.OVERLOADED);
        expect((err as ProviderError).isRetryable).toBe(true);
      }
    });

    it('should throw INVALID_REQUEST for 400', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse(400, { error: { message: 'Bad request' } }) as any,
      );

      const provider = new AnthropicProvider(TEST_API_KEY);

      try {
        for await (const _ of provider.chat([sampleTextMessage])) { /* */ }
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as ProviderError).code).toBe(ProviderErrorCode.INVALID_REQUEST);
        expect((err as ProviderError).isRetryable).toBe(false);
      }
    });

    it('should throw SERVER_ERROR for 500', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse(500, { error: { message: 'Internal error' } }) as any,
      );

      const provider = new AnthropicProvider(TEST_API_KEY);

      try {
        for await (const _ of provider.chat([sampleTextMessage])) { /* */ }
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as ProviderError).code).toBe(ProviderErrorCode.SERVER_ERROR);
        expect((err as ProviderError).isRetryable).toBe(true);
      }
    });

    it('should throw NETWORK_ERROR on fetch failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Connection refused'));

      const provider = new AnthropicProvider(TEST_API_KEY);

      try {
        for await (const _ of provider.chat([sampleTextMessage])) { /* */ }
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as ProviderError).code).toBe(ProviderErrorCode.NETWORK_ERROR);
        expect((err as ProviderError).isRetryable).toBe(true);
        expect((err as ProviderError).message).toContain('Network error');
      }
    });

    it('should throw UNKNOWN for empty response body', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers() as any,
        body: null,
        json: async () => ({}),
      } as any);

      const provider = new AnthropicProvider(TEST_API_KEY);

      try {
        for await (const _ of provider.chat([sampleTextMessage])) { /* */ }
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as ProviderError).code).toBe(ProviderErrorCode.UNKNOWN);
      }
    });

    it('should handle 404 as UNKNOWN', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse(404, { error: { message: 'Not found' } }) as any,
      );

      const provider = new AnthropicProvider(TEST_API_KEY);

      try {
        for await (const _ of provider.chat([sampleTextMessage])) { /* */ }
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as ProviderError).code).toBe(ProviderErrorCode.UNKNOWN);
      }
    });

    it('should handle unparseable error body', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers() as any,
        json: async () => { throw new Error('Invalid JSON'); },
      } as any);

      const provider = new AnthropicProvider(TEST_API_KEY);

      try {
        for await (const _ of provider.chat([sampleTextMessage])) { /* */ }
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as ProviderError).code).toBe(ProviderErrorCode.SERVER_ERROR);
        // Fallback to HTTP status message
        expect((err as ProviderError).message).toContain('500');
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Abort Signal
  // ═══════════════════════════════════════════════════════════════════════

  describe('abort signal', () => {
    it('should pass signal to fetch', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockStreamingResponse([
          'event: message_delta\ndata: {"delta":{"stop_reason":"end_turn"}}\n\n',
        ]) as any,
      );

      const controller = new AbortController();
      const provider = new AnthropicProvider(TEST_API_KEY);

      for await (const _ of provider.chat([sampleTextMessage], {
        signal: controller.signal,
      })) { /* */ }

      // Verify signal was passed through
      const calledWith = fetchSpy.mock.calls[0][1];
      expect(calledWith?.signal).toBe(controller.signal);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // listModels()
  // ═══════════════════════════════════════════════════════════════════════

  describe('listModels()', () => {
    it('should return models on success', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4' },
            { id: 'claude-opus-4-20250514', display_name: 'Claude Opus 4' },
          ],
        }),
      } as any);

      const provider = new AnthropicProvider(TEST_API_KEY);
      const models = await provider.listModels();

      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('anthropic:claude-sonnet-4-20250514');
      expect(models[0].display_name).toBe('Claude Sonnet 4');
    });

    it('should return empty array on HTTP error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({}),
      } as any);

      const provider = new AnthropicProvider(TEST_API_KEY);
      const models = await provider.listModels();
      expect(models).toEqual([]);
    });

    it('should return empty array on network error', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

      const provider = new AnthropicProvider(TEST_API_KEY);
      const models = await provider.listModels();
      expect(models).toEqual([]);
    });

    it('should handle empty data array', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      } as any);

      const provider = new AnthropicProvider(TEST_API_KEY);
      const models = await provider.listModels();
      expect(models).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Constructor & Custom baseUrl
  // ═══════════════════════════════════════════════════════════════════════

  describe('constructor', () => {
    it('should use default baseUrl when not provided', () => {
      const provider = new AnthropicProvider(TEST_API_KEY);
      expect(provider.providerName).toBe('anthropic');
    });

    it('should accept custom baseUrl', () => {
      const provider = new AnthropicProvider(TEST_API_KEY, 'https://custom.api.com');
      expect(provider.providerName).toBe('anthropic');
    });
  });
});
