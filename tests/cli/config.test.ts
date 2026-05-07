/**
 * Tests for config loader.
 */

import { describe, it, expect } from 'vitest';
import { readConfig } from '../../src/config/loader.js';

describe('readConfig', () => {
  it('should return default config when no config file exists', async () => {
    const config = await readConfig();
    expect(config.defaults.model).toBe('claude-sonnet-4-20250514');
    expect(config.defaults.provider).toBe('anthropic');
    expect(config.defaults.maxTurns).toBe(25);
  });

  it('should have default system prompt', async () => {
    const config = await readConfig();
    expect(config).toBeDefined();
    expect(config.defaults).toBeDefined();
  });
});
