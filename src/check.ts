// Green snapshots: run the project's check command and record the result on the snapshot that
// matches the current tree, so "revert last-green" always means the newest state that worked.
import { listSnapshots, takeSnapshot, markSnapshot, diffSnapshot, readCheckConfig, SnapshotMeta, DiffResult } from './snapshot';
import { runIn, RunResult } from './try';

export interface CheckOptions { stdio?: 'inherit' | 'pipe'; timeoutMs?: number }

export interface CheckResult {
    ok: boolean;
    command: string;
    run: RunResult;
    /** The snapshot now carrying the mark; null when the check failed on a tree no snapshot matches. */
    snapshot: SnapshotMeta | null;
}

const isEmpty = (d: DiffResult) => !d.added.length && !d.modified.length && !d.deleted.length;

/**
 * Run `command` (default: the saved check) in the project. A pass marks the matching snapshot green,
 * taking one first if the tree moved since the last. A fail marks the matching snapshot red; a failing
 * tree that no snapshot matches is not worth keeping, so nothing is taken.
 */
export function runCheck(sourceDir: string, command?: string, opts: CheckOptions = {}): CheckResult {
    const cmd = command ?? readCheckConfig(sourceDir)?.command;
    if (!cmd) throw new Error('[Agent-Undo] No check command saved. Run `agent-undo check --set "<command>"` once, or pass the command.');
    const run = runIn(sourceDir, cmd, { stdio: opts.stdio ?? 'inherit', timeoutMs: opts.timeoutMs });
    const ok = run.status === 0;
    const latest = listSnapshots(sourceDir).at(-1);
    let snapshot: SnapshotMeta | null = null;
    if (latest && isEmpty(diffSnapshot(sourceDir, latest.id))) {
        snapshot = markSnapshot(sourceDir, latest.id, { ok, command: cmd });
    } else if (ok) {
        const taken = takeSnapshot(sourceDir, { reason: `check passed: ${cmd.replace(/\s+/g, ' ').slice(0, 60)}`, trigger: 'check' });
        snapshot = markSnapshot(sourceDir, taken.id, { ok, command: cmd });
    }
    return { ok, command: cmd, run, snapshot };
}
