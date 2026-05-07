#!/usr/bin/env node
/// <reference types="ink" />

/**
 * Terminal UI — Ink application root component.
 *
 * Full React-for-terminal rendering:
 * - Streams text with typewriter effect
 * - Handles input with TextInput
 * - Shows status bar with token usage
 */

import React from 'react';
import { render } from 'ink';

const App: React.FC = () => {
  return (
    <>
      {/* TODO: Phase 1E implementation */}
    </>
  );
};

export function renderUI(_model: string, _provider: string): void {
  const { unmount } = render(React.createElement(App));
  process.on('exit', unmount);
}
