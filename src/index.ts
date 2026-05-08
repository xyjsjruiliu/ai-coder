/**
 * AI Coder — public library API.
 *
 * Import anything you need from 'ai-coder':
 *
 *   import { AnthropicProvider, AgentLoop, ToolRegistry } from 'ai-coder';
 */

// ── LLM Providers ──────────────────────────────────────────────────────────
export { AnthropicProvider } from './llm/anthropic.js';
export { OpenAIProvider } from './llm/openai.js';
export { ProviderFactory } from './llm/factory.js';
export { SSEParser } from './llm/sse-parser.js';
export { ProviderError, ProviderErrorCode } from './llm/types.js';

export type {
  LLMProvider,
  UnifiedMessage,
  StreamChunk,
  ToolDefinition,
  ContentBlock,
  ChatOptions,
  StopChunk,
  TextDelta,
  ToolCallDelta,
  ToolInputDelta,
} from './llm/types.js';

// ── Agent ──────────────────────────────────────────────────────────────────
export { AgentLoop } from './agent/loop.js';
export type { AgentConfig, AgentState } from './agent/loop.js';

// ── Tools ──────────────────────────────────────────────────────────────────
export { ToolRegistry } from './tools/registry.js';
export { readFileTool } from './tools/read_file.js';
export { writeFileTool } from './tools/write_file.js';
export { editFileTool } from './tools/edit_file.js';
export { bashTool } from './tools/bash.js';
export { webSearchTool } from './tools/web_search.js';
export { webFetchTool } from './tools/web_fetch.js';
export type { Tool, ToolContext, ToolResult } from './tools/types.js';

// ── Config ─────────────────────────────────────────────────────────────────
export { readConfig, resetConfigCache, ConfigSchema } from './config/loader.js';
export type { AICoderConfig, ProviderConfig } from './config/loader.js';
