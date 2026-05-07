/**
 * Tests for Token estimation utility.
 */

import { describe, it, expect } from 'vitest';
import { estimateTokens, estimateMessageTokens } from '../../src/utils/tokenizer.js';

describe('tokenizer', () => {
  it('should estimate tokens based on character count', () => {
    expect(estimateTokens('hello')).toBe(2);
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a'.repeat(40))).toBe(10);
  });

  it('should estimate message tokens', () => {
    const msgs = [
      { content: 'hello world' },
      { content: 'goodbye' },
    ];
    const tokens = estimateMessageTokens(msgs);
    expect(tokens).toBeGreaterThan(0);
  });

  it('should handle object content', () => {
    const msgs = [
      { content: { type: 'text', text: 'hello' } },
    ];
    const tokens = estimateMessageTokens(msgs);
    expect(tokens).toBeGreaterThan(0);
  });
});
