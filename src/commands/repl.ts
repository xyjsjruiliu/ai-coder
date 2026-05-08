/**
 * REPL mode — interactive agent loop (text-only, no Ink UI yet).
 * Uses AgentLoop for multi-turn conversation with full tool support.
 */

import * as readline from 'node:readline';
import { AgentLoop } from '../agent/loop.js';
import { ToolRegistry } from '../tools/registry.js';
import { readFileTool } from '../tools/read_file.js';
import { writeFileTool } from '../tools/write_file.js';
import { editFileTool } from '../tools/edit_file.js';
import { bashTool } from '../tools/bash.js';
import { webSearchTool } from '../tools/web_search.js';
import { webFetchTool } from '../tools/web_fetch.js';
import { createTerminalApprover } from '../utils/approver.js';
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

export function createProvider(
  provider: 'anthropic' | 'openai' | 'openrouter' | 'ollama',
  apiKey: string | null,
  _debug?: boolean,
): LLMProvider {
  // Try env var — but only if it matches the requested provider type
  const envProvider = ProviderFactory.createFromEnv();
  if (envProvider) {
    if (envProvider.providerName === provider) {
      return envProvider;
    }
    if (_debug) {
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
    '  /tools         list available tools',
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
  let running = true;

  // ── Set up AgentLoop ─────────────────────────────────────────────────────
  const toolRegistry = new ToolRegistry({
    workspaceRoot: process.cwd(),
    approver: createTerminalApprover(),
  });
  toolRegistry.register(readFileTool);
  toolRegistry.register(writeFileTool);
  toolRegistry.register(editFileTool);
  toolRegistry.register(bashTool);
  toolRegistry.register(webSearchTool);
  toolRegistry.register(webFetchTool);
  let agent = new AgentLoop(provider, toolRegistry, model, {
    maxTurns: opts.maxTurns,
    systemPrompt: 'You are an AI coding assistant. Be concise and helpful. When you need to read or edit files, use the available tools.',
    debug,
  });

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

        case 'tools':
          {
            const defs = toolRegistry.getDefinitions();
            if (defs.length === 0) {
              process.stdout.write('No tools registered.\n');
            } else {
              process.stdout.write(`Available tools (${defs.length}):\n`);
              for (const d of defs) {
                process.stdout.write(`  • ${d.name} — ${d.description}\n`);
              }
            }
          }
          rl.prompt();
          return;

        case 'clear':
          agent.reset();
          process.stdout.write('Conversation cleared.\n');
          rl.prompt();
          return;

        case 'model':
        case 'm': {
          if (args.length === 0) {
            process.stdout.write(`Current model: ${model}\n`);
          } else {
            model = args[0];
            // Rebuild agent with new model
            agent = new AgentLoop(provider, toolRegistry, model, {
              maxTurns: opts.maxTurns,
              systemPrompt: 'You are an AI coding assistant. Be concise and helpful.',
              debug,
            });
            process.stdout.write(`Switched to model: ${model}\n`);
          }
          rl.prompt();
          return;
        }

        case 'debug':
        case 'd':
          debug = !debug;
          // Rebuild agent with new debug setting
          agent = new AgentLoop(provider, toolRegistry, model, {
            maxTurns: opts.maxTurns,
            systemPrompt: 'You are an AI coding assistant. Be concise and helpful.',
            debug,
          });
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

    rl.pause();

    try {
      const stream = agent.run(trimmed);
      let assistantText = '';
      let outputStarted = false;
      let turnStats = { input: 0, output: 0 };

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
            if (outputStarted) process.stdout.write('\n');
            process.stdout.write(`  🔧 ${chunk.data.name}`);
            outputStarted = false;
            break;

          case 'tool_input':
            // Tool result — show indicator
            process.stdout.write(' ✓');
            break;

          case 'thinking_delta':
            if (debug) {
              process.stderr.write(chunk.data);
            }
            break;

          case 'stop':
            if (chunk.usage) {
              turnStats = {
                input: chunk.usage.input_tokens || 0,
                output: chunk.usage.output_tokens || 0,
              };
            }
            if (chunk.stop_reason?.startsWith('turn_error:')) {
              process.stderr.write(`\n⚠ ${chunk.stop_reason.slice(12)}\n`);
            } else if (chunk.stop_reason?.startsWith('aborted:')) {
              process.stderr.write(`\n⛔ ${chunk.stop_reason.slice(9)}\n`);
            }
            break;
        }
      }

      if (outputStarted) {
        process.stdout.write('\n');
      }

      if (debug) {
        const state = agent.getState();
        process.stderr.write(
          `[debug] turns=${state.turns} tokens=${state.totalInputTokens}↑/${state.totalOutputTokens}↓ cost≈$${state.totalCost.toFixed(4)}\n`,
        );
      }

    } catch (err: any) {
      process.stderr.write(`\n❌ ${err.message}\n`);
      if (debug && err.stack) {
        process.stderr.write(`${err.stack}\n`);
      }
    }

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
