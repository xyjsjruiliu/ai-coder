/**
 * Provider Factory — creates the right provider instance from config.
 *
 * Supported providers:
 * - anthropic  → AnthropicProvider
 * - openai     → OpenAIProvider
 * - openrouter → OpenAIProvider with OpenRouter base URL and special headers
 */

import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import type { LLMProvider } from './types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// ─── Provider Config ──────────────────────────────────────────────────────────

export interface ProviderConfig {
  provider: 'anthropic' | 'openai' | 'openrouter';
  apiKey: string;
  baseUrl?: string;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export class ProviderFactory {
  /** Create a provider instance from config */
  static create(config: ProviderConfig): LLMProvider {
    switch (config.provider) {
      case 'anthropic':
        return new AnthropicProvider(config.apiKey, config.baseUrl);

      case 'openai':
        return new OpenAIProvider(config.apiKey, config.baseUrl);

      case 'openrouter':
        // OpenRouter uses OpenAI-compatible API at its own base URL
        // The API key can be an OpenRouter key
        return new OpenAIProvider(
          config.apiKey,
          config.baseUrl ?? OPENROUTER_BASE_URL,
        );

      default:
        throw new Error(`Unknown provider: ${(config as any).provider}`);
    }
  }

  /**
   * Create from environment variables.
   * Checks ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY in order.
   */
  static createFromEnv(): LLMProvider | null {
    if (process.env.ANTHROPIC_API_KEY) {
      return new AnthropicProvider(process.env.ANTHROPIC_API_KEY);
    }
    if (process.env.OPENAI_API_KEY) {
      return new OpenAIProvider(process.env.OPENAI_API_KEY);
    }
    if (process.env.OPENROUTER_API_KEY) {
      return new OpenAIProvider(
        process.env.OPENROUTER_API_KEY,
        OPENROUTER_BASE_URL,
      );
    }
    return null;
  }

  /**
   * Determine the likely provider type based on an API key prefix.
   * Anthropic keys start with 'sk-ant-', OpenAI with 'sk-proj-' or 'sk-'.
   */
  static detectProvider(apiKey: string): 'anthropic' | 'openai' | 'openrouter' {
    if (apiKey.startsWith('sk-ant-')) return 'anthropic';
    if (apiKey.startsWith('sk-or-')) return 'openrouter';
    return 'openai';
  }
}
