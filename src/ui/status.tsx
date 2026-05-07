/// <reference types="ink" />

/**
 * Status bar component — shows model, token usage, cost, turn count.
 *
 * Rendered at the bottom of the UI, above the input panel.
 * Ink 5.x has no Spinner — we use a manual frame cycler.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StatusBarProps {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  turns: number;
  isLoading: boolean;
}

// ─── Cost estimates (approximate, per 1M tokens) ──────────────────────────────

const COST_PER_1M: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
  'claude-sonnet-3-5': { input: 3.0, output: 15.0 },
  'gpt-4o': { input: 2.5, output: 10.0 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): string {
  const rates = COST_PER_1M[model];
  if (!rates) return '';
  const cost =
    (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;
  return `≈$${cost.toFixed(4)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ─── Spinner frames ───────────────────────────────────────────────────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const Spinner: React.FC = () => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(id);
  }, []);

  return <Text>{SPINNER_FRAMES[frame]}</Text>;
};

// ─── Component ─────────────────────────────────────────────────────────────────

export const StatusBar: React.FC<StatusBarProps> = ({
  model,
  provider,
  inputTokens,
  outputTokens,
  cost,
  turns,
  isLoading,
}) => {
  const costStr = estimateCost(model, inputTokens, outputTokens);

  return (
    <Box flexDirection="column">
      {/* Divider */}
      <Text dimColor>──────────────────────────────────────────────────</Text>

      {/* Status line */}
      <Box>
        {isLoading && (
          <Text>
            <Spinner />{' '}
          </Text>
        )}
        <Text dimColor>
          {provider}:{model}
        </Text>
        <Text dimColor> | T:{turns}</Text>
        {(inputTokens > 0 || outputTokens > 0) && (
          <Text dimColor>
            {' '}
            | Tokens: {formatTokens(inputTokens)}↑/{formatTokens(outputTokens)}↓
          </Text>
        )}
        {costStr && <Text dimColor> {costStr}</Text>}
      </Box>
    </Box>
  );
};
