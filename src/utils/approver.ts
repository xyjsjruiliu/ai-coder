/**
 * Terminal-based interactive approver.
 *
 * Prompts the user for yes/no confirmation before destructive tool operations.
 * Used by write_file, edit_file, and bash tools.
 *
 * IMPORTANT: We open /dev/tty and use synchronous reads (fs.readSync) instead of
 * readline because Ink (and other TUI frameworks) put the terminal in raw mode,
 * which breaks readline's event-driven streaming.  Synchronous reads on a
 * separate fd bypass Ink's stdin interception and handle raw-mode terminals
 * correctly — each keystroke arrives immediately and we echo manually.
 */

import * as fs from 'node:fs';

/**
 * Create an interactive terminal approver.
 * Returns a function that prompts the user for each approval request.
 */
export function createTerminalApprover(): (
  toolName: string,
  params: Record<string, unknown>,
) => Promise<boolean> {
  return async (toolName: string, params: Record<string, unknown>): Promise<boolean> => {
    // Format a human-readable summary of what's about to happen
    const summary = formatApprovalSummary(toolName, params);

    const answer = await askUser(`\n⚠  Approve: ${summary}\n   Proceed? [y/N] `);
    return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
  };
}

/** Format tool name and params into a readable one-line summary. */
function formatApprovalSummary(
  toolName: string,
  params: Record<string, unknown>,
): string {
  switch (toolName) {
    case 'write_file': {
      const p = String(params.path ?? '?');
      const contentLen = String(params.content ?? '').length;
      return `write_file → ${p} (${contentLen} bytes)`;
    }
    case 'edit_file': {
      const p = String(params.path ?? '?');
      return `edit_file → ${p}`;
    }
    case 'bash': {
      const cmd = String(params.command ?? '?');
      const dangerous = params.dangerous as string[] | undefined;
      let summary = `bash → ${cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd}`;
      if (dangerous && dangerous.length > 0) {
        summary += `\n   ⚠️  DANGEROUS: ${dangerous.join(', ')}`;
      }
      return summary;
    }
    default:
      return `${toolName} with params ${JSON.stringify(params).slice(0, 100)}`;
  }
}

/**
 * Prompt the user with a question and return their answer.
 *
 * Opens /dev/tty (the controlling terminal) with a separate file descriptor
 * and reads keystrokes one at a time synchronously.  This works reliably
 * even when:
 *  - Ink has put the terminal in raw mode (no line buffering)
 *  - Ink has intercepted process.stdin (fd 0) for useInput / TextInput
 *  - The terminal echoes are disabled (we echo manually to stderr)
 *
 * Reads until Enter (CR or LF) is pressed.  Backspace is supported.
 */
function askUser(question: string): Promise<string> {
  return new Promise((resolve) => {
    // ── Write the prompt to stderr ────────────────────────────────────────
    // stderr is NOT intercepted by Ink, so the user will see it mixed in with
    // the TUI output (both go to the same terminal).
    process.stderr.write(question);

    // ── Open the real terminal device ─────────────────────────────────────
    let fd: number;
    try {
      fd = fs.openSync('/dev/tty', 'r');
    } catch (err: any) {
      process.stderr.write(
        `\n[approver: cannot open /dev/tty: ${err.message} — auto-denying]\n`,
      );
      resolve('');
      return;
    }

    const buf = Buffer.alloc(1);
    let answer = '';
    let done = false;

    /**
     * Read keystrokes one at a time.  In raw mode each keypress is a
     * single byte, so we accumulate until Enter (CR / LF).
     */
    const readChar = (): void => {
      if (done) return;

      let bytesRead: number;
      try {
        bytesRead = fs.readSync(fd, buf, 0, 1, null);
      } catch (err: any) {
        // fd closed or read error — treat as cancellation
        cleanup();
        process.stderr.write('\n');
        resolve(answer.trim());
        return;
      }

      if (bytesRead === 0) {
        // EOF on /dev/tty (terminal disconnected)
        cleanup();
        resolve(answer.trim());
        return;
      }

      const char = buf.toString('utf-8', 0, 1);

      // Enter key: carriage return (\r, 0x0D) or line feed (\n, 0x0A)
      if (char === '\n' || char === '\r') {
        cleanup();
        process.stderr.write('\n');
        resolve(answer.trim());
        return;
      }

      // Backspace / Delete
      if (char === '\b' || char === '\x7f') {
        if (answer.length > 0) {
          answer = answer.slice(0, -1);
          // Erase the last character on screen: backspace, space, backspace
          process.stderr.write('\b \b');
        }
        readChar();
        return;
      }

      // Printable character: echo to stderr and accumulate
      process.stderr.write(char);
      answer += char;
      readChar();
    };

    const cleanup = (): void => {
      if (done) return;
      done = true;
      try {
        fs.closeSync(fd);
      } catch {
        // fd already closed, ignore
      }
    };

    readChar();
  });
}
