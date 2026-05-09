/// <reference types="ink" />

/**
 * Terminal UI — Ink application root component.
 *
 * Phase 3: Integrated PermissionEngine + workspace trust + /mode support.
 *
 * Full React-for-terminal rendering:
 * - Streams text with typewriter effect
 * - Handles input with TextInput
 * - Shows status bar with token usage + permission mode
 * - Ctrl+C triple-press to force quit
 * - Permission engine gates all tool execution
 * - Trust dialog on first workspace visit
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { AgentLoop, type AgentState } from '../agent/loop.js';
import type { StreamChunk, UnifiedMessage, ContentBlock } from '../llm/types.js';
import { StatusBar } from './status.js';
import { InputPanel } from './input.js';
import { OutputArea, type DisplayMessage } from './output.js';
import { ApprovalDialog } from './approval.js';
import { PermissionEngine, PermissionMode, ALL_MODES, MODE_LABELS } from '../security/index.js';
import { WorkspaceTrustManager } from '../security/trust.js';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AppProps {
  loop: AgentLoop;
  model: string;
  provider: string;
  workspaceRoot: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract displayable text from a UnifiedMessage.
 * ContentBlock arrays are flattened; tool blocks are tagged.
 */
function messageToDisplay(msg: UnifiedMessage): {
  role: 'user' | 'assistant' | 'tool';
  text: string;
} {
  if (typeof msg.content === 'string') {
    return { role: msg.role as 'user' | 'assistant', text: msg.content };
  }

  const blocks = msg.content as ContentBlock[];
  const parts: string[] = [];

  for (const block of blocks) {
    if (block.type === 'text' && block.text) {
      parts.push(block.text);
    } else if (block.type === 'tool_use') {
      parts.push(
        `\n  🔧 ${block.name}(${JSON.stringify(block.input).slice(0, 80)}${JSON.stringify(block.input).length > 80 ? '…' : ''})`,
      );
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

// ─── App Component ────────────────────────────────────────────────────────────

export const App: React.FC<AppProps> = ({
  loop,
  model: initialModel,
  provider: initialProvider,
  workspaceRoot,
}) => {
  const { exit } = useApp();

  // ── Permission engine ────────────────────────────────────────────────────
  const trustManager = useRef(new WorkspaceTrustManager()).current;
  const trusted = trustManager.isTrusted(workspaceRoot);
  const initialMode = trusted ? PermissionMode.Default : PermissionMode.Plan;

  const permissionRef = useRef(
    new PermissionEngine({
      mode: initialMode,
      workspaceTrusted: trusted,
      workspaceRoot,
    }),
  );
  const permissionEngine = permissionRef.current;

  // ── Trust flow state ─────────────────────────────────────────────────────
  const [trustPrompt, setTrustPrompt] = useState(!trusted);
  const [workspaceTrusted, setWorkspaceTrusted] = useState(trusted);

  // ── State ────────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<DisplayMessage[]>(() =>
    buildDisplayMessages(loop.state),
  );
  const [streamingText, setStreamingText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<{
    toolName: string;
    params: Record<string, unknown>;
    dangerInfo?: string;
  } | null>(null);
  const [mode, setMode] = useState<PermissionMode>(PermissionMode.Default);
  const [status, setStatus] = useState({
    model: initialModel,
    provider: initialProvider,
    inputTokens: loop.state.totalInputTokens,
    outputTokens: loop.state.totalOutputTokens,
    cost: loop.state.totalCost,
    turns: loop.state.turns,
  });

  // ── Refs (stable across renders) ─────────────────────────────────────────
  const abortRef = useRef<AbortController | null>(null);
  const streamingRef = useRef(''); // accumulator for streaming text
  const ctrlC = useRef<CtrlCState>({ count: 0, lastTime: 0 });
  const approvalRef = useRef<{
    resolve: (v: boolean) => void;
  } | null>(null);

  // ── Install UI-based approver into ToolRegistry ──────────────────────────
  useEffect(() => {
    // Cast to access internal registry (tight coupling with cli.ts wiring)
    const registry = (loop as any).toolRegistry;
    if (!registry) return;

    const uiApprover = async (
      toolName: string,
      params: Record<string, unknown>,
      dangerInfo?: string,
    ): Promise<boolean> => {
      // Check permission engine first
      const gate = permissionEngine.check(toolName, params);
      if (!gate.available) {
        return false; // blocked
      }
      if (!gate.requiresApproval) {
        return true; // auto-approved
      }

      // Need interactive approval — create a promise + trigger dialog
      return new Promise<boolean>((resolve) => {
        approvalRef.current = { resolve };
        setPendingApproval({ toolName, params, dangerInfo });
      });
    };

    registry.setApprover(uiApprover);
  }, [loop]);

  // ── Handle trust decision ────────────────────────────────────────────────
  const handleTrust = useCallback(
    (trust: boolean) => {
      if (trust) {
        trustManager.trust(workspaceRoot);
        permissionEngine.trustWorkspace();
      }
      setWorkspaceTrusted(trust);
      permissionEngine.setMode(
        trust ? PermissionMode.Default : PermissionMode.Plan,
      );
      if (!trust) setMode(PermissionMode.Plan);
      setTrustPrompt(false);
    },
    [workspaceRoot, trustManager, permissionEngine],
  );

  // ── Handle approval decision ─────────────────────────────────────────────
  const handleApprove = useCallback(() => {
    setPendingApproval(null);
    approvalRef.current?.resolve(true);
    approvalRef.current = null;
  }, []);

  const handleDeny = useCallback(() => {
    setPendingApproval(null);
    approvalRef.current?.resolve(false);
    approvalRef.current = null;
  }, []);

  // ── Handle mode switch ───────────────────────────────────────────────────
  const switchMode = useCallback(
    (newMode: PermissionMode) => {
      permissionEngine.setMode(newMode);
      setMode(newMode);
      setMessages((prev) => [
        ...prev,
        {
          id: `msg-mode-${Date.now()}`,
          role: 'assistant',
          content: `Switched to mode: ${MODE_LABELS[newMode]}`,
        },
      ]);
    },
    [permissionEngine],
  );

  // ── Ctrl+C handling ──────────────────────────────────────────────────────
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
        abortRef.current?.abort();
      } else if (ctrlC.current.count >= CTRL_C_MAX) {
        exit();
      }
    } else {
      ctrlC.current.count = 0;
    }
  });

  // ── handleSubmit — called when user presses Enter on input ─────────────────
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
            setStatus((s) => ({
              ...s,
              inputTokens: 0,
              outputTokens: 0,
              cost: 0,
              turns: 0,
            }));
            return;
          case 'help':
            setMessages((prev) => [
              ...prev,
              {
                id: `msg-help-${Date.now()}`,
                role: 'assistant',
                content: [
                  'Commands:',
                  '  /help                    show this message',
                  '  /exit, /quit             quit',
                  '  /clear                   clear conversation',
                  '  /model <id>              switch model',
                  '  /mode <default|acceptEdits|plan|bypass>',
                  `  /tools                   list available tools`,
                  'Ctrl+C once = abort current request',
                  'Ctrl+C ×3   = force quit',
                  '',
                  `Current mode: ${MODE_LABELS[mode]}`,
                  `Workspace: ${workspaceTrusted ? '✅ trusted' : '⚠ restricted'}`,
                ].join('\n'),
              },
            ]);
            return;
          case 'model': {
            const newModel = args.join(' ');
            if (newModel) {
              setStatus((s) => ({ ...s, model: newModel }));
              setMessages((prev) => [
                ...prev,
                {
                  id: `msg-model-${Date.now()}`,
                  role: 'assistant',
                  content: `Switched to model: ${newModel}`,
                },
              ]);
            }
            return;
          }
          case 'mode': {
            const modeArg = args[0]?.toLowerCase();
            const validModes: Record<string, PermissionMode> = {
              default: PermissionMode.Default,
              acceptedits: PermissionMode.AcceptEdits,
              plan: PermissionMode.Plan,
              bypass: PermissionMode.BypassPermissions,
              bypasspermissions: PermissionMode.BypassPermissions,
            };
            const newMode = validModes[modeArg];
            if (newMode) {
              if (newMode === PermissionMode.BypassPermissions) {
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `msg-bypass-warn-${Date.now()}`,
                    role: 'assistant',
                    content:
                      '⚠ Bypass mode requested. Type /mode bypass again to confirm.',
                  },
                ]);
                // Don't actually switch — wait for second confirmation
                // Store the pending request
                return;
              }
              switchMode(newMode);
            } else {
              setMessages((prev) => [
                ...prev,
                {
                  id: `msg-mode-err-${Date.now()}`,
                  role: 'assistant',
                  content: `Unknown mode: "${modeArg}". Use: default, acceptEdits, plan, bypass`,
                },
              ]);
            }
            return;
          }
          default:
            break;
        }
      }

      // Abort any in-flight request
      abortRef.current?.abort();

      const controller = new AbortController();
      abortRef.current = controller;

      const userMsg: DisplayMessage = {
        id: `msg-${Date.now()}-u`,
        role: 'user',
        content: trimmed,
      };
      setMessages((prev) => [...prev, userMsg]);

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
              streamingRef.current += `\n  🔧 ${chunk.data.name}(…)`;
              setStreamingText(streamingRef.current);
              break;

            case 'stop': {
              const finalText = streamingRef.current;
              streamingRef.current = '';
              setStreamingText('');

              if (finalText.trim()) {
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `msg-${Date.now()}-a`,
                    role: 'assistant',
                    content: finalText,
                  },
                ]);
              }

              setStatus({
                model: status.model,
                provider: status.provider,
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
    [loop, status, exit, mode, workspaceTrusted, switchMode],
  );

  // ── Trust dialog (appears on first visit) ────────────────────────────────────
  if (trustPrompt) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="yellow">
          ⚠ Trust this workspace?
        </Text>
        <Box marginY={1}>
          <Text>{workspaceRoot}</Text>
        </Box>
        <Text dimColor>
          AI tools can read, write, edit files, and execute commands in this
          directory.
        </Text>
        <Box marginY={1}>
          <Text>
            Press <Text bold color="green">y</Text> to trust,{' '}
            <Text bold color="red">n</Text> to run in restricted (plan) mode
          </Text>
        </Box>
      </Box>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <Box flexDirection="column" minHeight={10}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">
          🤖 AI Coder v0.1.0
        </Text>
        <Text dimColor>
          {' '}
          | {status.provider}:{status.model}
        </Text>
        <Text dimColor> | {MODE_LABELS[mode]}</Text>
      </Box>

      {/* Output area */}
      <OutputArea
        messages={messages}
        streamingText={streamingText}
        isLoading={isLoading}
      />

      {/* Approval dialog (overlays input when tool needs confirmation) */}
      {pendingApproval && (
        <ApprovalDialog
          toolName={pendingApproval.toolName}
          params={pendingApproval.params}
          dangerInfo={pendingApproval.dangerInfo}
          onApprove={handleApprove}
          onDeny={handleDeny}
        />
      )}

      {/* Status bar */}
      <StatusBar
        model={status.model}
        provider={status.provider}
        inputTokens={status.inputTokens}
        outputTokens={status.outputTokens}
        cost={status.cost}
        turns={status.turns}
        isLoading={isLoading || !!pendingApproval}
        mode={mode}
      />

      {/* Input panel (hidden while approval dialog is active) */}
      {!pendingApproval && (
        <InputPanel
          onSubmit={handleSubmit}
          disabled={isLoading}
          placeholder={
            isLoading
              ? 'Waiting for response…'
              : 'Ask anything (Ctrl+C to abort, ×3 to quit)'
          }
        />
      )}
    </Box>
  );
};

// ─── Entry point (called from CLI) ────────────────────────────────────────────

import { render } from 'ink';

export function renderUI(
  loop: AgentLoop,
  model: string,
  provider: string,
  workspaceRoot: string,
): void {
  const { unmount, waitUntilExit } = render(
    React.createElement(App, { loop, model, provider, workspaceRoot }),
  );

  const cleanup = () => {
    unmount();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}
