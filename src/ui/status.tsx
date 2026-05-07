/// <reference types="ink" />

/**
 * Status bar component — shows model, token usage, cost, turn count.
 */

import React from 'react';
import { Text } from 'ink';

export const StatusBar: React.FC = () => {
  return React.createElement(Text, { dimColor: true }, '[Status bar — Phase 1E]');
};
