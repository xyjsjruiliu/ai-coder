/// <reference types="ink" />

/**
 * Output area component — renders streaming text with typing effect.
 */

import React from 'react';
import { Text } from 'ink';

export const OutputArea: React.FC = () => {
  return React.createElement(Text, { dimColor: true }, '[Output area — Phase 1E]');
};
