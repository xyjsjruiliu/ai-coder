/**
 * Agent Loop — the core orchestration engine.
 *
 * Drives the conversation: user input → LLM call → tool execution → repeat.
 * Handles max turn limit, abort signals, and error recovery.
 */

import type { LLMProvider, UnifiedMessage, StreamChunk, ToolDefinition, ContentBlock } from '../llm/types.js';
import { ToolRegistry } from '../tools/registry.js';
import { log } from '../utils/logger.js';

export interface AgentConfig {
  maxTurns: number;
  systemPrompt: string;
  tools?: ToolDefinition[];
  signal?: AbortSignal;
}

export interface AgentState {
  messages: UnifiedMessage[];
  turns: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  isComplete: boolean;
}

export class AgentLoop {
  private provider: LLMProvider;
  private toolRegistry: ToolRegistry;
  private config: AgentConfig;
  private state: AgentState;

  constructor(provider: LLMProvider, toolRegistry: ToolRegistry, config: AgentConfig) {
    this.provider = provider;
    this.toolRegistry = toolRegistry;
    this.config = config;
    this.state = {
      messages: [],
      turns: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      isComplete: false,
    };
  }

  getState(): Readonly<AgentState> {
    return this.state;
  }

  /** Add a user message and start the turn loop */
  async *run(userInput: string): AsyncGenerator<StreamChunk> {
    this.state.messages.push({ role: 'user', content: userInput });

    while (this.state.turns < this.config.maxTurns && !this.state.isComplete) {
      this.state.turns++;

      const toolCallsThisTurn: Array<{ id: string; name: string; input: string }> = [];
      let currentToolCall: { id?: string; name?: string; inputFragments: string[] } | null = null;
      let assistantContent = '';

      try {
        for await (const chunk of this.provider.chat(this.state.messages, {
          system: this.config.systemPrompt,
          tools: this.config.tools,
          signal: this.config.signal,
        })) {
          yield chunk;

          switch (chunk.type) {
            case 'text_delta':
              assistantContent += chunk.data;
              break;

            case 'tool_call':
              if (currentToolCall) {
                toolCallsThisTurn.push({
                  id: currentToolCall.id!,
                  name: currentToolCall.name!,
                  input: currentToolCall.inputFragments.join(''),
                });
              }
              currentToolCall = {
                id: chunk.data.id,
                name: chunk.data.name,
                inputFragments: [],
              };
              break;

            case 'tool_input':
              if (currentToolCall) {
                currentToolCall.inputFragments.push(chunk.data.arguments);
              }
              break;

            case 'stop':
              if (currentToolCall?.id) {
                toolCallsThisTurn.push({
                  id: currentToolCall.id,
                  name: currentToolCall.name!,
                  input: currentToolCall.inputFragments.join(''),
                });
              }
              if (chunk.usage) {
                this.state.totalInputTokens += chunk.usage.input_tokens;
                this.state.totalOutputTokens += chunk.usage.output_tokens;
              }
              break;

            default:
              break;
          }
        }
      } catch (err) {
        log('error', `Agent turn ${this.state.turns} failed: ${(err as Error).message}`);
        yield {
          type: 'stop',
          stop_reason: 'error',
        };
        return;
      }

      // Build assistant message with content blocks
      const contentBlocks: ContentBlock[] = [];

      if (assistantContent) {
        contentBlocks.push({ type: 'text', text: assistantContent });
      }

      for (const tc of toolCallsThisTurn) {
        contentBlocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: this.parseToolInput(tc.input),
        });
      }

      this.state.messages.push({
        role: 'assistant',
        content: contentBlocks,
      });

      // Execute tools if any
      if (toolCallsThisTurn.length > 0) {
        for (const tc of toolCallsThisTurn) {
          const args = this.parseToolInput(tc.input);
          const result = await this.toolRegistry.execute(tc.name, args);

          this.state.messages.push({
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: tc.id,
                content: result,
              },
            ],
          });
        }
      } else {
        this.state.isComplete = true;
      }
    }
  }

  private parseToolInput(input: string): Record<string, unknown> {
    try {
      return JSON.parse(input);
    } catch {
      return { raw: input };
    }
  }
}
