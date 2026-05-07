/**
 * Config loader — reads ~/.ai-coder/config.json, validates with Zod.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';

// ─── Schema ───────────────────────────────────────────────────────────────────

const ProviderConfigSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().optional(),
});

const defaultsSchema = z.object({
  model: z.string().default('claude-sonnet-4-20250514'),
  provider: z.enum(['anthropic', 'openai', 'openrouter', 'ollama']).default('anthropic'),
  maxTurns: z.number().int().min(1).max(100).default(25),
  contextBudgetKb: z.number().int().min(1).default(180),
});

export const ConfigSchema = z.object({
  defaults: defaultsSchema.default({}),
  providers: z.record(z.string(), ProviderConfigSchema).default({}),
});

// ─── Types ────────────────────────────────────────────────────────────────────

export type AICoderConfig = z.infer<typeof ConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: AICoderConfig = {
  defaults: {
    model: 'claude-sonnet-4-20250514',
    provider: 'anthropic',
    maxTurns: 25,
    contextBudgetKb: 180,
  },
  providers: {},
};

// ─── Loader ───────────────────────────────────────────────────────────────────

let _cached: { config: AICoderConfig; path: string } | null = null;

export function configPath(): string {
  return resolve(homedir(), '.ai-coder', 'config.json');
}

/**
 * Read and validate config from disk.
 * Falls back to defaults when file is absent or invalid.
 */
export async function readConfig(): Promise<{
  config: AICoderConfig;
  path: string;
}> {
  if (_cached) return _cached;

  const path = configPath();
  let raw: unknown;

  try {
    const text = await readFile(path, 'utf-8');
    raw = JSON.parse(text);
  } catch {
    // No config file — use defaults
    raw = {};
  }

  const result = ConfigSchema.safeParse(raw);

  if (!result.success) {
    // Invalid config: warn to stderr, continue with defaults
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    process.stderr.write(
      `⚠  Invalid config (${path}) — using defaults:\n${issues}\n`,
    );
    _cached = { config: DEFAULT_CONFIG, path };
    return _cached;
  }

  _cached = { config: result.data, path };
  return _cached;
}

/** Reset cache (useful in tests). */
export function resetConfigCache(): void {
  _cached = null;
}
