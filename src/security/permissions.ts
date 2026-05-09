/**
 * PermissionEngine — the central decision-maker for tool access and approval.
 *
 * Evaluates every tool call against the current PermissionMode, workspace trust
 * level, and optional tool-specific rules.
 *
 * Usage:
 *   const engine = new PermissionEngine({ mode, workspaceTrusted, workspaceRoot });
 *   const result = engine.check('write_file', params);
 *   if (!result.available) → tool blocked
 *   if (result.requiresApproval) → ask user before executing
 */

import {
  PermissionMode,
  GateContext,
  GateResult,
  SecurityConfig,
} from './types.js';

// ─── Built-in tool gate rules ──────────────────────────────────────────────────

/**
 * Default gate matrix (tool → per-mode behaviour).
 *
 *   ✅  = available, no approval
 *   🔴  = available, requires approval
 *   ❌  = blocked
 */
const BUILTIN_RULES: Record<string, Partial<Record<PermissionMode, { available: boolean; requiresApproval: boolean; reason?: string }>>> = {
  read_file: {
    [PermissionMode.Default]:            { available: true, requiresApproval: false },
    [PermissionMode.AcceptEdits]:        { available: true, requiresApproval: false },
    [PermissionMode.Plan]:               { available: true, requiresApproval: false },
    [PermissionMode.BypassPermissions]:  { available: true, requiresApproval: false },
  },

  write_file: {
    [PermissionMode.Default]:            { available: true, requiresApproval: true },
    [PermissionMode.AcceptEdits]:        { available: true, requiresApproval: false },
    [PermissionMode.Plan]:               { available: false, requiresApproval: false, reason: 'plan mode: write_file is blocked' },
    [PermissionMode.BypassPermissions]:  { available: true, requiresApproval: false },
  },

  edit_file: {
    [PermissionMode.Default]:            { available: true, requiresApproval: true },
    [PermissionMode.AcceptEdits]:        { available: true, requiresApproval: false },
    [PermissionMode.Plan]:               { available: false, requiresApproval: false, reason: 'plan mode: edit_file is blocked' },
    [PermissionMode.BypassPermissions]:  { available: true, requiresApproval: false },
  },

  bash: {
    [PermissionMode.Default]:            { available: true, requiresApproval: true },
    [PermissionMode.AcceptEdits]:        { available: true, requiresApproval: true },
    [PermissionMode.Plan]:               { available: false, requiresApproval: false, reason: 'plan mode: bash is blocked' },
    [PermissionMode.BypassPermissions]:  { available: true, requiresApproval: false },
  },

  web_search: {
    [PermissionMode.Default]:            { available: true, requiresApproval: false },
    [PermissionMode.AcceptEdits]:        { available: true, requiresApproval: false },
    [PermissionMode.Plan]:               { available: true, requiresApproval: false },
    [PermissionMode.BypassPermissions]:  { available: true, requiresApproval: false },
  },

  web_fetch: {
    [PermissionMode.Default]:            { available: true, requiresApproval: true },
    [PermissionMode.AcceptEdits]:        { available: true, requiresApproval: true },
    [PermissionMode.Plan]:               { available: false, requiresApproval: false, reason: 'plan mode: web_fetch is blocked' },
    [PermissionMode.BypassPermissions]:  { available: true, requiresApproval: false },
  },
};

// ─── Engine ────────────────────────────────────────────────────────────────────

export class PermissionEngine {
  private config: SecurityConfig;

  constructor(config: SecurityConfig) {
    this.config = { ...config };
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  get mode(): PermissionMode {
    return this.config.mode;
  }

  get workspaceTrusted(): boolean {
    return this.config.workspaceTrusted;
  }

  get workspaceRoot(): string {
    return this.config.workspaceRoot;
  }

  // ── Mode management ────────────────────────────────────────────────────────

  /** Switch to a different permission mode. Returns false if blocked. */
  setMode(mode: PermissionMode): boolean {
    // bypassPermissions requires explicit user confirmation (handled by caller)
    this.config.mode = mode;
    return true;
  }

  /** Mark the workspace as trusted. */
  trustWorkspace(): void {
    this.config.workspaceTrusted = true;
  }

  /** Build the GateContext for a decision. */
  private ctx(): GateContext {
    return {
      mode: this.config.mode,
      workspaceTrusted: this.config.workspaceTrusted,
      workspaceRoot: this.config.workspaceRoot,
    };
  }

  // ── Gate checks ────────────────────────────────────────────────────────────

  /**
   * Check whether a tool is available AND whether it needs approval.
   *
   * @param toolName  e.g. 'write_file', 'bash', …
   * @param _params   tool parameters (reserved for future contextual rules)
   */
  check(toolName: string, _params?: Record<string, unknown>): GateResult {
    const rules = BUILTIN_RULES[toolName];
    if (!rules) {
      // Unknown tool — conservative: allow with approval
      return { available: true, requiresApproval: true };
    }

    const rule = rules[this.config.mode];
    if (!rule) {
      // Mode not explicitly listed — conservative: block
      return {
        available: false,
        requiresApproval: false,
        reason: `unknown mode "${this.config.mode}" for tool "${toolName}"`,
      };
    }

    return {
      available: rule.available,
      requiresApproval: rule.requiresApproval,
      reason: rule.reason,
    };
  }

  /**
   * Shorthand: is this tool available?
   */
  isAvailable(toolName: string, params?: Record<string, unknown>): boolean {
    return this.check(toolName, params).available;
  }

  /**
   * Shorthand: does this tool need approval?
   */
  needsApproval(toolName: string, params?: Record<string, unknown>): boolean {
    return this.check(toolName, params).requiresApproval;
  }
}
