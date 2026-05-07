/// <reference types="ink" />

/**
 * Output area component — renders message history and live streaming text.
 *
 * Uses <Static> for completed messages (avoids re-render flicker)
 * and <Text> for the in-progress streaming response.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, Static } from 'ink';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
}

export interface OutputAreaProps {
  /** Completed messages (rendered via Static) */
  messages: DisplayMessage[];
  /** Currently streaming text (rendered via Text for live updates) */
  streamingText: string;
  /** Whether we're waiting for the LLM */
  isLoading: boolean;
}

// ─── Spinner frames ───────────────────────────────────────────────────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** Internal spinner component — cycles through frames every 80ms */
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

export const OutputArea: React.FC<OutputAreaProps> = ({
  messages,
  streamingText,
  isLoading,
}) => {
  // Determine role marker for a message
  const roleMarker = (role: DisplayMessage['role']): string => {
    switch (role) {
      case 'user':
        return '▸';
      case 'assistant':
        return '●';
      case 'tool':
        return '⚙';
      default:
        return ' ';
    }
  };

  // Determine role color
  const roleColor = (role: DisplayMessage['role']): string | undefined => {
    switch (role) {
      case 'user':
        return 'green';
      case 'assistant':
        return undefined; // default
      case 'tool':
        return 'yellow';
      default:
        return undefined;
    }
  };

  return (
    <Box flexDirection="column" marginY={1}>
      {/* Completed messages — Static avoids re-render on streaming updates */}
      <Static items={messages}>
        {(msg) => (
          <Box key={msg.id} flexDirection="column" marginBottom={1}>
            <Text color={roleColor(msg.role)}>
              {roleMarker(msg.role)} {msg.content}
            </Text>
          </Box>
        )}
      </Static>

      {/* Live streaming text — rendered fresh each chunk */}
      {(streamingText || isLoading) && (
        <Box flexDirection="column">
          {isLoading && !streamingText ? (
            <Text>
              <Spinner /> <Text dimColor>Thinking…</Text>
            </Text>
          ) : (
            <Text>
              ● {streamingText}
              {isLoading && <Text color="cyan">█</Text>}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
};
