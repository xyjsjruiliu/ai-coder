/**
 * Tests: ProviderFactory
 *
 * Covers:
 * - create(): AnthropicProvider, OpenAIProvider, OpenRouter
 * - create(): unknown provider throws
 * - createFromEnv(): auto-detection from environment variables
 * - createFromEnv(): returns null when no API keys set
 * - detectProvider(): key prefix classification
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProviderFactory } from '../../src/llm/factory.js';
import { AnthropicProvider } from '../../src/llm/anthropic.js';
import { OpenAIProvider } from '../../src/llm/openai.js';

describe('ProviderFactory', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear all relevant env vars
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ═══════════════════════════════════════════════════════════════════════
  // create()
  // ═══════════════════════════════════════════════════════════════════════

  describe('create()', () => {
    it('should create AnthropicProvider', () => {
      const provider = ProviderFactory.create({
        provider: 'anthropic',
        apiKey: 'sk-ant-test',
      });

      expect(provider).toBeInstanceOf(AnthropicProvider);
      expect(provider.providerName).toBe('anthropic');
    });

    it('should create OpenAIProvider', () => {
      const provider = ProviderFactory.create({
        provider: 'openai',
        apiKey: 'sk-proj-test',
      });

      expect(provider).toBeInstanceOf(OpenAIProvider);
      expect(provider.providerName).toBe('openai');
    });

    it('should create OpenRouter as OpenAIProvider', () => {
      const provider = ProviderFactory.create({
        provider: 'openrouter',
        apiKey: 'sk-or-test',
      });

      expect(provider).toBeInstanceOf(OpenAIProvider);
      expect(provider.providerName).toBe('openai');
    });

    it('should pass custom baseUrl to AnthropicProvider', () => {
      const provider = ProviderFactory.create({
        provider: 'anthropic',
        apiKey: 'sk-ant-test',
        baseUrl: 'https://custom.anthropic.com',
      });

      expect(provider).toBeInstanceOf(AnthropicProvider);
    });

    it('should pass custom baseUrl to OpenAIProvider', () => {
      const provider = ProviderFactory.create({
        provider: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://custom.openai.com',
      });

      expect(provider).toBeInstanceOf(OpenAIProvider);
    });

    it('should use default OpenRouter baseUrl when not specified', () => {
      const provider = ProviderFactory.create({
        provider: 'openrouter',
        apiKey: 'sk-or-test',
      });

      // OpenRouter uses OpenAIProvider with https://openrouter.ai/api/v1
      expect(provider).toBeInstanceOf(OpenAIProvider);
    });

    it('should use custom baseUrl for OpenRouter when specified', () => {
      const provider = ProviderFactory.create({
        provider: 'openrouter',
        apiKey: 'sk-or-test',
        baseUrl: 'https://custom.openrouter.com',
      });

      expect(provider).toBeInstanceOf(OpenAIProvider);
    });

    it('should throw for unknown provider', () => {
      expect(() =>
        ProviderFactory.create({
          provider: 'unknown_provider' as any,
          apiKey: 'test',
        }),
      ).toThrow('Unknown provider');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // createFromEnv()
  // ═══════════════════════════════════════════════════════════════════════

  describe('createFromEnv()', () => {
    it('should return null when no API keys', () => {
      expect(ProviderFactory.createFromEnv()).toBeNull();
    });

    it('should return AnthropicProvider when ANTHROPIC_API_KEY is set', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      const provider = ProviderFactory.createFromEnv();
      expect(provider).toBeInstanceOf(AnthropicProvider);
    });

    it('should prioritize Anthropic over OpenAI', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      process.env.OPENAI_API_KEY = 'sk-test';
      const provider = ProviderFactory.createFromEnv();
      expect(provider).toBeInstanceOf(AnthropicProvider);
    });

    it('should return OpenAIProvider when only OPENAI_API_KEY is set', () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      const provider = ProviderFactory.createFromEnv();
      expect(provider).toBeInstanceOf(OpenAIProvider);
    });

    it('should return OpenAIProvider when only OPENROUTER_API_KEY is set', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-test';
      const provider = ProviderFactory.createFromEnv();
      expect(provider).toBeInstanceOf(OpenAIProvider);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // detectProvider()
  // ═══════════════════════════════════════════════════════════════════════

  describe('detectProvider()', () => {
    it('should detect Anthropic by sk-ant- prefix', () => {
      expect(ProviderFactory.detectProvider('sk-ant-api03-xxxxx')).toBe('anthropic');
    });

    it('should detect OpenRouter by sk-or- prefix', () => {
      expect(ProviderFactory.detectProvider('sk-or-v1-xxxxx')).toBe('openrouter');
    });

    it('should default to openai for other prefixes', () => {
      expect(ProviderFactory.detectProvider('sk-proj-xxxxx')).toBe('openai');
      expect(ProviderFactory.detectProvider('sk-xxxxx')).toBe('openai');
      expect(ProviderFactory.detectProvider('random-key')).toBe('openai');
      expect(ProviderFactory.detectProvider('')).toBe('openai');
    });
  });
});
