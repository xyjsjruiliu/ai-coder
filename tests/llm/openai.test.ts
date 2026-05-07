/**
 * Tests: OpenAIProvider
 *
 * Covers:
 * - buildRequest: message conversion, system as message, tools as functions
 * - buildRequest: ContentBlock[] handling
 * - buildRequest: image base64 detection
 * - buildRequest: stream_options.include_usage
 * - chat(): stream event parsing (text_delta, tool_call, tool_input, stop)
 * - chat(): [DONE] termination
 * - chat(): tool_calls incremental parsing (index-based)
 * - chat(): error handling (401, 429, 400, 500, network)
 * - AbortSignal passing
 * - listModels: success and error paths
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from '../../src/llm/openai.js';
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

const TEST_API_KEY = 'sk-proj-test-key-12345';

// ─── Sample Data ──────────────────────────────────────────────────────────

const sampleTextMessage: UnifiedMessage = {
  role: 'user',
  content: 'Hello, world!',
};

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

describe('OpenAIProvider', () => {
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
    const provider = new OpenAIProvider(TEST_API_KEY);

    it('should keep system as role:system message (not extract)', () => {
      const req = provider.buildRequest([
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hi' },
      ]);

      expect(req.messages).toHaveLength(2);
      expect(req.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
      expect(req.messages[1]).toEqual({ role: 'user', content: 'Hi' });
    });

    it('should set stream_options.include_usage', () => {
      const req = provider.buildRequest([sampleTextMessage]);
      expect(req.stream_options).toEqual({ include_usage: true });
    });

    it('should apply defaults', () => {
      const req = provider.buildRequest([sampleTextMessage]);

      expect(req.model).toBe('gpt-4o');
      expect(req.max_tokens).toBe(4096);
      expect(req.temperature).toBe(0);
      expect(req.stream).toBe(true);
    });

    it('should override defaults from opts', () => {
      const req = provider.buildRequest([sampleTextMessage], {
        model: 'gpt-4o-mini',
        max_tokens: 2048,
        temperature: 0.5,
      });

      expect(req.model).toBe('gpt-4o-mini');
      expect(req.max_tokens).toBe(2048);
      expect(req.temperature).toBe(0.5);
    });

    it('should format tools as function type', () => {
      const req = provider.buildRequest([sampleTextMessage], {
        tools: [sampleTool],
      });

      expect(req.tools).toHaveLength(1);
      expect(req.tools[0].type).toBe('function');
      expect(req.tools[0].function.name).toBe('read_file');
      expect(req.tools[0].function.parameters).toEqual(sampleTool.input_schema);
    });

    it('should convert text ContentBlock', () => {
      const req = provider.buildRequest([
        { role: 'user', content: [{ type: 'text', text: 'Hello from block' }] },
      ]);

      const content = req.messages[0].content as any[];
      expect(content).toHaveLength(1);
      expect(content[0].type).toBe('text');
    });

    it('should convert tool_use ContentBlock', () => {
      const req = provider.buildRequest([
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'call_123', name: 'read', input: { path: 'x.ts' } }],
        },
      ]);

      const content = req.messages[0].content as any[];
      expect(content[0].type).toBe('tool_use');
      expect(content[0].id).toBe('call_123');
    });

    it('should detect base64 image and convert to image_url format', () => {
      const req = provider.buildRequest([
        { role: 'user', content: 'data:image/png;base64,iVBORw0KGgo=' },
      ]);

      const content = req.messages[0].content as any[];
      expect(content[0].type).toBe('image_url');
      expect(content[0].image_url.url).toContain('data:image/png;base64,');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // chat() — Stream Parsing
  // ═══════════════════════════════════════════════════════════════════════

  describe('chat() stream parsing', () => {
    it('should yield text_delta chunks', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockStreamingResponse([
          'data: {"choices":[{"delta":{"content":"Hello"},"index":0}]}\n\n',
          'data: {"choices":[{"delta":{"content":" World"},"index":0}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"stop","index":0}],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n',
          'data: [DONE]\n\n',
        ]) as any,
      );

      const provider = new OpenAIProvider(TEST_API_KEY);
      const chunks: any[] = [];

      for await (const chunk of provider.chat([sampleTextMessage])) {
        chunks.push(chunk);
      }

      const textChunks = chunks.filter((c: any) => c.type === 'text_delta');
      expect(textChunks).toHaveLength(2);
      expect(textChunks[0].data).toBe('Hello');
      expect(textChunks[1].data).toBe(' World');

      const stopChunk = chunks.find((c: any) => c.type === 'stop');
      expect(stopChunk).toBeDefined();
      expect(stopChunk!.stop_reason).toBe('stop');
      expect(stopChunk!.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
    });

    it('should parse tool_call with index-based identification', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockStreamingResponse([
          // First chunk: tool call start with id + name
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_abc","type":"function","function":{"name":"read_file","arguments":""}}]},"index":0}]}\n\n',
          // Second: arguments fragment
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\": \\""}}]},"index":0}]}\n\n',
          // Third: more arguments
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"test.ts\\"}"}}]},"index":0}]}\n\n',
          // Terminal
          'data: {"choices":[{"delta":{},"finish_reason":"tool_calls","index":0}],"usage":{"prompt_tokens":20,"completion_tokens":15}}\n\n',
          'data: [DONE]\n\n',
        ]) as any,
      );

      const provider = new OpenAIProvider(TEST_API_KEY);
      const chunks: any[] = [];

      for await (const chunk of provider.chat([sampleTextMessage])) {
        chunks.push(chunk);
      }

      const toolCallChunks = chunks.filter((c: any) => c.type === 'tool_call');
      expect(toolCallChunks).toHaveLength(1);
      expect(toolCallChunks[0].data).toEqual({ id: 'call_abc', name: 'read_file' });

      const toolInputChunks = chunks.filter((c: any) => c.type === 'tool_input');
      expect(toolInputChunks).toHaveLength(2);
      expect(toolInputChunks[0].data.identifier).toBe('0');
      expect(toolInputChunks[0].data.arguments).toBe('{"path": "');
      expect(toolInputChunks[1].data.arguments).toBe('test.ts"}');
    });

    it('should handle multiple parallel tool calls', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockStreamingResponse([
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read_file","arguments":""}},{"index":1,"id":"call_2","type":"function","function":{"name":"search","arguments":""}}]},"index":0}]}\n\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":\\"a.ts\\"}"}},{"index":1,"function":{"arguments":"{\\"query\\":\\"test\\"}"}}]},"index":0}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"tool_calls","index":0}]}\n\n',
          'data: [DONE]\n\n',
        ]) as any,
      );

      const provider = new OpenAIProvider(TEST_API_KEY);
      const chunks: any[] = [];

      for await (const chunk of provider.chat([sampleTextMessage])) {
        chunks.push(chunk);
      }

      const toolCalls = chunks.filter((c: any) => c.type === 'tool_call');
      expect(toolCalls).toHaveLength(2);
      expect(toolCalls[0].data.name).toBe('read_file');
      expect(toolCalls[1].data.name).toBe('search');

      const toolInputs = chunks.filter((c: any) => c.type === 'tool_input');
      expect(toolInputs).toHaveLength(2);
    });

    it('should handle stop without usage', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockStreamingResponse([
          'data: {"choices":[{"delta":{},"finish_reason":"length","index":0}]}\n\n',
          'data: [DONE]\n\n',
        ]) as any,
      );

      const provider = new OpenAIProvider(TEST_API_KEY);
      const chunks: any[] = [];

      for await (const chunk of provider.chat([sampleTextMessage])) {
        chunks.push(chunk);
      }

      const stopChunk = chunks.find((c: any) => c.type === 'stop');
      expect(stopChunk!.stop_reason).toBe('length');
      expect(stopChunk!.usage).toBeUndefined();
    });

    it('should handle stream without choices array', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockStreamingResponse([
          'data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[]}\n\n',
          'data: [DONE]\n\n',
        ]) as any,
      );

      const provider = new OpenAIProvider(TEST_API_KEY);
      const chunks: any[] = [];

      for await (const chunk of provider.chat([sampleTextMessage])) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // chat() — Error Handling
  // ═══════════════════════════════════════════════════════════════════════

  describe('chat() error handling', () => {
    it('should throw AUTH_ERROR for 401', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse(401, { error: { message: 'Invalid API key' } }) as any,
      );

      const provider = new OpenAIProvider(TEST_API_KEY);

      try {
        for await (const _ of provider.chat([sampleTextMessage])) { /* */ }
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as ProviderError).code).toBe(ProviderErrorCode.AUTH_ERROR);
        expect((err as ProviderError).isRetryable).toBe(false);
      }
    });

    it('should throw RATE_LIMITED for 429 with x-ratelimit-reset-requests', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse(429, { error: { message: 'Rate limited' } }, {
          'x-ratelimit-reset-requests': '15',
        }) as any,
      );

      const provider = new OpenAIProvider(TEST_API_KEY);

      try {
        for await (const _ of provider.chat([sampleTextMessage])) { /* */ }
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as ProviderError).code).toBe(ProviderErrorCode.RATE_LIMITED);
        expect((err as ProviderError).retryAfterMs).toBe(15000);
      }
    });

    it('should throw RATE_LIMITED for 429 with Retry-After header', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse(429, { error: { message: 'Rate limited' } }, {
          'Retry-After': '20',
        }) as any,
      );

      const provider = new OpenAIProvider(TEST_API_KEY);

      try {
        for await (const _ of provider.chat([sampleTextMessage])) { /* */ }
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as ProviderError).retryAfterMs).toBe(20000);
      }
    });

    it('should throw INVALID_REQUEST for 400', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse(400, { error: { message: 'Invalid tool schema' } }) as any,
      );

      const provider = new OpenAIProvider(TEST_API_KEY);

      try {
        for await (const _ of provider.chat([sampleTextMessage])) { /* */ }
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as ProviderError).code).toBe(ProviderErrorCode.INVALID_REQUEST);
      }
    });

    it('should throw SERVER_ERROR for 500+', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse(503, { error: { message: 'Service unavailable' } }) as any,
      );

      const provider = new OpenAIProvider(TEST_API_KEY);

      try {
        for await (const _ of provider.chat([sampleTextMessage])) { /* */ }
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as ProviderError).code).toBe(ProviderErrorCode.SERVER_ERROR);
        expect((err as ProviderError).isRetryable).toBe(true);
      }
    });

    it('should throw NETWORK_ERROR on fetch failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('DNS lookup failed'));

      const provider = new OpenAIProvider(TEST_API_KEY);

      try {
        for await (const _ of provider.chat([sampleTextMessage])) { /* */ }
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as ProviderError).code).toBe(ProviderErrorCode.NETWORK_ERROR);
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

      const provider = new OpenAIProvider(TEST_API_KEY);

      try {
        for await (const _ of provider.chat([sampleTextMessage])) { /* */ }
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as ProviderError).code).toBe(ProviderErrorCode.UNKNOWN);
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
          'data: {"choices":[{"delta":{},"finish_reason":"stop","index":0}]}\n\n',
          'data: [DONE]\n\n',
        ]) as any,
      );

      const controller = new AbortController();
      const provider = new OpenAIProvider(TEST_API_KEY);

      for await (const _ of provider.chat([sampleTextMessage], {
        signal: controller.signal,
      })) { /* */ }

      expect(fetchSpy.mock.calls[0][1]?.signal).toBe(controller.signal);
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
            { id: 'gpt-4o' },
            { id: 'gpt-4o-mini' },
          ],
        }),
      } as any);

      const provider = new OpenAIProvider(TEST_API_KEY);
      const models = await provider.listModels();

      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('openai:gpt-4o');
    });

    it('should return empty array on error', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fail'));

      const provider = new OpenAIProvider(TEST_API_KEY);
      expect(await provider.listModels()).toEqual([]);
    });
  });
});
