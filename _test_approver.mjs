/**
 * Standalone test for the terminal approver.
 * Tests that /dev/tty-based synchronous reads work correctly
 * without being blocked by stdin interception.
 */

import { createTerminalApprover } from './dist/index.js';

const approver = createTerminalApprover();

console.log('Testing createTerminalApprover...');
console.log('You should see a prompt: "⚠  Approve: write_file → test.txt (12 bytes)"');
console.log('Type "y" and press Enter to approve, or "n" to deny.\n');

const result = await approver('write_file', { path: 'test.txt', content: 'Hello World!' });
console.log(`\nResult: approved=${result}`);
console.log('Approver test complete!');
