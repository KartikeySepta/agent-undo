// "Try it over there first": run a command in a fork of the project and swap the result in only if
// it, and an optional check, succeed. Nothing in the project changes until that final swap, which
// is an ordinary revert to the fork and therefore undoable through its pre-revert backup.
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import {
    fork, takeSnapshot, deleteSnapshot, diffSnapshot, diffSnapshots, revertSnapshot, SnapshotMeta, DiffResult,
} from './snapshot';
import { recordStats } from './stats';

export interface RunResult {
    status: number | null;
    signal: string | null;
    timedOut: boolean;
    /** Captured output; empty when stdio is inherited. */
    stdout: string;
    stderr: string;
}

export interface TryOptions {
    /** Must exit 0 inside the fork before the result is applied. */
    check?: string;
    timeoutMs?: number;
    /** 'inherit' streams the command's output (CLI); 'pipe' captures it (MCP). */
    stdio?: 'inherit' | 'pipe';
    env?: NodeJS.ProcessEnv;
    /** Link the fork to the project's git repository for the run (a gitfile), so husky, `git describe` and friends work. Git writes made in the fork reach the real repository. */
    git?: boolean;
    onEvent?: (e: TryEvent) => void;
}

export type TryEvent =
    | { type: 'fork'; meta: SnapshotMeta }
    | { type: 'run'; command: string }
    | { type: 'check'; command: string }
    | { type: 'apply' };

export type TryStage = 'command' | 'check' | 'drift' | 'applied';

export interface TryResult {
    ok: boolean;
    stage: TryStage;
    input: { command: string; check?: string };
    command: RunResult;
    check?: RunResult;
    /** Kept when the try fails so it can be inspected or applied by hand; deleted after a successful apply. */
    fork: SnapshotMeta;
    /** stage 'drift': what changed in the project while the command ran. */
    drift?: DiffResult;
    applied?: { backup: SnapshotMeta; changed: DiffResult; fixedPaths: number };
}

const PATH_FIX_MAX_BYTES = 1024 * 1024;
const MAX_OUTPUT = 64 * 1024 * 1024;

const realDir = (dir: string) => { try { return fs.realpathSync(dir); } catch { return path.resolve(dir); } };
const short = (cmd: string) => cmd.replace(/\s+/g, ' ').trim().slice(0, 60);
const isEmpty = (d: DiffResult) => !d.added.length && !d.modified.length && !d.deleted.length;

/** Run a shell command in `dir`. Never throws for a non-zero exit or a timeout; both show in the result. */
export function runIn(dir: string, command: string, opts: TryOptions = {}): RunResult {
    const argv = process.platform === 'win32' ? ['cmd', '/d', '/s', '/c', command] : ['sh', '-c', command];
    const r = spawnSync(argv[0], argv.slice(1), {
        cwd: dir, env: opts.env ?? process.env, stdio: opts.stdio ?? 'inherit',
        timeout: opts.timeoutMs, killSignal: 'SIGTERM', encoding: 'utf8', maxBuffer: MAX_OUTPUT,
    });
    const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
    if (r.error && !timedOut) throw r.error;
    return { status: r.status, signal: r.signal, timedOut, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/**
 * Tools such as pip write the directory they ran in into the files they create (shebangs, venv
 * configs). After the swap those would point at the deleted fork: rewrite them to the project path.
 * Text files only, up to 1 MB; returns how many files changed.
 */
function fixForkPaths(projectDir: string, forkDir: string, files: string[]): number {
    const from = [...new Set([forkDir, realDir(forkDir)])];
    const to = realDir(projectDir);
    let fixed = 0;
    for (const rel of files) {
        const p = path.join(projectDir, rel);
        let st: fs.Stats;
        try { st = fs.lstatSync(p); } catch { continue; }
        if (!st.isFile() || st.size > PATH_FIX_MAX_BYTES) continue;
        const buf = fs.readFileSync(p);
        if (buf.subarray(0, 8192).includes(0)) continue;
        const text = buf.toString('utf8');
        const next = from.reduce((t, f) => t.split(f).join(to), text);
        if (next !== text) { fs.writeFileSync(p, next, { mode: st.mode }); fixed++; }
    }
    return fixed;
}

const discardQuiet = (sourceDir: string, id: string) => { try { deleteSnapshot(sourceDir, id); } catch { /* best effort */ } };

/**
 * Make the fork a worktree of the project's repository for the duration of a run: a gitfile pointing
 * at the real .git. Returns the function that removes it; a gitfile must never stay in snapshot data.
 */
function linkGit(projectDir: string, forkDir: string): () => void {
    const gitPath = path.join(projectDir, '.git');
    let st: fs.Stats;
    try { st = fs.statSync(gitPath); } catch { return () => {}; }
    let gitdir = realDir(gitPath);
    if (st.isFile()) {
        // The project is itself a linked worktree: follow its gitfile rather than chaining them.
        const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(gitPath, 'utf8'));
        if (!m) return () => {};
        gitdir = path.resolve(projectDir, m[1]);
    }
    const file = path.join(forkDir, '.git');
    fs.writeFileSync(file, `gitdir: ${gitdir}\n`);
    return () => fs.rmSync(file, { force: true });
}

export function tryInFork(sourceDir: string, command: string, opts: TryOptions = {}): TryResult {
    const label = short(command);
    // The frozen base exists only to detect edits made to the project while the command ran.
    const base = takeSnapshot(sourceDir, { reason: `try base: ${label}`, trigger: 'fork' });
    const f = fork(sourceDir, `try: ${label}`);
    opts.onEvent?.({ type: 'fork', meta: f.meta });
    // GIT_CEILING_DIRECTORIES: git inside the fork must never climb out of it and find, say, a dotfiles
    // repository in the home directory that holds the snapshot store.
    const env = { ...(opts.env ?? process.env), AGENT_UNDO_FORK: f.dir, AGENT_UNDO_PROJECT: realDir(sourceDir), GIT_CEILING_DIRECTORIES: path.dirname(f.dir) };
    const run = (cmd: string) => runIn(f.dir, cmd, { ...opts, env });
    const input = { command, check: opts.check };
    const fail = (stage: TryStage, r: Omit<TryResult, 'ok' | 'stage' | 'input' | 'fork'>): TryResult => {
        discardQuiet(sourceDir, base.id);
        recordStats((st) => { st.tries++; });
        return { ok: false, stage, input, fork: f.meta, ...r };
    };

    let cmd: RunResult;
    let check: RunResult | undefined;
    const unlinkGit = opts.git ? linkGit(sourceDir, f.dir) : () => {};
    try {
        opts.onEvent?.({ type: 'run', command });
        cmd = run(command);
        if (cmd.status === 0 && opts.check) {
            opts.onEvent?.({ type: 'check', command: opts.check });
            check = run(opts.check);
        }
    } finally { unlinkGit(); }
    if (cmd.status !== 0) return fail('command', { command: cmd });
    if (check && check.status !== 0) return fail('check', { command: cmd, check });
    const drift = diffSnapshot(sourceDir, base.id);
    if (!isEmpty(drift)) return fail('drift', { command: cmd, check, drift });

    opts.onEvent?.({ type: 'apply' });
    const changed = diffSnapshots(sourceDir, base.id, f.meta.id);
    const { backup } = revertSnapshot(sourceDir, f.meta.id);
    const fixedPaths = fixForkPaths(sourceDir, f.dir, [...changed.added, ...changed.modified]);
    discardQuiet(sourceDir, f.meta.id);
    discardQuiet(sourceDir, base.id);
    recordStats((st) => { st.tries++; st.triesApplied++; });
    return { ok: true, stage: 'applied', input, command: cmd, check, fork: f.meta, applied: { backup, changed, fixedPaths } };
}

/** Human-readable outcome, in the CLI's vocabulary or the MCP tools'. */
export function describeTry(r: TryResult, voice: 'cli' | 'mcp' = 'cli'): string {
    const id = r.fork.id;
    const keep = voice === 'cli'
        ? `The fork is kept as ${id}: \`agent-undo path ${id}\` to inspect it, \`agent-undo delete ${id}\` to drop it.`
        : `The fork is kept as snapshot ${id}: read_snapshot_file(path, snapshot: "${id}") shows a file as the command left it; revert_environment with snapshot "${id}" would apply it anyway.`;
    const undo = (snap: string) => voice === 'cli' ? `agent-undo revert ${snap} --yes` : `revert_environment with snapshot "${snap}"`;
    switch (r.stage) {
        case 'applied': {
            const { changed, backup, fixedPaths } = r.applied!;
            const n = changed.added.length + changed.modified.length + changed.deleted.length;
            return [
                `Try passed: applied ${n} change(s) (${changed.added.length} added, ${changed.modified.length} modified, ${changed.deleted.length} deleted).`,
                ...(fixedPaths ? [`Rewrote the fork path to the project path in ${fixedPaths} file(s).`] : []),
                `Undo with: ${undo(backup.id)}`,
            ].join('\n');
        }
        case 'command':
            return `Command exited with ${r.command.timedOut ? 'timeout' : r.command.status ?? r.command.signal}. Project unchanged.\n${keep}`;
        case 'check':
            return `Check "${r.input.check}" failed (exit ${r.check!.timedOut ? 'timeout' : r.check!.status ?? r.check!.signal}) in the fork. Project unchanged.\n${keep}`;
        case 'drift': {
            const files = [...r.drift!.added, ...r.drift!.modified, ...r.drift!.deleted];
            return `The project changed while the try ran (${files.length} file(s): ${files.slice(0, 5).join(', ')}${files.length > 5 ? ', ...' : ''}). Nothing applied.\n` +
                `The fork is kept as ${id}; to apply it anyway: ${undo(id)}`;
        }
    }
}
