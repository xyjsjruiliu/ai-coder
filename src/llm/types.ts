// ─── Unified Content Blocks ───────────────────────────────────────────────────

export type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock
  | ThinkingBlock;

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature?: string;
}

// ─── Unified Messages ─────────────────────────────────────────────────────────

export interface UnifiedMessage {
  role: 'user' | 'assistant' | 'system';
  /** String for simple messages, ContentBlock[] for structured (tool calls etc.) */
  content: string | ContentBlock[];
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required?: string[];
  };
}

// ─── Streaming Types ──────────────────────────────────────────────────────────

export type StreamChunkType =
  | 'text_delta'
  | 'tool_call'
  | 'tool_input'
  | 'thinking_delta'
  | 'stop';

export interface TextDelta {
  type: 'text_delta';
  data: string;
}

export interface ToolCallDelta {
  type: 'tool_call';
  data: {
    id: string;
    name: string;
  };
}

export interface ToolInputDelta {
  type: 'tool_input';
  data: {
    /** OpenAI uses index, Anthropic uses id */
    identifier: string;
    arguments: string;
  };
}

export interface ThinkingDelta {
  type: 'thinking_delta';
  data: string;
}

export interface StopChunk {
  type: 'stop';
  stop_reason: string | null;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export type StreamChunk =
  | TextDelta
  | ToolCallDelta
  | ToolInputDelta
  | ThinkingDelta
  | StopChunk;

// ─── Chat Options ─────────────────────────────────────────────────────────────

export interface ChatOptions {
  model?: string;
  max_tokens?: number;
  temperature?: number;
  tools?: ToolDefinition[];
  system?: string;
  signal?: AbortSignal;
}

// ─── Model Info ───────────────────────────────────────────────────────────────

export interface ModelInfo {
  id: string;
  display_name: string;
}

// ─── Provider Interface ───────────────────────────────────────────────────────

export interface LLMProvider {
  readonly providerName: string;

  /**
   * Send a chat request and yield StreamChunks.
   * Throws on non-retryable errors.
   */
  chat(
    messages: UnifiedMessage[],
    opts?: ChatOptions,
  ): AsyncGenerator<StreamChunk>;

  /**
   * Fetch available models from this provider.
   * Returns empty array for providers without a list endpoint.
   */
  listModels(): Promise<ModelInfo[]>;
}

// ─── Error Types ──────────────────────────────────────────────────────────────

export enum ProviderErrorCode {
  RATE_LIMITED = 'rate_limited',
  OVERLOADED = 'overloaded',
  AUTH_ERROR = 'auth_error',
  INVALID_REQUEST = 'invalid_request',
  SERVER_ERROR = 'server_error',
  NETWORK_ERROR = 'network_error',
  UNKNOWN = 'unknown',
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly code: ProviderErrorCode,
    public readonly status?: number,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }

  get isRetryable(): boolean {
    return (
      this.code === ProviderErrorCode.RATE_LIMITED ||
      this.code === ProviderErrorCode.OVERLOADED ||
      this.code === ProviderErrorCode.SERVER_ERROR ||
      this.code === ProviderErrorCode.NETWORK_ERROR
    );
  }
}
