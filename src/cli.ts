#!/usr/bin/env node
/**
 * AI Coder — CLI entry point
 *
 * Usage:
 *   ai-coder                  # Interactive REPL
 *   ai-coder -p "fix eslint"  # Single-shot mode
 *   ai-coder -c               # Resume last session
 */

import { Command } from 'commander';
import { readConfig } from './config/loader.js';
import { runPrintMode } from './commands/print.js';
import { runReplMode } from './commands/repl.js';

const program = new Command();

program
  .name('ai-coder')
  .description('AI-powered coding assistant in your terminal')
  .version('0.1.0')
  .option('-p, --print <query>', 'Single-shot mode, print result and exit')
  .option('-c, --continue', 'Resume last session')
  .option('-m, --model <name>', 'Model to use', 'claude-sonnet-4-20250514')
  .option('--provider <name>', 'LLM provider', 'anthropic')
  .option('--max-turns <n>', 'Max agent turns', '25')
  .option('--verbose', 'Verbose logging')
  .action(async (opts) => {
    const config = await readConfig(opts);
    const merged = { ...config.defaults, ...opts };

    if (merged.print) {
      await runPrintMode(merged);
    } else {
      await runReplMode(merged);
    }
  });

program.parse(process.argv);
