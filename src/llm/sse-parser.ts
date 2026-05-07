/**
 * SSE (Server-Sent Events) line parser for streaming responses.
 *
 * Handles both Anthropic and OpenAI SSE formats:
 * - Anthropic: event: <type>\ndata: {json}
 * - OpenAI:   data: {json}  /  data: [DONE]
 */

/** Low-level SSE event from the raw stream */
export interface SSEEvent {
  event: string | null;
  data: string;
}

/**
 * Parse a ReadableStream of bytes into SSE events.
 * Lines not starting with "data:" or "event:" are silently ignored.
 */
export class SSEParser {
  private buffer = '';

  /** Feed a chunk of raw text and yield parsed events */
  *parseChunk(chunk: string): Generator<SSEEvent> {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    // Keep the last (potentially incomplete) line in the buffer
    this.buffer = lines.pop() ?? '';

    let currentEvent: string | null = null;

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();

      // Empty line = dispatch the event
      if (line === '') {
        if (currentEvent !== null) {
          // event: set but no data — skip
          currentEvent = null;
        }
        continue;
      }

      if (line.startsWith('event:')) {
        currentEvent = line.slice(6).trim();
        continue;
      }

      if (line.startsWith('data:')) {
        const data = line.slice(5).trim();
        if (data === '[DONE]') {
          // OpenAI stream termination signal
          // Yield it as a stop event to let caller handle cleanly
          yield { event: currentEvent ?? 'message', data: '[DONE]' };
          currentEvent = null;
          continue;
        }
        yield { event: currentEvent, data };
        currentEvent = null;
      }
    }
  }

  /** Parse a full ReadableStream (Node.js Web Streams) */
  async *parseStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<SSEEvent> {
    const decoder = new TextDecoder();
    const reader = stream.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        for (const event of this.parseChunk(text)) {
          yield event;
        }
      }
      // Flush remaining buffer
      const flushed = decoder.decode();
      if (flushed) {
        this.buffer += flushed;
      }
    } finally {
      reader.releaseLock();
    }
  }

  /** Reset internal buffer */
  reset(): void {
    this.buffer = '';
  }
}
