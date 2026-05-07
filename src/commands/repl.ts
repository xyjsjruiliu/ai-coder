/**
 * REPL mode — interactive agent loop (text-only, no Ink UI yet).
 */

import * as readline from 'node:readline';
import { ProviderFactory } from '../llm/factory.js';
import type { LLMProvider, UnifiedMessage } from '../llm/types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReplOptions {
  model: string;
  provider: 'anthropic' | 'openai' | 'openrouter' | 'ollama';
  maxTurns: number;
  apiKey: string | null;
  continue: boolean;
  debug: boolean;
}

// ─── Provider Creation ────────────────────────────────────────────────────────

function createProvider(
  provider: 'anthropic' | 'openai' | 'openrouter' | 'ollama',
  apiKey: string | null,
  debug: boolean,
): LLMProvider {
  // Try env var — but only if it matches the requested provider type
  const envProvider = ProviderFactory.createFromEnv();
  if (envProvider) {
    if (envProvider.providerName === provider) {
      return envProvider;
    }
    if (debug) {
      process.stderr.write(`⚠  ENV has ${envProvider.providerName} key, requested ${provider} — skipping env\n`);
    }
  }

  // Explicit apiKey → use it
  if (apiKey) {
    return ProviderFactory.create({ provider, apiKey });
  }

  // Ollama → no apiKey needed, use default localhost
  if (provider === 'ollama') {
    return ProviderFactory.create({ provider: 'ollama', apiKey: 'ollama' });
  }

  throw new Error(
    'No API key found.\n' +
    'Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY.',
  );
}

// ─── Help Text ────────────────────────────────────────────────────────────────

function printWelcome(model: string, provider: string): void {
  const lines = [
    `\n🤖 AI Coder v0.1.0  |  ${provider}:${model}`,
    '',
    'Type a query and press Enter. Special commands:',
    '  /help          show this message',
    '  /model <id>    switch model',
    '  /clear         clear conversation history',
    '  /debug         toggle debug mode',
    '  /exit          quit (or Ctrl+C / Ctrl+D)',
    '',
  ];
  process.stdout.write(lines.join('\n'));
}

// ─── Main REPL Loop ───────────────────────────────────────────────────────────

export async function runReplMode(opts: ReplOptions): Promise<void> {
  let provider: LLMProvider;
  try {
    provider = createProvider(opts.provider, opts.apiKey, opts.debug);
  } catch (err: any) {
    process.stderr.write(`❌ ${err.message}\n`);
    process.exit(1);
  }

  let model = opts.model;
  let debug = opts.debug;
  let messages: UnifiedMessage[] = [];
  let running = true;

  printWelcome(model, provider.providerName);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '▸ ',
    terminal: true,
  });

  rl.prompt();

  // ── Input Handler ───────────────────────────────────────────────────────

  rl.on('line', async (line: string) => {
    const trimmed = line.trim();

    // ── Special commands ──────────────────────────────────────────────────
    if (trimmed.startsWith('/')) {
      const [cmd, ...args] = trimmed.slice(1).split(/\s+/);

      switch (cmd.toLowerCase()) {
        case 'exit':
        case 'quit':
        case 'q':
          process.stdout.write('Goodbye! 👋\n');
          rl.close();
          running = false;
          return;

        case 'help':
        case 'h':
          printWelcome(model, provider.providerName);
          rl.prompt();
          return;

        case 'clear':
          messages = [];
          process.stdout.write('Conversation cleared.\n');
          rl.prompt();
          return;

        case 'model':
        case 'm': {
          if (args.length === 0) {
            process.stdout.write(`Current model: ${model}\n`);
          } else {
            model = args[0];
            process.stdout.write(`Switched to model: ${model}\n`);
          }
          rl.prompt();
          return;
        }

        case 'debug':
        case 'd':
          debug = !debug;
          process.stdout.write(`Debug mode: ${debug ? 'ON' : 'OFF'}\n`);
          rl.prompt();
          return;

        default:
          process.stdout.write(`Unknown command: /${cmd}. Type /help for available commands.\n`);
          rl.prompt();
          return;
      }
    }

    if (!trimmed) {
      rl.prompt();
      return;
    }

    messages.push({ role: 'user', content: trimmed });
    rl.pause();

    try {
      const stream = provider.chat(messages, { model });
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let assistantText = '';
      let outputStarted = false;

      for await (const chunk of stream) {
        switch (chunk.type) {
          case 'text_delta':
            if (!outputStarted) {
              process.stdout.write('● ');
              outputStarted = true;
            }
            process.stdout.write(chunk.data);
            assistantText += chunk.data;
            break;

          case 'tool_call':
            if (debug) {
              process.stderr.write(`\n  [tool: ${chunk.data.name}]\n`);
            }
            break;

          case 'tool_input':
            break;

          case 'thinking_delta':
            if (debug) {
              process.stderr.write(chunk.data);
            }
            break;

          case 'stop':
            if (chunk.usage) {
              totalInputTokens = chunk.usage.input_tokens;
              totalOutputTokens = chunk.usage.output_tokens;
            }
            break;
        }
      }

      if (outputStarted) {
        process.stdout.write('\n');
      }
      if (assistantText) {
        messages.push({ role: 'assistant', content: assistantText });
      }

      if (debug) {
        process.stderr.write(`Tokens: ${totalInputTokens}↑/${totalOutputTokens}↓\n`);
      }

    } catch (err: any) {
      process.stderr.write(`\n❌ ${err.message}\n`);
      if (debug && err.stack) {
        process.stderr.write(`${err.stack}\n`);
      }
      messages.pop();
    }

    rl.resume();
    rl.prompt();
  });

  rl.on('close', () => {
    running = false;
  });

  rl.on('SIGINT', () => {
    process.stdout.write('\n(use /exit or Ctrl+D to quit)\n');
    rl.prompt();
  });

  return new Promise<void>((resolve) => {
    rl.on('close', resolve);
  });
}
