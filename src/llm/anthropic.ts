/**
 * Anthropic Provider Adapter.
 *
 * Endpoint: POST {baseUrl}/v1/messages
 * Headers:  x-api-key, anthropic-version: 2023-06-01
 *
 * Key differences from OpenAI:
 * - System prompt is a top-level `system` field, not a message
 * - Tools use Anthropic's tool_use format (not function type)
 * - Content blocks: text, tool_use, tool_result
 * - Streaming events: message_start, content_block_start, content_block_delta,
 *   content_block_stop, message_delta, message_stop
 */

import { ProviderError, ProviderErrorCode } from './types.js';
import { SSEParser } from './sse-parser.js';
import type {
  LLMProvider,
  UnifiedMessage,
  ChatOptions,
  StreamChunk,
  ModelInfo,
  ContentBlock,
} from './types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_MAX_TOKENS = 4096;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function textContent(text: string): ContentBlock {
  return { type: 'text', text };
}

function toolUseBlock(id: string, name: string, input: Record<string, unknown>): ContentBlock {
  return { type: 'tool_use', id, name, input };
}

/** Convert Anthropic's image source format to our ContentBlock */
function imageContent(data: string, mediaType: string): ContentBlock {
  return {
    type: 'text',
    text: `[image: ${mediaType}, ${data.length} bytes]`,
  };
}

/** Convert our ToolDefinition to Anthropic's expected schema */
function toolToAnthropic(tool: { name: string; description: string; input_schema: object }) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
  };
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export class AnthropicProvider implements LLMProvider {
  readonly providerName = 'anthropic';

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
  ) {}

  // ── Messages Builder ────────────────────────────────────────────────────

  /**
   * Convert UnifiedMessage[] to Anthropic API format.
   * Returns { system, messages } — system is extracted from role:system messages.
   */
  buildRequest(
    messages: UnifiedMessage[],
    opts?: ChatOptions,
  ): {
    model: string;
    system: string;
    messages: Record<string, unknown>[];
    tools: Record<string, unknown>[];
    max_tokens: number;
    temperature: number;
    stream: boolean;
  } {
    let systemText = opts?.system ?? '';

    const converted = messages.map((m) => {
      if (m.role === 'system') {
        systemText += (systemText ? '\n\n' : '') + (typeof m.content === 'string' ? m.content : '');
        return null; // marked for removal
      }

      if (typeof m.content === 'string') {
        // Check for image content
        const imgMatch = m.content.match(/^data:(image\/[^;]+);base64,(.+)$/s);
        if (imgMatch) {
          return {
            role: m.role,
            content: [{
              type: 'image',
              source: {
                type: 'base64',
                media_type: imgMatch[1],
                data: imgMatch[2],
              },
            }],
          };
        }
        return { role: m.role, content: m.content };
      }

      // ContentBlock[]
      const content = m.content.map((block) => {
        switch (block.type) {
          case 'text':
            return { type: 'text', text: block.text };
          case 'tool_use':
            return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
          case 'tool_result':
            return {
              type: 'tool_result',
              tool_use_id: block.tool_use_id,
              content: block.is_error
                ? `Error: ${block.content}`
                : block.content,
            };
          case 'thinking':
            return { type: 'thinking', thinking: block.thinking };
          default:
            return { type: 'text', text: String(block) };
        }
      });

      return { role: m.role, content };
    });

    return {
      model: opts?.model ?? 'claude-sonnet-4-20250514',
      system: systemText,
      messages: converted.filter(Boolean) as Record<string, unknown>[],
      tools: (opts?.tools ?? []).map(toolToAnthropic),
      max_tokens: opts?.max_tokens ?? DEFAULT_MAX_TOKENS,
      temperature: opts?.temperature ?? 0,
      stream: true,
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
      response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
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
    let currentToolId: string | null = null;
    let currentToolName: string | null = null;

    for await (const sseEvent of parser.parseStream(response.body)) {
      // [DONE] signal shouldn't appear in Anthropic but handle defensively
      if (sseEvent.data === '[DONE]') continue;

      const event = JSON.parse(sseEvent.data);

      switch (event.type) {
        case 'message_start':
          // Contains initial usage info — not critical for Phase 1
          break;

        case 'content_block_start': {
          const block = event.content_block;
          if (block?.type === 'tool_use') {
            currentToolId = block.id;
            currentToolName = block.name;
            yield {
              type: 'tool_call',
              data: { id: block.id, name: block.name },
            };
          }
          break;
        }

        case 'content_block_delta': {
          const delta = event.delta;
          if (delta?.type === 'text_delta') {
            yield { type: 'text_delta', data: delta.text };
          } else if (delta?.type === 'input_json_delta') {
            yield {
              type: 'tool_input',
              data: {
                identifier: currentToolId!,
                arguments: delta.partial_json,
              },
            };
          } else if (delta?.type === 'thinking_delta') {
            yield { type: 'thinking_delta', data: delta.thinking };
          }
          break;
        }

        case 'content_block_stop':
          currentToolId = null;
          currentToolName = null;
          break;

        case 'message_delta':
          yield {
            type: 'stop',
            stop_reason: event.delta?.stop_reason ?? null,
            usage: event.usage
              ? {
                  input_tokens: event.usage.input_tokens,
                  output_tokens: event.usage.output_tokens,
                }
              : undefined,
          };
          break;

        case 'message_stop':
          // Final message, sometimes has additional usage
          break;

        case 'error':
          throw new ProviderError(
            event.error?.message ?? 'Anthropic API error',
            ProviderErrorCode.UNKNOWN,
          );
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
        const retryAfter = response.headers.get('Retry-After');
        return new ProviderError(
          message,
          ProviderErrorCode.RATE_LIMITED,
          response.status,
          retryAfter ? parseInt(retryAfter) * 1000 : undefined,
        );
      }
      case 529:
        return new ProviderError(message, ProviderErrorCode.OVERLOADED, response.status);
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
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
      });

      if (!res.ok) return [];

      const data = (await res.json()) as any;
      return (data.data ?? []).map((m: any) => ({
        id: `anthropic:${m.id}`,
        display_name: m.display_name ?? m.id,
      }));
    } catch {
      return [];
    }
  }
}
