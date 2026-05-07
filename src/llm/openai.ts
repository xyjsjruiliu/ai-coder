/**
 * OpenAI Provider Adapter.
 *
 * Endpoint: POST {baseUrl}/v1/chat/completions
 * Headers:  Authorization: Bearer <apiKey>
 *
 * Key differences from Anthropic:
 * - system is a message role, not a top-level field
 * - Tools use function type: { type: "function", function: { name, description, parameters } }
 * - Tool calls are top-level: message.tool_calls[]
 * - Streaming events: SSE lines with data: {json} or data: [DONE]
 * - usage is in the last chunk with stream_options: { include_usage: true }
 * - finish_reason in choices[0].finish_reason
 */

import { ProviderError, ProviderErrorCode } from './types.js';
import { SSEParser } from './sse-parser.js';
import type {
  LLMProvider,
  UnifiedMessage,
  ChatOptions,
  StreamChunk,
  ModelInfo,
} from './types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = 'https://api.openai.com';
const DEFAULT_MAX_TOKENS = 4096;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert our ToolDefinition to OpenAI's function-tool format */
function toolToOpenAI(tool: { name: string; description: string; input_schema: object }) {
  return {
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  };
}

/** Convert UnifiedMessage content to OpenAI format */
function convertContent(content: string | any[]): string | any[] | null {
  if (typeof content === 'string') {
    return content;
  }
  // ContentBlock[] — OpenAI only supports text and image_url
  const parts: any[] = [];
  for (const block of content) {
    if (block.type === 'text') {
      parts.push({ type: 'text', text: block.text });
    } else if (block.type === 'tool_use') {
      // tool_use in assistant messages
      parts.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input });
    } else if (block.type === 'tool_result') {
      // tool_result — should be tool messages, but defense
      parts.push({ type: 'tool_result', tool_use_id: block.tool_use_id, content: block.content });
    }
  }
  return parts.length > 0 ? parts : null;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export class OpenAIProvider implements LLMProvider {
  readonly providerName = 'openai';

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
  ) {}

  // ── Messages Builder ────────────────────────────────────────────────────

  buildRequest(
    messages: UnifiedMessage[],
    opts?: ChatOptions,
  ): {
    model: string;
    messages: Record<string, unknown>[];
    tools: Record<string, unknown>[];
    max_tokens: number;
    temperature: number;
    stream: boolean;
    stream_options: { include_usage: boolean };
  } {
    const converted = messages.map((m) => {
      const content = convertContent(m.content);
      // Check for base64 image in string content
      if (typeof m.content === 'string' && m.content.startsWith('data:image/')) {
        const match = m.content.match(/^data:(image\/[^;]+);base64,(.+)$/s);
        if (match) {
          return {
            role: m.role,
            content: [{
              type: 'image_url',
              image_url: { url: `data:${match[1]};base64,${match[2]}` },
            }],
          };
        }
      }
      return { role: m.role, content };
    });

    return {
      model: opts?.model ?? 'gpt-4o',
      messages: converted,
      tools: (opts?.tools ?? []).map(toolToOpenAI),
      max_tokens: opts?.max_tokens ?? DEFAULT_MAX_TOKENS,
      temperature: opts?.temperature ?? 0,
      stream: true,
      stream_options: { include_usage: true },
    };
  }

  // ── Stream Parser ───────────────────────────────────────────────────────

  async *chat(
    messages: UnifiedMessage[],
    opts?: ChatOptions,
  ): AsyncGenerator<StreamChunk> {
    const body = this.buildRequest(messages, opts);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: opts?.signal,
      });
    } catch (err: any) {
      throw new ProviderError(
        `Network error: ${err.message}`,
        ProviderErrorCode.NETWORK_ERROR,
      );
    }

    if (!response.ok) {
      throw await this.handleError(response);
    }

    if (!response.body) {
      throw new ProviderError(
        'Empty response body',
        ProviderErrorCode.UNKNOWN,
      );
    }

    const parser = new SSEParser();

    for await (const sseEvent of parser.parseStream(response.body)) {
      if (sseEvent.data === '[DONE]') {
        // End of stream — the last meaningful chunk already had finish_reason
        return;
      }

      const event = JSON.parse(sseEvent.data);
      const choice = event.choices?.[0];

      if (!choice) continue;

      // Text delta
      if (choice.delta?.content) {
        yield { type: 'text_delta', data: choice.delta.content };
      }

      // Tool calls — incremental via index
      if (choice.delta?.tool_calls) {
        for (const tc of choice.delta.tool_calls) {
          const index = tc.index ?? 0;

          // First chunk for a tool call has id and name
          if (tc.id && tc.function?.name) {
            yield {
              type: 'tool_call',
              data: { id: tc.id, name: tc.function.name },
            };
          }

          // All chunks carry argument fragments
          if (tc.function?.arguments) {
            yield {
              type: 'tool_input',
              data: {
                identifier: String(index),
                arguments: tc.function.arguments,
              },
            };
          }
        }
      }

      // Terminal chunk: finish_reason + usage
      if (choice.finish_reason) {
        yield {
          type: 'stop',
          stop_reason: choice.finish_reason,
          usage: event.usage
            ? {
                input_tokens: event.usage.prompt_tokens,
                output_tokens: event.usage.completion_tokens,
              }
            : undefined,
        };
      }
    }
  }

  // ── Error Handling ──────────────────────────────────────────────────────

  private async handleError(response: Response): Promise<ProviderError> {
    let body: any = {};
    try {
      body = await response.json();
    } catch { /* ignore parse errors */ }

    const message = body?.error?.message ?? `HTTP ${response.status}`;

    switch (response.status) {
      case 401:
        return new ProviderError(message, ProviderErrorCode.AUTH_ERROR, response.status);
      case 429: {
        const resetRequests = response.headers.get('x-ratelimit-reset-requests');
        const retryAfter = response.headers.get('Retry-After');
        const delay = resetRequests ?? retryAfter;
        return new ProviderError(
          message,
          ProviderErrorCode.RATE_LIMITED,
          response.status,
          delay ? parseFloat(delay) * 1000 : undefined,
        );
      }
      case 400:
        return new ProviderError(message, ProviderErrorCode.INVALID_REQUEST, response.status);
      default:
        if (response.status >= 500) {
          return new ProviderError(message, ProviderErrorCode.SERVER_ERROR, response.status);
        }
        return new ProviderError(message, ProviderErrorCode.UNKNOWN, response.status);
    }
  }

  // ── Model Listing ───────────────────────────────────────────────────────

  async listModels(): Promise<ModelInfo[]> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });

      if (!res.ok) return [];

      const data = (await res.json()) as any;
      return (data.data ?? []).map((m: any) => ({
        id: `openai:${m.id}`,
        display_name: m.id,
      }));
    } catch {
      return [];
    }
  }
}
