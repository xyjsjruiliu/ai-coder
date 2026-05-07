/**
 * Tool Registry — manages registered tools and dispatches execution.
 */

import { Tool } from './types.js';

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  /** Register a tool */
  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  /** Remove a tool */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /** List all registered tool definitions (for sending to LLM) */
  getDefinitions(): Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }> {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  /** Execute a tool by name */
  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      return `Error: Unknown tool "${name}"`;
    }
    try {
      return await tool.execute(args);
    } catch (err) {
      return `Error executing "${name}": ${(err as Error).message}`;
    }
  }

  /** Check if a tool exists */
  has(name: string): boolean {
    return this.tools.has(name);
  }
}
