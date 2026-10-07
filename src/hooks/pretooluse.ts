// PreToolUse(shell, Write, Edit), levels full and paranoid:
//  - auto-snapshot before destructive shell commands, so safety does not depend on the model
//    remembering to call take_snapshot;
//  - auto-snapshot before a Write/Edit that clobbers most of a file (git cannot recover uncommitted work);
//  - for commands that act outside the project and cannot be rolled back (force-push, deploys,
//    infra applies, remote/production databases), ask the user first (Claude Code only).
import fs from 'fs';
import path from 'path';
import { takeSnapshot, listSnapshots } from '../snapshot';
import { readLevel, isProjectDir } from '../config';
import { runHook, lastSnapshotAgeMs, shellCommand, projectDir, emitAsk, HookInput } from './common';

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

/** Commands whose effect lives outside the project directory and that no snapshot can undo. */
const IRREVERSIBLE: [RegExp, string][] = [
    [/\bgit\s+push\b[^|;&\n]*(\s(-f|--force|--force-with-lease(=\S+)?|--force-if-includes)(?=\s|$)|\s\+[\w./-]+)/i, 'force-push rewrites the remote branch'],
    [/\bterraform\s+(apply|destroy)\b/i, 'terraform changes real infrastructure'],
    [/\bkubectl\s+(delete|apply|replace|drain)\b/i, 'kubectl changes a live cluster'],
    [/\b(vercel|netlify)\b[^|;&\n]*\s--prod\b/i, 'production deploy'],
    [/\bfly(ctl)?\s+deploy\b/i, 'production deploy'],
    [/\bheroku\s+(pg:(reset|push|killall)|apps:destroy|addons:destroy|config:(set|unset)|run\b|releases:rollback|ps:(scale|restart|stop)|maintenance|container:release)/i, 'heroku changes a hosted app'],
];

const DB_URL = /\b(postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|mssql|sqlserver|cockroachdb):\/\/(?:[^\s@/'"]*@)?([^\s:/'"?]+)/gi;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);
const DB_DESTRUCTIVE = /\b(drop\s+(database|schema|table)|truncate|reset|delete\s+from|migrate|db\s+push)\b/i;
// "prod"/"production" as its own token (prod-db.sh, deploy:prod, --env=production), not "product".
const PROD = /(^|[^a-z])prod(uction)?([^a-z]|$)/i;
const PROD_ACTION = /\b(reset|drop|deploy|migrate|destroy|truncate|seed|wipe|purge)\b/i;

/** Why `command` cannot be rolled back by a snapshot, or null if it is not that kind of command. */
export function irreversibleReason(command: string): string | null {
    for (const [re, why] of IRREVERSIBLE) if (re.test(command)) return why;
    const remoteDb = [...command.matchAll(DB_URL)].some((m) => !LOCAL_HOSTS.has(m[2].toLowerCase()));
    if (remoteDb && DB_DESTRUCTIVE.test(command)) return 'destructive statement against a remote database';
    if (PROD.test(command) && PROD_ACTION.test(command)) return 'acts on production';
    return null;
}

// Absorbs bursts (`rm a && rm b`, retry loops) without letting an older manual/session snapshot
// suppress protection for work done since.
const BURST_MS = 10_000;

// An edit only counts as destructive when it throws away most of a file that was big enough to matter.
const CLOBBER_MIN_BYTES = 2048;

/** Why this Write/Edit/MultiEdit destroys most of an existing file's content, or null. */
export function clobberReason(input: HookInput): string | null {
    const ti = input.tool_input;
    const file = ti?.file_path;
    if (!file) return null;
    const label = path.basename(file);
    if (input.tool_name === 'Write' && typeof ti.content === 'string') {
        let before: number;
        try { before = fs.statSync(file).size; } catch { return null; } // a new file destroys nothing
        const after = Buffer.byteLength(ti.content);
        return before >= CLOBBER_MIN_BYTES && after < before / 2 ? `Write shrinks ${label} from ${before} to ${after} bytes` : null;
    }
    if (input.tool_name === 'Edit' || input.tool_name === 'MultiEdit') {
        const edits = input.tool_name === 'Edit' ? [{ old_string: ti.old_string, new_string: ti.new_string }] : ti.edits ?? [];
        const removed = edits.reduce((n, e) => n + Math.max(0, (e.old_string?.length ?? 0) - (e.new_string?.length ?? 0)), 0);
        const replaced = edits.reduce((n, e) => n + (e.old_string?.length ?? 0), 0);
        return removed >= CLOBBER_MIN_BYTES && removed > replaced / 2 ? `${input.tool_name} deletes ${removed} characters from ${label}` : null;
    }
    return null;
}

runHook('PreToolUse', (input) => {
    const level = readLevel();
    if (level !== 'full' && level !== 'paranoid') return;

    let auto: string | null = null;
    const command = shellCommand(input);
    if (command) {
        const why = irreversibleReason(command);
        if (why) {
            emitAsk(`agent-undo cannot roll this back: it acts outside the project (${why}). Snapshots only cover the project directory. Confirm with the user before running it.`);
        }
        if (RISKY.test(command)) auto = `auto: ${command.slice(0, 80)}`;
    } else {
        const clobber = clobberReason(input);
        if (clobber) auto = `auto: ${clobber}`;
    }
    if (!auto) return;

    const cwd = projectDir(input);
    if (!isProjectDir(cwd) || lastSnapshotAgeMs(listSnapshots(cwd).filter((s) => s.trigger === 'hook')) < BURST_MS) return;
    takeSnapshot(cwd, { reason: auto, trigger: 'hook' });
});
