/**
 * Tests for Agent Loop.
 */

import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../../src/tools/registry.js';

// Importing AgentLoop would require a provider, so we test the registry
// and state management in isolation for now.
describe('Agent Loop infrastructure', () => {
  it('tool registry can produce tool definitions for LLM', () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'read_file',
      description: 'Read a file from disk',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
      },
      execute: async () => 'content',
    });

    const defs = registry.getDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('read_file');
    expect(defs[0].input_schema).toBeDefined();
  });
});
