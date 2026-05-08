/**
 * Print mode — single-shot: send a query, run the agent loop with tools,
 * stream back the result, exit.
 */

import { AgentLoop } from '../agent/loop.js';
import { ToolRegistry } from '../tools/registry.js';
import { readFileTool } from '../tools/read_file.js';
import { writeFileTool } from '../tools/write_file.js';
import { editFileTool } from '../tools/edit_file.js';
import { createTerminalApprover } from '../utils/approver.js';
import { ProviderFactory } from '../llm/factory.js';
import type { LLMProvider } from '../llm/types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PrintOptions {
  query: string;
  model: string;
  provider: 'anthropic' | 'openai' | 'openrouter' | 'ollama';
  maxTurns: number;
  apiKey: string | null;
  debug: boolean;
}

// ─── Cost Estimates (approximate, per 1M tokens) ──────────────────────────────

const COST_PER_1M: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
  'claude-sonnet-3-5': { input: 3.0, output: 15.0 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): string {
  const rates = COST_PER_1M[model];
  if (!rates) return '';
  const cost = (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;
  return `≈$${cost.toFixed(4)}`;
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
    'Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY environment variable.\n' +
    'Or add provider credentials to ~/.ai-coder/config.json:\n' +
    '  { "providers": { "' + provider + '": { "apiKey": "***" } } }',
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runPrintMode(opts: PrintOptions): Promise<void> {
  let provider: LLMProvider;
  try {
    provider = createProvider(opts.provider, opts.apiKey, opts.debug);
  } catch (err: any) {
    process.stderr.write(`❌ ${err.message}\n`);
    process.exit(1);
  }

  if (opts.debug) {
    process.stderr.write(`[debug] provider=${provider.providerName} model=${opts.model}\n`);
    process.stderr.write(`[debug] query: ${opts.query.slice(0, 80)}${opts.query.length > 80 ? '...' : ''}\n`);
  }

  // ── Set up AgentLoop with tools ─────────────────────────────────────────

  const toolRegistry = new ToolRegistry({
    workspaceRoot: process.cwd(),
    approver: createTerminalApprover(),
  });
  toolRegistry.register(readFileTool);
  toolRegistry.register(writeFileTool);
  toolRegistry.register(editFileTool);
  const agent = new AgentLoop(provider, toolRegistry, opts.model, {
    maxTurns: opts.maxTurns,
    systemPrompt: 'You are an AI coding assistant. Be concise and helpful. When you need to read or edit files, use the available tools.',
    debug: opts.debug,
  });

  // ── Run agent ───────────────────────────────────────────────────────────

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let hasOutput = false;

  try {
    const stream = agent.run(opts.query);

    for await (const chunk of stream) {
      switch (chunk.type) {
        case 'text_delta':
          process.stdout.write(chunk.data);
          hasOutput = true;
          break;

        case 'tool_call':
          if (opts.debug) {
            process.stderr.write(`\n[debug] tool call: ${chunk.data.name}\n`);
          }
          break;

        case 'tool_input':
          // Tool result — show in debug mode
          break;

        case 'thinking_delta':
          if (opts.debug) {
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

    // ── Summary line ──────────────────────────────────────────────────────
    const cost = estimateCost(opts.model, totalInputTokens, totalOutputTokens);
    const parts = [
      `Tokens: ${totalInputTokens}↑/${totalOutputTokens}↓`,
      cost,
    ].filter(Boolean);

    if (hasOutput) {
      process.stdout.write(`\n\n`);
    }
    process.stderr.write(`${parts.join('  ')}\n`);

  } catch (err: any) {
    process.stderr.write(`\n❌ ${err.message}\n`);
    if (opts.debug && err.stack) {
      process.stderr.write(`${err.stack}\n`);
    }
    process.exit(1);
  }
}
