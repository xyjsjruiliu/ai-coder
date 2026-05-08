/**
 * Tool type definitions and base interfaces.
 */

/** Context injected into every tool execution. */
export interface ToolContext {
  /** Absolute path to the workspace root. All file paths are relative to this. */
  workspaceRoot: string;
  /**
   * Optional approval callback. Destructive tools (write, edit, bash)
   * call this before executing. Return true to approve, false to deny.
   */
  approver?: (toolName: string, params: Record<string, unknown>) => Promise<boolean>;
}

export interface Tool {
  /** Unique tool name (must match what LLM sends back) */
  name: string;

  /** Human-readable description sent to the LLM */
  description: string;

  /** JSON Schema for the tool's input parameters */
  parameters: Record<string, unknown>;

  /**
   * Execute the tool with the given arguments.
   * Returns the result as a string (JSON-serialized object).
   */
  execute(args: Record<string, unknown>, context: ToolContext): Promise<string>;
}

/** Result returned by a tool execution. */
export interface ToolResult {
  /** Tool name that produced this result */
  tool: string;
  /** Result content (plain text or JSON string) */
  content: string;
  /** Whether the tool call succeeded */
  success: boolean;
  /** Optional error message if success is false */
  error?: string;
}
