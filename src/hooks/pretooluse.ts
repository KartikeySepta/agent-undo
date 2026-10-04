// PreToolUse(shell): auto-snapshot before destructive shell commands (levels full and paranoid),
// so safety does not depend on the model remembering to call take_snapshot.
import { takeSnapshot, listSnapshots } from '../snapshot';
import { readLevel, isProjectDir } from '../config';
import { runHook, lastSnapshotAgeMs, shellCommand, projectDir } from './common';

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
// Absorbs bursts (`rm a && rm b`, retry loops) without letting an older manual/session snapshot
// suppress protection for work done since.
const BURST_MS = 10_000;

runHook('PreToolUse', (input) => {
    const command = shellCommand(input);
    if (!command || !RISKY.test(command)) return;
    const level = readLevel();
    if (level !== 'full' && level !== 'paranoid') return;
    const cwd = projectDir(input);
    if (!isProjectDir(cwd) || lastSnapshotAgeMs(listSnapshots(cwd).filter((s) => s.trigger === 'hook')) < BURST_MS) return;
    takeSnapshot(cwd, { reason: `auto: ${command.slice(0, 80)}`, trigger: 'hook' });
});
