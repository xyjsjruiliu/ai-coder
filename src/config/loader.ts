/**
 * Config loader — reads ~/.ai-coder/config.json and merges with CLI opts.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

export interface AICoderConfig {
  defaults: {
    model: string;
    provider: string;
    maxTurns: number;
  };
  providers: Record<string, ProviderConfig>;
}

export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
}

const DEFAULT_CONFIG: AICoderConfig = {
  defaults: {
    model: 'claude-sonnet-4-20250514',
    provider: 'anthropic',
    maxTurns: 25,
  },
  providers: {},
};

export async function readConfig(
  _opts?: Record<string, unknown>
): Promise<AICoderConfig> {
  const configPath = resolve(homedir(), '.ai-coder', 'config.json');

  try {
    const raw = await readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    // TODO: Zod validation
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    // Return defaults if no config file exists
    return DEFAULT_CONFIG;
  }
}
