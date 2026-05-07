/**
 * Context builder — assembles system prompt and project-level context.
 *
 * Reads PROJECT.md, CLAUDE.md, .cursorrules, AGENTS.md
 * from the workspace root and injects them into the system prompt.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const CONTEXT_FILES = [
  'CLAUDE.md',
  'AGENTS.md',
  'PROJECT.md',
  '.cursorrules',
  '.ai-coder.md',
];

export interface WorkspaceContext {
  systemPrompt: string;
  projectContext: string;
}

const DEFAULT_SYSTEM_PROMPT = `You are an AI coding assistant. You help users write, modify, and understand code.
Be concise, helpful, and provide working solutions.`;

/**
 * Build the full workspace context by reading project files
 * from the given workspace root.
 */
export async function buildContext(workspaceRoot: string): Promise<WorkspaceContext> {
  let projectContext = '';

  for (const file of CONTEXT_FILES) {
    try {
      const content = await readFile(resolve(workspaceRoot, file), 'utf-8');
      projectContext += `\n\n--- ${file} ---\n${content}`;
    } catch {
      // File doesn't exist, skip
    }
  }

  return {
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    projectContext: projectContext.trim(),
  };
}

/**
 * Build the full system prompt including project context.
 */
export function buildSystemPrompt(ctx: WorkspaceContext): string {
  let prompt = ctx.systemPrompt;

  if (ctx.projectContext) {
    prompt += `\n\n<project_context>\n${ctx.projectContext}\n</project_context>`;
  }

  return prompt;
}
