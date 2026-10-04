// Claude Code PreToolUse hook: auto-snapshot before destructive Bash commands,
// so safety does not depend on the model remembering to call take_snapshot.
import { takeSnapshot, listSnapshots } from '../snapshot';

export const RISKY = new RegExp(
  [
    String.raw`\brm\s+-\w*[rf]`,
    String.raw`\b(npm|pnpm|yarn|bun)\s+(install|i|add|remove|uninstall|ci|update|upgrade)\b`,
    String.raw`\bpip3?\s+(install|uninstall)\b`,
    String.raw`\bgit\s+(reset\s+--hard|clean\b|checkout\s+(--\s+)?\.|restore\b|stash\b)`,
    String.raw`\b(prisma|drizzle-kit|knex|sequelize|alembic|rails)\b.*\b(migrate|push|reset|drop)\b`,
    String.raw`\bdrop\s+(table|database|schema)\b`,
    String.raw`\btruncate\b`,
    String.raw`\bfind\b.*\s-delete\b`,
    String.raw`\b(sed|perl)\s+-i\b`,
  ].join('|'),
  'i',
);
const THROTTLE_MS = 60_000;

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw);
    const command: string = input.tool_input?.command ?? '';
    if (input.tool_name !== 'Bash' || !RISKY.test(command)) return;
    const cwd = input.cwd || process.cwd();
    const last = listSnapshots(cwd).at(-1);
    if (last && Date.now() - Date.parse(last.createdAt) < THROTTLE_MS) return;
    takeSnapshot(cwd, { reason: `auto: ${command.slice(0, 80)}` });
  } catch {
    // Never block the tool call: a busy lock, unsafe dir, or bad input just skips the snapshot.
  }
});
