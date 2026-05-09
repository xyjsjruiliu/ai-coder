/// <reference types="ink" />

/**
 * ApprovalDialog — Ink component shown when a tool needs user confirmation.
 *
 * Displays an overlay box with tool info (name, params, danger warning)
 * and waits for the user to press y/n.
 */

import React from 'react';
import { Box, Text, useInput } from 'ink';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ApprovalDialogProps {
  toolName: string;
  params: Record<string, unknown>;
  dangerInfo?: string;
  onApprove: () => void;
  onDeny: () => void;
}

// ─── Component ─────────────────────────────────────────────────────────────────

export const ApprovalDialog: React.FC<ApprovalDialogProps> = ({
  toolName,
  params,
  dangerInfo,
  onApprove,
  onDeny,
}) => {
  useInput((input) => {
    const key = input.toLowerCase();
    if (key === 'y') onApprove();
    else if (key === 'n') onDeny();
  });

  // Show the most relevant param(s)
  const paramDisplay = (() => {
    if (params.path) return `Path: ${params.path}`;
    if (params.command) return `Command: ${String(params.command).slice(0, 60)}`;
    if (params.url) return `URL: ${params.url}`;
    const entries = Object.entries(params).slice(0, 2);
    return entries.map(([k, v]) => `${k}: ${String(v).slice(0, 40)}`).join(', ');
  })();

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={2}
      paddingY={1}
      marginY={1}
    >
      <Text bold color="yellow">
        ⚠ Approve tool call?
      </Text>
      <Box marginTop={1}>
        <Text>
          Tool: <Text bold>{toolName}</Text>
        </Text>
      </Box>
      <Box>
        <Text dimColor>{paramDisplay}</Text>
      </Box>
      {dangerInfo && (
        <Box marginTop={1}>
          <Text color="red">⚠ {dangerInfo}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text>
          Press <Text bold color="green">y</Text> to approve,{' '}
          <Text bold color="red">n</Text> to deny
        </Text>
      </Box>
    </Box>
  );
};
