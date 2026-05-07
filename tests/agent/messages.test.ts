/**
 * Tests for MessageManager.
 */

import { describe, it, expect } from 'vitest';
import { MessageManager } from '../../src/agent/messages.js';

describe('MessageManager', () => {
  it('should start empty', () => {
    const mm = new MessageManager();
    expect(mm.length).toBe(0);
  });

  it('should add messages', () => {
    const mm = new MessageManager();
    mm.add({ role: 'user', content: 'hello' });
    expect(mm.length).toBe(1);
  });

  it('should fit to window by removing non-system messages', () => {
    const mm = new MessageManager({ maxContextTokens: 100, reserveOutputTokens: 20 });
    mm.add({ role: 'system', content: 'You are a helper' });
    // Add many messages to force truncation
    for (let i = 0; i < 50; i++) {
      mm.add({ role: 'user', content: `message ${i}` });
    }

    mm.fitToWindow();
    // System message should still be there
    const msgs = mm.getAll();
    expect(msgs[0].role).toBe('system');
    // Should be fewer messages than before (truncated)
    expect(msgs.length).toBeLessThan(51);
  });
});
