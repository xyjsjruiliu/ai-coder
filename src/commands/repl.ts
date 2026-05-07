/**
 * REPL mode — interactive agent loop with terminal UI.
 */

interface ReplOptions {
  model: string;
  provider: string;
  maxTurns: number;
  verbose: boolean;
  continue: boolean;
  [key: string]: unknown;
}

export async function runReplMode(opts: ReplOptions): Promise<void> {
  console.log(`[repl] Starting with model=${opts.model} provider=${opts.provider}`);
  console.log('[repl] Mode not yet implemented — coming in Phase 1E.');
  process.exit(0);
}
