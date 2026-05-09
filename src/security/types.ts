/**
 * Phase 3 — Permission Security Engine: types and interfaces.
 *
 * Three-layer security model:
 *   Layer 1: PermissionMode   — session-wide security posture
 *   Layer 2: WorkspaceTrust   — directory-level trust (persisted)
 *   Layer 3: ToolGate         — fine-grained per-tool access control
 */

// ─── Permission Mode ───────────────────────────────────────────────────────────

/** Session-wide security posture. */
export enum PermissionMode {
  /** Write / bash / web_fetch require approval; read-only ops auto-pass. */
  Default = 'default',

  /** File edits auto-approved (within workspace); bash / web_fetch still require approval. */
  AcceptEdits = 'acceptEdits',

  /** All mutating tools are read-only / blocked. Only read_file + web_search allowed. */
  Plan = 'plan',

  /** Everything auto-approved. Requires explicit confirmation to enter. */
  BypassPermissions = 'bypassPermissions',
}

export const ALL_MODES: PermissionMode[] = [
  PermissionMode.Default,
  PermissionMode.AcceptEdits,
  PermissionMode.Plan,
  PermissionMode.BypassPermissions,
];

/** Human-readable labels for each mode. */
export const MODE_LABELS: Record<PermissionMode, string> = {
  [PermissionMode.Default]: 'Default',
  [PermissionMode.AcceptEdits]: 'Accept Edits',
  [PermissionMode.Plan]: 'Plan (read-only)',
  [PermissionMode.BypassPermissions]: 'Bypass Permissions',
};

// ─── Security Config ───────────────────────────────────────────────────────────

export interface SecurityConfig {
  /** Current permission mode. */
  mode: PermissionMode;

  /** Whether the current workspace is trusted. */
  workspaceTrusted: boolean;

  /** Absolute path to the workspace root. */
  workspaceRoot: string;
}

// ─── Gate Context (passed to every gate check) ─────────────────────────────────

export interface GateContext {
  mode: PermissionMode;
  workspaceTrusted: boolean;
  workspaceRoot: string;
}

// ─── Tool Gate Rule ────────────────────────────────────────────────────────────

/** Outcome of a gate check. */
export interface GateResult {
  /** Whether this tool is available at all. */
  available: boolean;

  /** If available, whether user approval is required before execution. */
  requiresApproval: boolean;

  /** Human-readable reason when blocked or restricted. */
  reason?: string;
}

/** Per-tool rule evaluated against the current GateContext. */
export interface ToolGateRule {
  toolName: string;
  evaluate(ctx: GateContext): GateResult;
}
