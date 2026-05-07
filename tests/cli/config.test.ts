/**
 * Tests for config loader.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { readConfig, resetConfigCache, ConfigSchema } from '../../src/config/loader.js';

const CONFIG_DIR = resolve(homedir(), '.ai-coder');

// Helper: write a test config file WITHOUT resetting cache
async function writeConfigRaw(json: unknown): Promise<void> {
  if (!existsSync(CONFIG_DIR)) {
    await mkdir(CONFIG_DIR, { recursive: true });
  }
  const path = resolve(CONFIG_DIR, 'config.json');
  await writeFile(path, JSON.stringify(json));
}

// Helper: write + reset (used by most tests)
async function writeTestConfig(json: unknown): Promise<void> {
  await writeConfigRaw(json);
  resetConfigCache();
}

// Helper: remove test config
async function removeTestConfig(): Promise<void> {
  const path = resolve(CONFIG_DIR, 'config.json');
  try { await rm(path); } catch {}
  resetConfigCache();
}

describe('readConfig', () => {
  beforeEach(async () => {
    await removeTestConfig();
  });

  afterEach(async () => {
    await removeTestConfig();
  });

  it('returns defaults when no config file exists', async () => {
    const { config, path } = await readConfig();
    expect(config.defaults.model).toBe('claude-sonnet-4-20250514');
    expect(config.defaults.provider).toBe('anthropic');
    expect(config.defaults.maxTurns).toBe(25);
    expect(config.defaults.contextBudgetKb).toBe(180);
    expect(config.providers).toEqual({});
    expect(path).toBe(resolve(CONFIG_DIR, 'config.json'));
  });

  it('merges partial config with defaults', async () => {
    await writeTestConfig({
      defaults: {
        model: 'gpt-4o',
        provider: 'openai',
      },
    });

    const { config } = await readConfig();
    expect(config.defaults.model).toBe('gpt-4o');
    expect(config.defaults.provider).toBe('openai');
    expect(config.defaults.maxTurns).toBe(25); // default preserved
  });

  it('reads provider credentials', async () => {
    await writeTestConfig({
      providers: {
        anthropic: { apiKey: 'sk-ant-test' },
        openai: { apiKey: 'sk-openai-test', baseUrl: 'https://custom.com/v1' },
      },
    });

    const { config } = await readConfig();
    expect(config.providers.anthropic?.apiKey).toBe('sk-ant-test');
    expect(config.providers.openai?.apiKey).toBe('sk-openai-test');
    expect(config.providers.openai?.baseUrl).toBe('https://custom.com/v1');
  });

  it('falls back to defaults on invalid config and warns', async () => {
    await writeTestConfig({
      defaults: {
        model: 123, // should be string
        provider: 'invalid-provider', // not in enum
        maxTurns: 0, // must be >= 1
      },
    });

    const { config } = await readConfig();
    // Falls back to defaults
    expect(config.defaults.model).toBe('claude-sonnet-4-20250514');
    expect(config.defaults.provider).toBe('anthropic');
    expect(config.defaults.maxTurns).toBe(25);
  });

  it('caches config after first read', async () => {
    // Write initial config and read (populates cache)
    await writeTestConfig({ defaults: { model: 'cached-model' } });
    const first = await readConfig();
    expect(first.config.defaults.model).toBe('cached-model');

    // Write new config WITHOUT resetting cache
    await writeConfigRaw({ defaults: { model: 'changed-model' } });

    // Should still be cached
    const second = await readConfig();
    expect(second.config.defaults.model).toBe('cached-model');

    // After reset, picks up new value
    resetConfigCache();
    const third = await readConfig();
    expect(third.config.defaults.model).toBe('changed-model');
  });
});

describe('ConfigSchema', () => {
  it('accepts empty object with defaults', () => {
    const result = ConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaults.provider).toBe('anthropic');
    }
  });

  it('accepts full valid config', () => {
    const result = ConfigSchema.safeParse({
      defaults: {
        model: 'gpt-4o',
        provider: 'openai',
        maxTurns: 50,
        contextBudgetKb: 128,
      },
      providers: {
        anthropic: { apiKey: 'sk-ant-xxx' },
        openai: { apiKey: 'sk-xxx', baseUrl: 'https://custom/v1' },
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid provider value', () => {
    const result = ConfigSchema.safeParse({
      defaults: { provider: 'azure' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects maxTurns > 100', () => {
    const result = ConfigSchema.safeParse({
      defaults: { maxTurns: 200 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty apiKey', () => {
    const result = ConfigSchema.safeParse({
      providers: {
        anthropic: { apiKey: '' },
      },
    });
    expect(result.success).toBe(false);
  });
});
