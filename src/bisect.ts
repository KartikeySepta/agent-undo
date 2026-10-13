// "Which one broke it": binary search over the snapshot timeline (plus the working tree) with the
// project's check. Each candidate is checked inside a scratch clone, so snapshots are never
// modified, and every result is stored as a green/red mark so the next bisect starts from them.
import fs from 'fs';
import path from 'path';
import {
    listSnapshots, resolveSnapshot, markSnapshot, diffSnapshot, diffSnapshots, snapshotDir, snapshotBase,
    fork, deleteSnapshot, readCheckConfig, SnapshotMeta, DiffResult, Trigger,
} from './snapshot';
import { cloneEntries, forceRemove } from './clone';
import { runIn } from './try';

export type Candidate = SnapshotMeta | 'now';

export interface BisectOptions {
    /** Default: the saved check command. */
    check?: string;
    /** Oldest candidate to consider (id or name). Default: the oldest snapshot. */
    good?: string;
    /** Newest candidate to consider. Default: the working tree, or the newest snapshot when it matches the tree. */
    bad?: string;
    /** Re-run the check even where a mark from this same command is stored. */
    fresh?: boolean;
    stdio?: 'inherit' | 'pipe';
    timeoutMs?: number;
    onTest?: (candidate: Candidate, ok: boolean) => void;
}

export interface BisectResult {
    command: string;
    outcome: 'found' | 'all-green' | 'all-red' | 'nothing';
    /** Candidates actually checked in this run (stored marks are reused without a run). */
    tested: { id: string; ok: boolean; trigger?: Trigger }[];
    lastGreen: SnapshotMeta | null;
    firstRed: Candidate | null;
    /** What changed going from lastGreen to firstRed. */
    changed: DiffResult | null;
}

const isEmpty = (d: DiffResult) => !d.added.length && !d.modified.length && !d.deleted.length;
export const candidateId = (c: Candidate) => (c === 'now' ? 'now' : c.id);

export function bisect(sourceDir: string, opts: BisectOptions = {}): BisectResult {
    const command = opts.check ?? readCheckConfig(sourceDir)?.command;
    if (!command) throw new Error('[Agent-Undo] No check command saved. Run `agent-undo check --set "<command>"` once, or pass --check.');
    const tested: BisectResult['tested'] = [];
    const base = snapshotBase(sourceDir);
    const none: BisectResult = { command, outcome: 'nothing', tested, lastGreen: null, firstRed: null, changed: null };

    // Forks are states of a copy, not of the project; everything else is a point on the timeline.
    let snaps = listSnapshots(sourceDir).filter((s) => s.trigger !== 'fork');
    if (opts.good) { const g = resolveSnapshot(sourceDir, opts.good); snaps = snaps.filter((s) => s.createdAt >= g.createdAt); }
    if (opts.bad) { const b = resolveSnapshot(sourceDir, opts.bad); snaps = snaps.filter((s) => s.createdAt <= b.createdAt); }
    const candidates: Candidate[] = [...snaps];
    const newest = snaps.at(-1);
    if (!opts.bad && (!newest || !isEmpty(diffSnapshot(sourceDir, newest.id)))) candidates.push('now');
    if (candidates.length === 0 || (candidates.length === 1 && candidates[0] === 'now')) return none;

    const evaluate = (c: Candidate): boolean => {
        let ok: boolean;
        if (c === 'now') {
            const f = fork(sourceDir, 'bisect: working tree');
            try { ok = runIn(f.dir, command, { stdio: opts.stdio ?? 'pipe', timeoutMs: opts.timeoutMs }).status === 0; }
            finally { try { deleteSnapshot(sourceDir, f.meta.id); } catch { /* best effort */ } }
        } else {
            // A stored mark is evidence only for the same question: a mark from another check command is re-run.
            if (!opts.fresh && c.check?.command === command) return c.check.ok;
            const scratch = path.join(base, `.bisect-${process.pid}`);
            forceRemove(scratch);
            const data = snapshotDir(sourceDir, c.id);
            try {
                cloneEntries(data, scratch, fs.readdirSync(data));
                ok = runIn(scratch, command, { stdio: opts.stdio ?? 'pipe', timeoutMs: opts.timeoutMs }).status === 0;
            } finally { forceRemove(scratch); }
            markSnapshot(sourceDir, c.id, { ok, command });
        }
        tested.push({ id: candidateId(c), ok, trigger: c === 'now' ? undefined : c.trigger });
        opts.onTest?.(c, ok);
        return ok;
    };

    let hi = candidates.length - 1;
    if (evaluate(candidates[hi])) return { ...none, outcome: 'all-green', lastGreen: candidates[hi] === 'now' ? null : candidates[hi] as SnapshotMeta };
    let lo = 0;
    if (hi === 0 || !evaluate(candidates[lo])) return { ...none, outcome: 'all-red', firstRed: candidates[lo] };
    while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (evaluate(candidates[mid])) lo = mid; else hi = mid;
    }
    const lastGreen = candidates[lo] as SnapshotMeta;
    const firstRed = candidates[hi];
    const changed = firstRed === 'now' ? diffSnapshots(sourceDir, lastGreen.id) : diffSnapshots(sourceDir, lastGreen.id, firstRed.id);
    return { command, outcome: 'found', tested, lastGreen, firstRed, changed };
}

const label = (c: Candidate) => c === 'now' ? 'now (working tree)' : `${c.id}  [${c.trigger ?? 'manual'}]${c.reason ? '  ' + c.reason : ''}`;
const LIST_CAP = 20;

/** Human-readable report, in the CLI's vocabulary or the MCP tools'. */
export function describeBisect(r: BisectResult, voice: 'cli' | 'mcp' = 'cli'): string {
    switch (r.outcome) {
        case 'nothing': return 'Nothing to bisect: no snapshots of this project yet.';
        case 'all-green': return `Every candidate passes "${r.command}", the newest included. Nothing is broken along this timeline.`;
        case 'all-red': return `The oldest candidate (${label(r.firstRed!)}) already fails "${r.command}": no green state in range. Widen the range with --good, or fix forward.`;
    }
    const { lastGreen, firstRed, changed } = r;
    const files = [...changed!.added.map((f) => `+ ${f}`), ...changed!.modified.map((f) => `~ ${f}`), ...changed!.deleted.map((f) => `- ${f}`)];
    const paths = [...changed!.added, ...changed!.modified, ...changed!.deleted];
    const back = voice === 'cli'
        ? [`To go back: agent-undo revert ${lastGreen!.id} --yes`, ...(paths.length && paths.length <= 5 ? [`   or only those paths: agent-undo revert ${lastGreen!.id} --only ${paths.join(' ')}`] : [])]
        : [`To go back: revert_environment with snapshot "${lastGreen!.id}"${paths.length && paths.length <= 5 ? `, or only those paths with paths: ${JSON.stringify(paths)}` : ''} (preview first, as always).`];
    return [
        `Last green: ${label(lastGreen!)}`,
        `First red:  ${label(firstRed!)}`,
        `Between them ${files.length} file(s) changed:`,
        ...files.slice(0, LIST_CAP),
        ...(files.length > LIST_CAP ? [`... and ${files.length - LIST_CAP} more`] : []),
        ...back,
    ].join('\n');
}
