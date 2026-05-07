/// <reference types="ink" />

/**
 * Input panel component — handles user text input.
 *
 * Ink 5.x removed TextInput. We build it manually with useInput hook.
 * Supports: typing, Backspace, Enter to submit, Ctrl+C propagation.
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InputPanelProps {
  /** Called when user submits text (Enter) */
  onSubmit: (text: string) => void;
  /** Whether input is disabled (during loading) */
  disabled: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Prefix before the input cursor */
  prefix?: string;
}

// ─── Component ─────────────────────────────────────────────────────────────────

export const InputPanel: React.FC<InputPanelProps> = ({
  onSubmit,
  disabled,
  placeholder = 'Ask anything…',
  prefix = '▸ ',
}) => {
  const [value, setValue] = useState('');

  useInput(
    (input, key) => {
      if (disabled) return;

      if (key.return) {
        const trimmed = value.trim();
        if (trimmed) {
          onSubmit(trimmed);
        }
        setValue('');
        return;
      }

      if (key.backspace || key.delete) {
        setValue((prev) => prev.slice(0, -1));
        return;
      }

      // Ignore control keys, arrows, etc. Only accept printable characters
      if (!key.ctrl && !key.meta && input.length > 0) {
        setValue((prev) => prev + input);
      }
    },
    { isActive: !disabled },
  );

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* Divider */}
      <Text dimColor>──────────────────────────────────────────────────</Text>

      {/* Input line */}
      <Box>
        <Text color="green">{prefix}</Text>
        {disabled ? (
          <Text dimColor>{placeholder}</Text>
        ) : (
          <Box>
            <Text>{value}</Text>
            <Text color="cyan">█</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};
