/**
 * Tests for ToolRegistry.
 */

import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../../src/tools/registry.js';

describe('ToolRegistry', () => {
  it('should register and retrieve tools', () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'echo',
      description: 'Echo back input',
      parameters: { type: 'object', properties: { text: { type: 'string' } } },
      execute: async (args) => `echo: ${args.text}`,
    });

    expect(registry.has('echo')).toBe(true);
    expect(registry.getDefinitions()).toHaveLength(1);
  });

  it('should throw on duplicate registration', () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'test',
      description: 't',
      parameters: {},
      execute: async () => 'ok',
    });

    expect(() =>
      registry.register({
        name: 'test',
        description: 't2',
        parameters: {},
        execute: async () => 'ok',
      })
    ).toThrow('already registered');
  });

  it('should execute a registered tool', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'add',
      description: 'Add two numbers',
      parameters: {
        type: 'object',
        properties: {
          a: { type: 'number' },
          b: { type: 'number' },
        },
      },
      execute: async (args) => String(Number(args.a) + Number(args.b)),
    });

    const result = await registry.execute('add', { a: 3, b: 4 });
    expect(result).toBe('7');
  });

  it('should return error for unknown tool', async () => {
    const registry = new ToolRegistry();
    const result = await registry.execute('nonexistent', {});
    expect(result).toContain('Unknown tool');
  });
});
