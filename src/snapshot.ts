import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execFileSync } from 'child_process';

export type CloneMode = 'cow' | 'copy';

export interface SnapshotMeta {
    id: string;
    name?: string;
    createdAt: string;
    source: string;
    mode: CloneMode;
    elapsedMs: number;
    reason?: string;
}

export interface DiffResult {
    added: string[];
    modified: string[];
    deleted: string[];
}

const KEEP_DEFAULT = 10;

export function snapshotBase(projectDir: string = process.cwd()): string {
    const hash = crypto.createHash('md5').update(path.resolve(projectDir)).digest('hex');
    return path.join(os.homedir(), '.agent-undo', 'snapshots', hash);
}

function dataDir(base: string, id: string) { return path.join(base, id, 'data'); }
function metaFile(base: string, id: string) { return path.join(base, id, 'meta.json'); }

/** Refuse directories where a snapshot+wipe would be catastrophic. */
export function assertSafeTarget(dir: string): void {
    const resolved = path.resolve(dir);
    const forbidden = [path.parse(resolved).root, os.homedir()];
    if (forbidden.includes(resolved)) {
        throw new Error(`[Agent-Undo] Refusing to operate on ${resolved}: run it inside a project directory.`);
    }
}

// Node's own FICLONE flags are unreliable (copyFileSync FICLONE_FORCE returns ENOSYS on
// APFS), so shell out to the OS: `cp -c` (clonefile) on macOS, `cp --reflink=auto` on Linux.
// Only the top-level .git is excluded (and never touched on revert); nested .git dirs are kept.
function cloneTree(from: string, to: string, cleanOnFallback = false): CloneMode {
    const entries = fs.readdirSync(from).filter((e) => e !== '.git');
    fs.mkdirSync(to, { recursive: true });
    const cowFlags = process.platform === 'darwin' ? ['-c'] : ['--reflink=always'];
    const run = (flags: string[]) => {
        for (const e of entries) {
            execFileSync('cp', ['-R', ...flags, path.join(from, e), to + path.sep], { stdio: 'pipe' });
        }
    };
    try {
        run(cowFlags);
        return 'cow';
    } catch {
        // No CoW support (or cross-volume): fall back to a real copy. Only wipe a partial clone
        // when the destination is a snapshot dir, never when restoring into the project.
        if (cleanOnFallback) {
            fs.rmSync(to, { recursive: true, force: true });
            fs.mkdirSync(to, { recursive: true });
        }
        run([]);
        return 'copy';
    }
}

export function takeSnapshot(
    sourceDir: string,
    opts: { name?: string; reason?: string; keep?: number } = {},
): SnapshotMeta {
    assertSafeTarget(sourceDir);
    const base = snapshotBase(sourceDir);
    const createdAt = new Date().toISOString();
    const slug = opts.name ? '-' + opts.name.replace(/[^\w.-]+/g, '_') : '';
    const id = createdAt.replace(/[:.]/g, '-') + slug;

    fs.mkdirSync(path.join(base, id), { recursive: true });
    const start = Date.now();
    const mode = cloneTree(sourceDir, dataDir(base, id), true);
    const meta: SnapshotMeta = {
        id, name: opts.name, createdAt, source: path.resolve(sourceDir),
        mode, elapsedMs: Date.now() - start, reason: opts.reason,
    };
    fs.writeFileSync(metaFile(base, id), JSON.stringify(meta, null, 2));
    pruneSnapshots(sourceDir, opts.keep ?? KEEP_DEFAULT);
    return meta;
}

export function listSnapshots(sourceDir: string): SnapshotMeta[] {
    const base = snapshotBase(sourceDir);
    if (!fs.existsSync(base)) return [];
    return fs.readdirSync(base)
        .sort()
        .flatMap((id) => {
            try { return [JSON.parse(fs.readFileSync(metaFile(base, id), 'utf8')) as SnapshotMeta]; }
            catch { return []; }
        });
}

/** Resolve "latest", an exact id, or a unique name/id fragment. */
export function resolveSnapshot(sourceDir: string, ref?: string): SnapshotMeta {
    const all = listSnapshots(sourceDir);
    if (all.length === 0) throw new Error('[Agent-Undo] No snapshots found. Take one first.');
    if (!ref || ref === 'latest') return all[all.length - 1];
    const matches = all.filter((s) => s.id === ref || s.name === ref || s.id.includes(ref));
    if (matches.length === 0) throw new Error(`[Agent-Undo] No snapshot matches "${ref}".`);
    return matches[matches.length - 1];
}

export function pruneSnapshots(sourceDir: string, keep: number = KEEP_DEFAULT): number {
    const base = snapshotBase(sourceDir);
    const all = listSnapshots(sourceDir);
    // Named snapshots are deliberate; only auto-pruned ones count against the limit.
    const prunable = all.filter((s) => !s.name);
    const drop = prunable.slice(0, Math.max(0, prunable.length - keep));
    for (const s of drop) fs.rmSync(path.join(base, s.id), { recursive: true, force: true });
    return drop.length;
}

function walk(root: string, rel = ''): Map<string, number> {
    const out = new Map<string, number>();
    for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
        const r = path.join(rel, entry.name);
        if (r === '.git') continue;
        if (entry.isDirectory()) {
            for (const [k, v] of walk(root, r)) out.set(k, v);
        } else {
            out.set(r, entry.isFile() ? fs.statSync(path.join(root, r)).size : -1);
        }
    }
    return out;
}

/** What changed in sourceDir since the snapshot (what a revert would undo). */
export function diffSnapshot(sourceDir: string, ref?: string): DiffResult {
    const snap = resolveSnapshot(sourceDir, ref);
    const snapRoot = dataDir(snapshotBase(sourceDir), snap.id);
    const before = walk(snapRoot);
    const now = walk(sourceDir);
    const result: DiffResult = { added: [], modified: [], deleted: [] };

    for (const [file, size] of now) {
        if (!before.has(file)) { result.added.push(file); continue; }
        if (before.get(file) !== size) { result.modified.push(file); continue; }
        if (size > 0 && !fs.readFileSync(path.join(sourceDir, file)).equals(fs.readFileSync(path.join(snapRoot, file)))) {
            result.modified.push(file);
        }
    }
    for (const file of before.keys()) if (!now.has(file)) result.deleted.push(file);
    return result;
}

/**
 * Restore sourceDir to a snapshot. A "pre-revert" snapshot is taken first,
 * so a revert can itself be undone.
 */
export function revertSnapshot(sourceDir: string, ref?: string): { restored: SnapshotMeta; backup: SnapshotMeta } {
    assertSafeTarget(sourceDir);
    const snap = resolveSnapshot(sourceDir, ref);
    const snapRoot = dataDir(snapshotBase(sourceDir), snap.id);
    if (!fs.existsSync(snapRoot)) throw new Error(`[Agent-Undo] Snapshot data missing for ${snap.id}.`);

    const backup = takeSnapshot(sourceDir, { name: 'pre-revert', reason: `before reverting to ${snap.id}` });

    for (const item of fs.readdirSync(sourceDir)) {
        if (item === '.git') continue;
        fs.rmSync(path.join(sourceDir, item), { recursive: true, force: true });
    }
    cloneTree(snapRoot, sourceDir);

    // Keep only the newest pre-revert backup (never the one just restored from).
    for (const old of listSnapshots(sourceDir)) {
        if (old.name === 'pre-revert' && old.id !== backup.id && old.id !== snap.id) {
            fs.rmSync(path.join(snapshotBase(sourceDir), old.id), { recursive: true, force: true });
        }
    }
    return { restored: snap, backup };
}
