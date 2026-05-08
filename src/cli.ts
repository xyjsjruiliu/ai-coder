#!/usr/bin/env node
/**
 * AI Coder — CLI entry point.
 *
 * Usage:
 *   ai-coder                      # interactive TUI (Ink)
 *   ai-coder "write a LRU cache"  # single-shot print mode
 *   ai-coder -p "query"           # explicit print mode
 *   ai-coder --list-models        # show available models
 *   ai-coder --version            # show version
 */

import { Command } from 'commander';
import { readConfig } from './config/loader.js';
import { runPrintMode } from './commands/print.js';
import { createProvider } from './commands/repl.js';
import { type LLMProvider, ProviderError } from './llm/types.js';
import { ProviderFactory } from './llm/factory.js';
import { AgentLoop } from './agent/loop.js';
import { ToolRegistry } from './tools/registry.js';
import { readFileTool } from './tools/read_file.js';
import { writeFileTool } from './tools/write_file.js';
import { editFileTool } from './tools/edit_file.js';
import { bashTool } from './tools/bash.js';
import { webSearchTool } from './tools/web_search.js';
import { webFetchTool } from './tools/web_fetch.js';
import { createTerminalApprover } from './utils/approver.js';
import { renderUI } from './ui/index.js';

// ─── Version ──────────────────────────────────────────────────────────────────

// Read version from package.json at startup
let VERSION = '0.1.0';
try {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  VERSION = require('../package.json').version ?? '0.1.0';
} catch {
  // keep default
}

// ─── Provider Resolution ──────────────────────────────────────────────────────

type Provider = 'anthropic' | 'openai' | 'openrouter' | 'ollama';

function resolveProvider(
  config: Awaited<ReturnType<typeof readConfig>>['config'],
  cliProvider?: string,
): Provider {
  const validProviders: string[] = ['anthropic', 'openai', 'openrouter', 'ollama'];
  const requested = cliProvider ?? config.defaults.provider;

  if (validProviders.includes(requested)) {
    return requested as Provider;
  }

  // Unknown provider → fall back to default with warning
  process.stderr.write(`⚠  Unknown provider "${requested}" — using anthropic\n`);
  return 'anthropic';
}

function resolveApiKey(
  config: Awaited<ReturnType<typeof readConfig>>['config'],
  provider: Provider,
): string | null {
  // Ollama needs no real API key
  if (provider === 'ollama') return 'ollama';

  // 1. Provider-specific env var
  const envMap: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
  };
  if (process.env[envMap[provider]]) {
    return process.env[envMap[provider]]!;
  }

  // 2. Config file
  const p = config.providers[provider];
  if (p?.apiKey) return p.apiKey;

  return null;
}

// ─── Program ──────────────────────────────────────────────────────────────────

async function main() {
  const program = new Command();

  program
    .name('ai-coder')
    .description('AI-powered coding assistant in your terminal')
    .version(VERSION, '-v, --version', 'output the version number')
    .argument('[query]', 'single-shot query (print mode)')
    .option('-p, --print <query>', 'single-shot print mode')
    .option('-m, --model <model>', 'model to use (default from config)')
    .option('--provider <provider>', 'provider: anthropic, openai, openrouter, ollama')
    .option('--max-turns <n>', 'max agent turns', parseInt)
    .option('--continue', 'continue last session')
    .option('--list-models', 'list available models from configured provider')
    .option('--no-color', 'disable colored output')
    .option('--debug', 'enable debug logging')
    .action(async (query, opts) => {
      // ── --list-models (no LLM chat needed) ───────────────────────────────
      if (opts.listModels) {
        console.log('Fetching models...');
        const provider = ProviderFactory.createFromEnv();
        if (!provider) {
          console.error('No API key found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY.');
          console.error('Or configure ~/.ai-coder/config.json with provider credentials.');
          process.exit(1);
        }
        const models = await provider.listModels();
        if (models.length === 0) {
          console.log('(no models returned by provider)');
        } else {
          for (const m of models) {
            console.log(`  ${m.id}  ${m.display_name}`);
          }
        }
        return;
      }

      // ── Resolve config ──────────────────────────────────────────────────
      const { config } = await readConfig();

      // ── Determine mode ──────────────────────────────────────────────────
      const printQuery = opts.print || query;

      if (printQuery) {
        // Print mode (explicit -p or positional argument)
        return runPrintMode({
          query: printQuery,
          model: opts.model ?? config.defaults.model,
          provider: resolveProvider(config, opts.provider),
          maxTurns: opts.maxTurns ?? config.defaults.maxTurns,
          apiKey: resolveApiKey(config, resolveProvider(config, opts.provider)),
          debug: opts.debug ?? false,
        });
      }

      // ── Interactive TUI mode (Ink) ──────────────────────────────────────
      const provider = resolveProvider(config, opts.provider);
      const apiKey = resolveApiKey(config, provider);
      const model = opts.model ?? config.defaults.model;
      const maxTurns = opts.maxTurns ?? config.defaults.maxTurns;

      if (!apiKey) {
        console.error(`Error: No API key found for provider "${provider}".`);
        console.error(`Set the appropriate environment variable or configure ~/.ai-coder/config.json`);
        process.exit(1);
      }

      // Create LLM provider
      const llmProvider = createProvider(provider, apiKey);

      // Create AgentLoop with workspace tools
      const workspaceRoot = process.cwd();
      const toolRegistry = new ToolRegistry({
        workspaceRoot,
        approver: createTerminalApprover(),
      });
      toolRegistry.register(readFileTool);
      toolRegistry.register(writeFileTool);
      toolRegistry.register(editFileTool);
      toolRegistry.register(bashTool);
      toolRegistry.register(webSearchTool);
      toolRegistry.register(webFetchTool);
      const agentLoop = new AgentLoop(llmProvider, toolRegistry, model, {
        maxTurns,
        systemPrompt: 'You are an AI coding assistant. Help the user with programming tasks.',
        debug: opts.debug ?? false,
      });

      // Launch Ink TUI
      renderUI(agentLoop, model, provider);
    });

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  if (err instanceof ProviderError) {
    process.stderr.write(`${err.name}: [${err.code}] ${err.message}\n`);
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});
