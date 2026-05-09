/**
 * Tests for print command.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runPrintMode } from '../../src/commands/print.js';

// ─── Mock Provider ───────────────────────────────────────────────────────────

const mockProvider = {
  providerName: 'mock-anthropic',
  chat: () => mockTextStream('Hello', ' World'),
  listModels: async () => [],
};

// ─── Mock LLM Provider Streams ────────────────────────────────────────────────

function mockTextStream(...texts: string[]) {
  async function* gen() {
    for (const text of texts) {
      yield { type: 'text_delta' as const, data: text };
    }
    yield {
      type: 'stop' as const,
      stop_reason: 'end_turn',
      usage: { input_tokens: 50, output_tokens: texts.join('').length },
    };
  }
  return gen();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setup() {
  const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

  return { stdoutSpy, stderrSpy, exitSpy, cleanup: () => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  }};
}

function getMockStdout(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map(c => c[0]).join('');
}

function getMockStderr(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map(c => c[0]).join('');
}

// ─── Mock ProviderFactory ────────────────────────────────────────────────────

vi.mock('../../src/llm/factory.js', () => ({
  ProviderFactory: {
    create: () => mockProvider,
    createFromEnv: () => mockProvider,
  },
}));

describe('runPrintMode', () => {
  let envKey: string | undefined;

  beforeEach(() => {
    envKey = process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (envKey) process.env.ANTHROPIC_API_KEY = envKey;
    else delete process.env.ANTHROPIC_API_KEY;
  });

  it('exits with error when createFromEnv returns null and no apiKey', async () => {
    // Override mock for this test only
    const { ProviderFactory } = await import('../../src/llm/factory.js');
    const origCreateFromEnv = ProviderFactory.createFromEnv;
    ProviderFactory.createFromEnv = () => null;

    const { exitSpy, cleanup } = setup();
    delete process.env.ANTHROPIC_API_KEY;

    try {
      await runPrintMode({
        query: 'test',
        model: 'claude-sonnet-4-20250514',
        provider: 'anthropic',
        maxTurns: 10,
        apiKey: null,
        debug: false,
      });
    } catch {}

    expect(exitSpy).toHaveBeenCalledWith(1);

    ProviderFactory.createFromEnv = origCreateFromEnv;
    cleanup();
  });

  it('streams text_delta chunks to stdout', async () => {
    const { stdoutSpy, cleanup } = setup();

    await runPrintMode({
      query: 'test',
      model: 'claude-sonnet-4-20250514',
      provider: 'anthropic',
      maxTurns: 10,
      apiKey: 'sk-ant-test',
      debug: false,
    });

    // @ts-ignore
    const output = getMockStdout(stdoutSpy);
    expect(output).toContain('Hello');
    expect(output).toContain('World');
    cleanup();
  });

  it('shows token summary in stderr', async () => {
    const { stderrSpy, cleanup } = setup();

    await runPrintMode({
      query: 'test',
      model: 'claude-sonnet-4-20250514',
      provider: 'anthropic',
      maxTurns: 10,
      apiKey: 'sk-ant-test',
      debug: true,
    });

    // @ts-ignore
    const stderr = getMockStderr(stderrSpy);
    expect(stderr).toContain('Tokens:');
    cleanup();
  });

  it('shows cost estimate for known models', async () => {
    const { stderrSpy, cleanup } = setup();

    await runPrintMode({
      query: 'test',
      model: 'gpt-4o',
      provider: 'openai',
      maxTurns: 10,
      apiKey: 'sk-test',
      debug: false,
    });

    // @ts-ignore
    const stderr = getMockStderr(stderrSpy);
    expect(stderr).toContain('≈$');
    cleanup();
  });

  it('handles empty query', async () => {
    const { cleanup } = setup();

    await runPrintMode({
      query: '',
      model: 'claude-sonnet-4-20250514',
      provider: 'anthropic',
      maxTurns: 10,
      apiKey: 'sk-ant-test',
      debug: false,
    });

    cleanup();
  });

  it('shows debug info when debug is enabled', async () => {
    const { stderrSpy, cleanup } = setup();

    await runPrintMode({
      query: 'test query for debug',
      model: 'claude-sonnet-4-20250514',
      provider: 'anthropic',
      maxTurns: 10,
      apiKey: 'sk-ant-test',
      debug: true,
    });

    // @ts-ignore
    const stderr = getMockStderr(stderrSpy);
    expect(stderr).toContain('[debug]');
    expect(stderr).toContain('test query');
    cleanup();
  });
});
