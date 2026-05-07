/**
 * Tests: SSEParser (sse-parser.ts)
 *
 * Covers:
 * - Anthropic SSE: event + data lines, empty-line dispatch
 * - OpenAI SSE: data-only lines, [DONE] termination
 * - Mixed formats, partial chunk handling, buffer flushing
 * - Empty input, whitespace, corrupted input
 * - reset() behavior
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SSEParser } from '../../src/llm/sse-parser.js';

describe('SSEParser', () => {
  let parser: SSEParser;

  beforeEach(() => {
    parser = new SSEParser();
  });

  // ─── Anthropic Format ────────────────────────────────────────────────────

  describe('Anthropic SSE format', () => {
    it('should parse event + data lines', () => {
      const events = [...parser.parseChunk(
        'event: content_block_start\ndata: {"type":"text","index":0}\n\n',
      )];

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        event: 'content_block_start',
        data: '{"type":"text","index":0}',
      });
    });

    it('should parse data-only lines (no event field)', () => {
      const events = [...parser.parseChunk(
        'data: {"type":"ping"}\n\n',
      )];

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        event: null,
        data: '{"type":"ping"}',
      });
    });

    it('should parse multiple events in one chunk', () => {
      const events = [...parser.parseChunk(
        'event: message_start\ndata: {"type":"message_start"}\n\n' +
        'event: content_block_start\ndata: {"type":"text","index":0}\n\n' +
        'event: content_block_delta\ndata: {"type":"text_delta","text":"Hello"}\n\n',
      )];

      expect(events).toHaveLength(3);
      expect(events[0].event).toBe('message_start');
      expect(events[1].event).toBe('content_block_start');
      expect(events[2].event).toBe('content_block_delta');
      expect(events[2].data).toContain('Hello');
    });

    it('should handle event without data (skip)', () => {
      const events = [...parser.parseChunk(
        'event: ping\n\n' +
        'data: {"type":"real"}\n\n',
      )];

      expect(events).toHaveLength(1);
      expect(events[0].event).toBeNull();
      expect(events[0].data).toBe('{"type":"real"}');
    });
  });

  // ─── OpenAI Format ───────────────────────────────────────────────────────

  describe('OpenAI SSE format', () => {
    it('should parse data-only lines', () => {
      const events = [...parser.parseChunk(
        'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
      )];

      expect(events).toHaveLength(1);
      expect(events[0].data).toContain('"delta"');
    });

    it('should parse [DONE] termination signal', () => {
      const events = [...parser.parseChunk('data: [DONE]\n\n')];

      expect(events).toHaveLength(1);
      expect(events[0].data).toBe('[DONE]');
    });

    it('should parse content delta after [DONE]', () => {
      // [DONE] appears, but more data follows (defensive test)
      const events = [...parser.parseChunk(
        'data: {"text":"before"}\n\ndata: [DONE]\n\ndata: {"text":"after"}\n\n',
      )];

      expect(events.length).toBeGreaterThanOrEqual(2);
      const doneEvent = events.find(e => e.data === '[DONE]');
      expect(doneEvent).toBeDefined();
    });

    it('should parse chunked OpenAI content deltas', () => {
      const events = [...parser.parseChunk(
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":" World"}}]}\n\n' +
        'data: {"choices":[{"finish_reason":"stop"}]}\n\n' +
        'data: [DONE]\n\n',
      )];

      const contentEvents = events.filter(e => e.data !== '[DONE]');
      expect(contentEvents).toHaveLength(3);
      expect(contentEvents[0].data).toContain('Hello');
      expect(contentEvents[1].data).toContain('World');
      expect(contentEvents[2].data).toContain('stop');
    });
  });

  // ─── Partial Chunk Handling ──────────────────────────────────────────────

  describe('partial chunk handling (streaming)', () => {
    it('should buffer incomplete lines and yield on next chunk', () => {
      // First chunk: incomplete — no newline at end of data
      const batch1 = [...parser.parseChunk('data: {"t')];
      expect(batch1).toHaveLength(0);

      // Second chunk: completion + empty line dispatch
      const batch2 = [...parser.parseChunk('ext":"hello"}\n\n')];
      expect(batch2).toHaveLength(1);
      expect(batch2[0].data).toBe('{"text":"hello"}');
    });

    it('should handle complete data line (eager yield)', () => {
      // SSE parser yields eagerly on complete data: lines (no wait for \n\n)
      const events = [...parser.parseChunk('data: {"type":"msg"}\n\n')];
      expect(events).toHaveLength(1);
      expect(events[0].data).toBe('{"type":"msg"}');
    });

    it('should handle single-character chunks', () => {
      const text = 'data: {"x":1}\n\n';
      let allEvents: any[] = [];

      for (const ch of text) {
        allEvents = allEvents.concat([...parser.parseChunk(ch)]);
      }

      expect(allEvents).toHaveLength(1);
      expect(allEvents[0].data).toBe('{"x":1}');
    });

    it('should accumulate across 3 chunks', () => {
      [...parser.parseChunk('data: {"first"')];
      [...parser.parseChunk(': "part')];
      const final = [...parser.parseChunk('1"}\n\ndata: {"second":"part2"}\n\n')];

      expect(final).toHaveLength(2);
      expect(final[0].data).toBe('{"first": "part1"}');
      expect(final[1].data).toBe('{"second":"part2"}');
    });
  });

  // ─── Edge Cases ──────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle empty input', () => {
      const events = [...parser.parseChunk('')];
      expect(events).toHaveLength(0);
    });

    it('should handle only newlines', () => {
      const events = [...parser.parseChunk('\n\n\n')];
      expect(events).toHaveLength(0);
    });

    it('should handle whitespace-only chunks', () => {
      const events = [...parser.parseChunk('   \n  \n  ')];
      expect(events).toHaveLength(0);
    });

    it('should handle trailing whitespace on data line', () => {
      const events = [...parser.parseChunk('data: {"x":1}   \n\n')];
      expect(events).toHaveLength(1);
      expect(events[0].data).toBe('{"x":1}');
    });

    it('should handle non-SSE garbage lines', () => {
      const events = [...parser.parseChunk(
        'HTTP/1.1 200 OK\n' +
        'Content-Type: text/event-stream\n' +
        '\n' +
        'data: {"real":"yes"}\n\n',
      )];

      expect(events).toHaveLength(1);
      expect(events[0].data).toBe('{"real":"yes"}');
    });

    it('should handle empty data field', () => {
      const events = [...parser.parseChunk('data:\n\n')];
      expect(events).toHaveLength(1);
      expect(events[0].data).toBe('');
    });

    it('should handle event field with special characters', () => {
      const events = [...parser.parseChunk(
        'event: my-event.name\ndata: {"x":1}\n\n',
      )];
      expect(events).toHaveLength(1);
      expect(events[0].event).toBe('my-event.name');
    });
  });

  // ─── reset() ─────────────────────────────────────────────────────────────

  describe('reset()', () => {
    it('should clear the internal buffer', () => {
      // Feed a partial line with no newline to leave data in buffer
      parser.parseChunk('data: {"partial"}');
      parser.reset();

      // After reset, new data should yield fresh (not concatenated with old)
      const events = [...parser.parseChunk('data: {"fresh"}\n\n')];
      expect(events).toHaveLength(1);
      expect(events[0].data).toBe('{"fresh"}');
    });

    it('should work after reset+new parse', () => {
      // Full event before reset
      let events = [...parser.parseChunk('data: {"first":1}\n\n')];
      expect(events).toHaveLength(1);

      parser.reset();
      events = [...parser.parseChunk('data: {"second":2}\n\n')];
      expect(events).toHaveLength(1);
      expect(events[0].data).toBe('{"second":2}');
    });
  });

  // ─── Stress Tests ────────────────────────────────────────────────────────

  describe('stress / volume', () => {
    it('should parse 1000 events without corruption', () => {
      let input = '';
      for (let i = 0; i < 1000; i++) {
        input += `event: msg_${i}\ndata: {"index":${i}}\n\n`;
      }

      const events = [...parser.parseChunk(input)];
      expect(events).toHaveLength(1000);
      expect(events[0].event).toBe('msg_0');
      expect(events[499].event).toBe('msg_499');
      expect(events[999].event).toBe('msg_999');
    });
  });

  // ─── [DONE] Edge Cases ───────────────────────────────────────────────────

  describe('[DONE] edge cases', () => {
    it('should yield [DONE] from data line', () => {
      const events = [...parser.parseChunk('data: [DONE]\n\n')];
      expect(events).toHaveLength(1);
      expect(events[0].data).toBe('[DONE]');
    });

    it('should not confuse [DONE] inside JSON data', () => {
      const events = [...parser.parseChunk(
        'data: {"text":"[DONE] is sentinel"}\n\n',
      )];
      expect(events).toHaveLength(1);
      expect(events[0].data).toBe('{"text":"[DONE] is sentinel"}');
    });
  });
});
