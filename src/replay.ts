// "The movie": the session as a flipbook. Each step is a snapshot and what changed since the one
// before; the last step is the working tree when it differs from the newest snapshot.
import fs from 'fs';
import path from 'path';
import { listSnapshots, diffSnapshot, diffSnapshots, snapshotDir, SnapshotMeta, DiffResult } from './snapshot';
import type { Candidate } from './bisect';

export interface ReplayStep { from: SnapshotMeta; to: Candidate; changed: DiffResult }
export interface ReplayOptions { last?: number }

const isEmpty = (d: DiffResult) => !d.added.length && !d.modified.length && !d.deleted.length;

/** The points on the timeline: every snapshot that is a state of the project, then the working tree if it moved on. */
export function timeline(sourceDir: string): Candidate[] {
    const snaps = listSnapshots(sourceDir).filter((s) => s.trigger !== 'fork');
    const points: Candidate[] = [...snaps];
    const newest = snaps.at(-1);
    if (newest && !isEmpty(diffSnapshot(sourceDir, newest.id))) points.push('now');
    return points;
}

export function replay(sourceDir: string, opts: ReplayOptions = {}): ReplayStep[] {
    const points = timeline(sourceDir);
    let pairs = points.slice(1).map((to, i) => ({ from: points[i] as SnapshotMeta, to }));
    if (opts.last !== undefined && opts.last >= 0) pairs = pairs.slice(Math.max(0, pairs.length - opts.last));
    return pairs.map((p) => ({
        ...p,
        changed: p.to === 'now' ? diffSnapshots(sourceDir, p.from.id) : diffSnapshots(sourceDir, p.from.id, p.to.id),
    }));
}

/** Where `rel` lives in a candidate state, or null when that state has no such file. */
export function fileAt(sourceDir: string, c: Candidate, rel: string): string | null {
    const p = path.join(c === 'now' ? sourceDir : snapshotDir(sourceDir, c.id), rel);
    try { return fs.lstatSync(p).isFile() ? p : null; } catch { return null; }
}
