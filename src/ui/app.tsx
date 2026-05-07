/// <reference types="ink" />

/**
 * Terminal UI — Ink application root component.
 *
 * Full React-for-terminal rendering:
 * - Streams text with typewriter effect
 * - Handles input with TextInput
 * - Shows status bar with token usage
 * - Ctrl+C triple-press to force quit
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { AgentLoop, type AgentState } from '../agent/loop.js';
import type { StreamChunk, UnifiedMessage, ContentBlock } from '../llm/types.js';
import { StatusBar } from './status.js';
import { InputPanel } from './input.js';
import { OutputArea, type DisplayMessage } from './output.js';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AppProps {
  loop: AgentLoop;
  model: string;
  provider: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract displayable text from a UnifiedMessage.
 * ContentBlock arrays are flattened; tool blocks are tagged.
 */
function messageToDisplay(msg: UnifiedMessage): { role: 'user' | 'assistant' | 'tool'; text: string } {
  if (typeof msg.content === 'string') {
    return { role: msg.role as 'user' | 'assistant', text: msg.content };
  }

  const blocks = msg.content as ContentBlock[];
  const parts: string[] = [];

  for (const block of blocks) {
    if (block.type === 'text' && block.text) {
      parts.push(block.text);
    } else if (block.type === 'tool_use') {
      parts.push(`\n  🔧 ${block.name}(${JSON.stringify(block.input).slice(0, 80)}${JSON.stringify(block.input).length > 80 ? '…' : ''})`);
    } else if (block.type === 'tool_result') {
      const preview = String(block.content).slice(0, 120);
      parts.push(`  📋 ${preview}${String(block.content).length > 120 ? '…' : ''}`);
    }
  }

  return {
    role: msg.role === 'user' ? 'user' : 'assistant',
    text: parts.join(''),
  };
}

/**
 * Rebuild display messages from AgentLoop state.
 * Called after each stop event to sync UI with backend.
 */
function buildDisplayMessages(state: AgentState): DisplayMessage[] {
  const result: DisplayMessage[] = [];
  for (const msg of state.messages) {
    const display = messageToDisplay(msg);
    if (display.text.trim()) {
      result.push({
        id: `msg-${result.length}`,
        role: display.role,
        content: display.text,
      });
    }
  }
  return result;
}

// ─── Ctrl+C state machine ─────────────────────────────────────────────────────

interface CtrlCState {
  count: number;
  lastTime: number;
}

const CTRL_C_WINDOW_MS = 1000;
const CTRL_C_MAX = 3;

// ─── App Component ─────────────────────────────────────────────────────────────

export const App: React.FC<AppProps> = ({ loop, model, provider }) => {
  const { exit } = useApp();

  // ── State ──────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<DisplayMessage[]>(() =>
    buildDisplayMessages(loop.state),
  );
  const [streamingText, setStreamingText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState({
    model,
    provider,
    inputTokens: loop.state.totalInputTokens,
    outputTokens: loop.state.totalOutputTokens,
    cost: loop.state.totalCost,
    turns: loop.state.turns,
  });

  // ── Refs (stable across renders) ────────────────────────────────────────
  const abortRef = useRef<AbortController | null>(null);
  const streamingRef = useRef('');        // accumulator for streaming text
  const ctrlC = useRef<CtrlCState>({ count: 0, lastTime: 0 });

  // ── Ctrl+C handling ─────────────────────────────────────────────────────
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      const now = Date.now();
      if (now - ctrlC.current.lastTime < CTRL_C_WINDOW_MS) {
        ctrlC.current.count++;
      } else {
        ctrlC.current.count = 1;
      }
      ctrlC.current.lastTime = now;

      if (ctrlC.current.count === 1 && isLoading) {
        // First press → abort current request
        abortRef.current?.abort();
      } else if (ctrlC.current.count >= CTRL_C_MAX) {
        // Triple press → force quit
        exit();
      }
    } else {
      ctrlC.current.count = 0;
    }
  });

  // ── handleSubmit — called when user presses Enter on input ──────────────
  const handleSubmit = useCallback(
    async (input: string) => {
      const trimmed = input.trim();
      if (!trimmed) return;

      // Handle slash commands
      if (trimmed.startsWith('/')) {
        const [cmd, ...args] = trimmed.slice(1).split(/\s+/);
        switch (cmd) {
          case 'exit':
          case 'quit':
            exit();
            return;
          case 'clear':
            loop.reset();
            setMessages([]);
            setStreamingText('');
            setStatus((s) => ({ ...s, inputTokens: 0, outputTokens: 0, cost: 0, turns: 0 }));
            return;
          case 'help':
            setMessages((prev) => [
              ...prev,
              {
                id: `msg-help-${Date.now()}`,
                role: 'assistant',
                content:
                  'Commands: /help /exit /clear /model <id>\n' +
                  'Press Ctrl+C once to abort, three times to force quit.',
              },
            ]);
            return;
          case 'model': {
            const newModel = args.join(' ');
            if (newModel) {
              setStatus((s) => ({ ...s, model: newModel }));
              setMessages((prev) => [
                ...prev,
                { id: `msg-model-${Date.now()}`, role: 'assistant', content: `Switched to model: ${newModel}` },
              ]);
            }
            return;
          }
          default:
            // Unknown command — treat as regular input
            break;
        }
      }

      // Abort any in-flight request
      abortRef.current?.abort();

      // Create fresh AbortController for this run
      const controller = new AbortController();
      abortRef.current = controller;

      // Add user message to display
      const userMsg: DisplayMessage = {
        id: `msg-${Date.now()}-u`,
        role: 'user',
        content: trimmed,
      };
      setMessages((prev) => [...prev, userMsg]);

      // Reset streaming state
      streamingRef.current = '';
      setStreamingText('');
      setIsLoading(true);

      try {
        for await (const chunk of loop.run(trimmed, controller.signal)) {
          switch (chunk.type) {
            case 'text_delta':
              streamingRef.current += chunk.data;
              setStreamingText(streamingRef.current);
              break;

            case 'tool_call':
              // Show tool call inline
              streamingRef.current += `\n  🔧 ${chunk.data.name}(…)`;
              setStreamingText(streamingRef.current);
              break;

            case 'stop': {
              // Flush streaming text to messages
              const finalText = streamingRef.current;
              streamingRef.current = '';
              setStreamingText('');

              if (finalText.trim()) {
                setMessages((prev) => [
                  ...prev,
                  { id: `msg-${Date.now()}-a`, role: 'assistant', content: finalText },
                ]);
              }

              // Sync status from loop state
              setStatus({
                model,
                provider,
                inputTokens: loop.state.totalInputTokens,
                outputTokens: loop.state.totalOutputTokens,
                cost: loop.state.totalCost,
                turns: loop.state.turns,
              });
              break;
            }

            default:
              break;
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          streamingRef.current += '\n⚠ Cancelled.';
          setStreamingText(streamingRef.current);
        } else {
          streamingRef.current += `\n⚠ Error: ${err.message}`;
          setStreamingText(streamingRef.current);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [loop, model, provider, exit],
  );

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <Box flexDirection="column" minHeight={10}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">
          🤖 AI Coder v0.1.0
        </Text>
        <Text dimColor>  |  {status.provider}:{status.model}</Text>
      </Box>

      {/* Output area */}
      <OutputArea messages={messages} streamingText={streamingText} isLoading={isLoading} />

      {/* Status bar */}
      <StatusBar
        model={status.model}
        provider={status.provider}
        inputTokens={status.inputTokens}
        outputTokens={status.outputTokens}
        cost={status.cost}
        turns={status.turns}
        isLoading={isLoading}
      />

      {/* Input panel */}
      <InputPanel
        onSubmit={handleSubmit}
        disabled={isLoading}
        placeholder={
          isLoading
            ? 'Waiting for response…'
            : 'Ask anything (Ctrl+C to abort, ×3 to quit)'
        }
      />
    </Box>
  );
};

// ─── Entry point (called from CLI) ─────────────────────────────────────────────

import { render } from 'ink';

export function renderUI(loop: AgentLoop, model: string, provider: string): void {
  const { unmount, waitUntilExit } = render(
    React.createElement(App, { loop, model, provider }),
  );

  // Clean unmount on exit
  const cleanup = () => {
    unmount();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}
