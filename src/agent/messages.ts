/**
 * Message manager — tracks, truncates, and manages conversation history.
 *
 * Responsible for:
 * - Message storage and retrieval
 * - Token-aware truncation strategies
 * - Context window management
 */

import { UnifiedMessage } from '../llm/types.js';
import { estimateMessageTokens } from '../utils/tokenizer.js';

export interface MessageManagerConfig {
  maxContextTokens: number;
  reserveOutputTokens: number;
}

const DEFAULT_CONFIG: MessageManagerConfig = {
  maxContextTokens: 180_000, // default for Claude
  reserveOutputTokens: 20_000,
};

export class MessageManager {
  private messages: UnifiedMessage[] = [];
  private config: MessageManagerConfig;

  constructor(config: Partial<MessageManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Add a message to history */
  add(message: UnifiedMessage): void {
    this.messages.push(message);
  }

  /** Add multiple messages */
  addAll(messages: UnifiedMessage[]): void {
    this.messages.push(...messages);
  }

  /** Get all messages (possibly truncated) */
  getAll(): UnifiedMessage[] {
    return this.messages;
  }

  /** Total estimated token count */
  getTokenCount(): number {
    return estimateMessageTokens(this.messages);
  }

  /** Available context budget remaining */
  getAvailableBudget(): number {
    return this.config.maxContextTokens - this.getTokenCount() - this.config.reserveOutputTokens;
  }

  /**
   * Truncate messages to fit within context window.
   * Simple strategy: keep system prompt + last N messages.
   */
  fitToWindow(): void {
    const budget = this.config.maxContextTokens - this.config.reserveOutputTokens;
    if (estimateMessageTokens(this.messages) <= budget) return;

    // Find system messages (always preserve)
    const systemMsgs = this.messages.filter((m) => m.role === 'system');

    // Remove oldest non-system messages until we fit
    while (estimateMessageTokens(this.messages) > budget && this.messages.length > systemMsgs.length) {
      // Find first non-system message to remove
      const idx = this.messages.findIndex((m) => m.role !== 'system');
      if (idx === -1) break;
      this.messages.splice(idx, 1);
    }
  }

  /** Clear all messages */
  clear(): void {
    this.messages = [];
  }

  /** Number of messages */
  get length(): number {
    return this.messages.length;
  }
}
