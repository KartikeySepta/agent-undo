#!/usr/bin/env node
// Claude Code PreToolUse hook: auto-snapshot before destructive Bash commands,
// so safety does not depend on the model remembering to call take_snapshot.
const { takeSnapshot, listSnapshots } = require('../dist/snapshot');

const RISKY = /\b(rm\s+-\w*[rf]|npm\s+(install|i|uninstall|ci)\b|yarn\s+(add|remove)|pnpm\s+(add|remove|install)|pip\s+install|git\s+(reset\s+--hard|clean|checkout\s+\.|restore)|prisma\s+migrate|drop\s+(table|database)|mv\s+\S+\s+\/dev\/null|truncate)\b/i;
const THROTTLE_MS = 60_000;

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw);
    if (input.tool_name !== 'Bash' || !RISKY.test(input.tool_input?.command ?? '')) return;
    const cwd = input.cwd || process.cwd();
    const last = listSnapshots(cwd).at(-1);
    if (last && Date.now() - Date.parse(last.createdAt) < THROTTLE_MS) return;
    takeSnapshot(cwd, { reason: `auto: ${String(input.tool_input.command).slice(0, 80)}` });
  } catch { /* never block the tool call on hook failure */ }
});
