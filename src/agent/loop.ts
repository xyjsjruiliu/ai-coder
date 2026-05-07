/**
 * Agent Loop — the core orchestration engine.
 *
 * Drives the conversation: user input → LLM call → tool execution → repeat.
 * Handles max turn limit, abort signals, consecutive error recovery,
 * parallel tool execution, and cost estimation.
 */

import type {
  LLMProvider,
  UnifiedMessage,
  StreamChunk,
  ToolDefinition,
  ContentBlock,
} from '../llm/types.js';
import { ToolRegistry } from '../tools/registry.js';
import { log } from '../utils/logger.js';
import { estimateMessageTokens } from '../utils/tokenizer.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentConfig {
  /** Maximum conversation turns before auto-stop */
  maxTurns: number;
  /** System prompt injected each turn */
  systemPrompt: string;
  /** Tools available to the LLM */
  tools?: ToolDefinition[];
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Max consecutive errors before aborting (default: 3) */
  maxConsecutiveErrors?: number;
  /** Max tool calls per turn (default: 10) */
  maxToolCallsPerTurn?: number;
  /** Debug mode — logs additional info to stderr */
  debug?: boolean;
}

export interface AgentState {
  messages: UnifiedMessage[];
  turns: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  isComplete: boolean;
  /** Tokens consumed in the most recent turn */
  lastTurnTokens: { input: number; output: number } | null;
  /** Error that caused abort (if any) */
  abortError: string | null;
}

// ─── Cost Estimates (approximate, per 1M tokens) ──────────────────────────────

const COST_PER_1M: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
  'claude-sonnet-3-5': { input: 3.0, output: 15.0 },
  'claude-haiku-3-5': { input: 0.8, output: 4.0 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates = COST_PER_1M[model];
  if (!rates) return 0;
  return (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;
}

function formatCost(cost: number): string {
  if (cost === 0) return '';
  return `≈$${cost.toFixed(4)}`;
}

// ─── AgentLoop ─────────────────────────────────────────────────────────────────

export class AgentLoop {
  private provider: LLMProvider;
  private toolRegistry: ToolRegistry;
  config: Required<AgentConfig>;
  state: AgentState;
  private model: string;
  private consecutiveErrors = 0;

  constructor(
    provider: LLMProvider,
    toolRegistry: ToolRegistry,
    model: string,
    config: AgentConfig,
  ) {
    this.provider = provider;
    this.toolRegistry = toolRegistry;
    this.model = model;
    this.config = {
      maxTurns: config.maxTurns,
      systemPrompt: config.systemPrompt,
      tools: config.tools ?? (this.toolRegistry.getDefinitions() as ToolDefinition[]),
      signal: config.signal ?? new AbortController().signal,
      maxConsecutiveErrors: config.maxConsecutiveErrors ?? 3,
      maxToolCallsPerTurn: config.maxToolCallsPerTurn ?? 10,
      debug: config.debug ?? false,
    };
    this.state = {
      messages: [],
      turns: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
      isComplete: false,
      lastTurnTokens: null,
      abortError: null,
    };
  }

  getState(): Readonly<AgentState> {
    return this.state;
  }

  /** Get the underlying ToolRegistry (for listing available tools) */
  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  /** Add raw messages to history (e.g. from session restore) */
  addMessages(messages: UnifiedMessage[]): void {
    this.state.messages.push(...messages);
  }

  /**
   * Add a user message and start the turn loop.
   * Yields stream chunks for UI consumption.
   *
   * @param userInput  The user's query
   * @param signal     Optional per-invocation AbortSignal (overrides config.signal for this run)
   */
  async *run(
    userInput: string,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamChunk & { _meta?: { turn: number } }> {
    // Save and override signal for this invocation
    const previousSignal = this.config.signal;
    if (signal) {
      this.config.signal = signal;
    }

    try {
      this.state.messages.push({ role: 'user', content: userInput });
      this.state.isComplete = false;

      while (
        this.state.turns < this.config.maxTurns &&
        !this.state.isComplete &&
        this.consecutiveErrors < this.config.maxConsecutiveErrors
      ) {
        // Check abort signal before each turn
        if (this.config.signal.aborted) {
          log('info', 'Agent aborted by signal before turn');
          this.state.abortError = 'Cancelled by user';
          yield {
            type: 'stop',
            stop_reason: 'cancelled',
            _meta: { turn: this.state.turns },
          } as any;
          return;
        }

        this.state.turns++;
        const turnTokens = { input: 0, output: 0 };
        this.state.lastTurnTokens = null;

        // ── 1. Build tool definitions for this turn ──────────────────────
        const toolDefs = this.config.tools;

        // ── 2. Stream LLM response ───────────────────────────────────────
        const turnToolCalls: Array<{
          id: string;
          name: string;
          input: Record<string, unknown>;
          rawInput: string;
        }> = [];
        let currentToolCall: {
          id: string;
          name: string;
          inputFragments: string[];
        } | null = null;
        let assistantContent = '';

        let turnSucceeded = false;

        try {
          for await (const chunk of this.provider.chat(this.state.messages, {
            system: this.config.systemPrompt,
            tools: toolDefs,
            signal: this.config.signal,
            model: this.model,
          })) {
            // Tag chunk with turn number for UI consumers
            yield { ...chunk, _meta: { turn: this.state.turns } };

            switch (chunk.type) {
              case 'text_delta':
                assistantContent += chunk.data;
                break;

              case 'tool_call':
                // Finalize previous tool call if any
                if (currentToolCall?.id) {
                  turnToolCalls.push({
                    id: currentToolCall.id,
                    name: currentToolCall.name,
                    rawInput: currentToolCall.inputFragments.join(''),
                    input: safeParseJSON(currentToolCall.inputFragments.join('')),
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
                  currentToolCall.inputFragments.push(chunk.data.arguments || '');
                }
                break;

              case 'stop':
                // Finalize pending tool call
                if (currentToolCall?.id) {
                  turnToolCalls.push({
                    id: currentToolCall.id,
                    name: currentToolCall.name,
                    rawInput: currentToolCall.inputFragments.join(''),
                    input: safeParseJSON(currentToolCall.inputFragments.join('')),
                  });
                  currentToolCall = null;
                }
                if (chunk.usage) {
                  turnTokens.input = chunk.usage.input_tokens ?? 0;
                  turnTokens.output = chunk.usage.output_tokens ?? 0;
                  this.state.totalInputTokens += turnTokens.input;
                  this.state.totalOutputTokens += turnTokens.output;
                  const cost = estimateCost(this.model, turnTokens.input, turnTokens.output);
                  this.state.totalCost += cost;
                  this.state.lastTurnTokens = {
                    input: turnTokens.input,
                    output: turnTokens.output,
                  };
                }
                break;

              default:
                break;
            }
          }

          turnSucceeded = true;
          this.consecutiveErrors = 0;

          // Check if aborted during the stream (e.g. mock providers
          // that don't throw AbortError)
          if (this.config.signal.aborted) {
            log('info', 'Agent aborted by signal after provider returned');
            this.state.abortError = 'Cancelled by user';
            yield {
              type: 'stop',
              stop_reason: 'cancelled',
              _meta: { turn: this.state.turns },
            } as any;
            return;
          }
        } catch (err: any) {
          this.consecutiveErrors++;

          if (err.name === 'AbortError' || this.config.signal?.aborted) {
            log('info', 'Agent aborted by signal');
            this.state.abortError = 'Cancelled by user';
            yield {
              type: 'stop',
              stop_reason: 'cancelled',
              _meta: { turn: this.state.turns },
            } as any;
            return;
          }

          log(
            'error',
            `Agent turn ${this.state.turns} failed (${this.consecutiveErrors}/${this.config.maxConsecutiveErrors}): ${err.message}`,
          );

          if (this.consecutiveErrors >= this.config.maxConsecutiveErrors) {
            this.state.abortError = `Aborted after ${this.consecutiveErrors} consecutive errors: ${err.message}`;
            yield {
              type: 'stop',
              stop_reason: 'error',
              _meta: { turn: this.state.turns },
            } as any;
            return;
          }

          // Partial fail — yield a warning and continue
          yield {
            type: 'stop',
            stop_reason: `turn_error: ${err.message}`,
            _meta: { turn: this.state.turns },
          } as any;
        }

        if (!turnSucceeded && this.consecutiveErrors > 0) {
          // Don't push anything if the turn failed completely.
          // Break out — caller decides whether to retry via another run().
          break;
        }

        // ── 3. Build assistant message ────────────────────────────────────
        const contentBlocks: ContentBlock[] = [];

        if (assistantContent) {
          contentBlocks.push({ type: 'text', text: assistantContent });
        }

        // Enforce tool-call limit
        const callsToExecute = turnToolCalls.slice(0, this.config.maxToolCallsPerTurn);

        for (const tc of callsToExecute) {
          contentBlocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.input,
          });
        }

        // Handle empty response (no text, no tools)
        if (contentBlocks.length === 0) {
          contentBlocks.push({
            type: 'text',
            text: '(No response — the model did not produce any output for this turn.)',
          });
        }

        if (this.config.debug) {
          process.stderr.write(
            `[debug:loop] turn=${this.state.turns} text=${assistantContent.length}c tools=${callsToExecute.length}\n`,
          );
        }

        this.state.messages.push({
          role: 'assistant',
          content: contentBlocks,
        });

        // ── 4. Execute tools (parallel if >1) ─────────────────────────────
        if (callsToExecute.length > 0) {
          const toolResults: UnifiedMessage[] = [];

          if (callsToExecute.length === 1) {
            // Single tool — serialize
            const tc = callsToExecute[0];
            const result = await this.toolRegistry.execute(tc.name, tc.input);
            toolResults.push({
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: tc.id,
                  content: result,
                },
              ],
            });
          } else {
            // Multiple tools — execute in parallel
            const results = await Promise.all(
              callsToExecute.map((tc) =>
                this.toolRegistry.execute(tc.name, tc.input).then((result) => ({
                  role: 'user' as const,
                  content: [
                    {
                      type: 'tool_result' as const,
                      tool_use_id: tc.id,
                      content: result,
                    },
                  ],
                })),
              ),
            );
            toolResults.push(...results);
          }

          this.state.messages.push(...toolResults);

          if (this.config.debug) {
            const summary = toolResults
              .map((m) => {
                const block = (m.content as ContentBlock[])[0];
                const preview = ('content' in block ? String(block.content) : '').slice(0, 60);
                return `  ${'tool_use_id' in block ? block.tool_use_id : '?'}: ${preview}`;
              })
              .join('\n');
            process.stderr.write(`[debug:loop] tools executed:\n${summary}\n`);
          }

          // Yield tool_result chunks for UI consumers
          for (const msg of toolResults) {
            yield {
              type: 'tool_input' as any,
              data: JSON.stringify(msg),
              _meta: { turn: this.state.turns },
            };
          }

          // Continue loop for another turn
        } else {
          // No tools → conversation complete
          this.state.isComplete = true;
        }
      }

      // Final stop event
      yield {
        type: 'stop',
        usage: {
          input_tokens: this.state.totalInputTokens,
          output_tokens: this.state.totalOutputTokens,
        },
        stop_reason: this.state.abortError
          ? `aborted: ${this.state.abortError}`
          : this.state.turns >= this.config.maxTurns
            ? 'max_turns'
            : 'complete',
        _meta: { turn: this.state.turns },
      } as any;
    } finally {
      // Restore original signal
      this.config.signal = previousSignal;
    }
  }

  /** Reset agent state for a fresh conversation */
  reset(): void {
    this.state = {
      messages: [],
      turns: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
      isComplete: false,
      lastTurnTokens: null,
      abortError: null,
    };
    this.consecutiveErrors = 0;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeParseJSON(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    return { _raw: raw };
  }
}
