/**
 * Token estimation utility.
 *
 * Uses a simple heuristic: ~4 chars per token for English text.
 * In Phase 2+, replace with tiktoken or similar for accurate counts.
 */

const CHARS_PER_TOKEN = 4;

/** Rough token count for a string */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Rough token count for a list of messages */
export function estimateMessageTokens(
  messages: Array<{ content: string | unknown }>
): number {
  let total = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      total += estimateTokens(msg.content);
    } else if (typeof msg.content === 'object') {
      total += estimateTokens(JSON.stringify(msg.content));
    }
  }
  return total;
}
