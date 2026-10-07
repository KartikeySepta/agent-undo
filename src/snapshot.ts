import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { spawn } from 'child_process';
import ignore, { Ignore } from 'ignore';
import { cloneEntries, copyTree, forceRemove, CloneMode } from './clone';
import { storeHome } from './config';
import { recordStats } from './stats';

export type { CloneMode } from './clone';

export interface SnapshotMeta {
    id: string;
    name?: string;
    createdAt: string;
    source: string;
    /** 'moved': a pre-revert backup made by renaming the live tree aside (instant, no copy). */
    mode: CloneMode | 'moved';
    elapsedMs: number;
    reason?: string;
    /** What took it: a person/agent (manual), the PreToolUse hook, session start, or a paranoid turn checkpoint. */
    trigger?: Trigger;
}

export type Trigger = 'manual' | 'hook' | 'session' | 'turn' | 'pre-revert';

export interface SnapshotOptions {
    name?: string;
    reason?: string;
    keep?: number;
    trigger?: Trigger;
}

export interface DiffResult {
    added: string[];
    modified: string[];
    deleted: string[];
}

export const IGNORE_FILE = '.agentundoignore';
const KEEP_DEFAULT = 10;
const MAX_SLUG = 80;
const LOCK_STALE_MS = 10 * 60_000;
const maxCopyBytes = () => Number(process.env.AGENT_UNDO_MAX_COPY_MB ?? 1024) * 1e6;

// ---------- locations ----------

function realDir(dir: string): string {
    const resolved = path.resolve(dir);
    try { return fs.realpathSync(resolved); } catch { return resolved; }
}

export function snapshotBase(projectDir: string = process.cwd()): string {
    const hash = crypto.createHash('md5').update(realDir(projectDir)).digest('hex');
    return path.join(storeHome(), 'snapshots', hash);
}

const dataDir = (base: string, id: string) => path.join(base, id, 'data');
const metaFile = (base: string, id: string) => path.join(base, id, 'meta.json');

/** Refuse directories where a snapshot+wipe would be catastrophic. */
export function assertSafeTarget(dir: string): void {
    const resolved = realDir(dir);
    const forbidden = [path.parse(resolved).root, realDir(os.homedir())];
    if (forbidden.includes(resolved)) {
        throw new Error(`[Agent-Undo] Refusing to operate on ${resolved}: run it inside a project directory.`);
    }
}

// ---------- lock: a hook snapshot and a manual revert must never interleave ----------

export class BusyError extends Error {}

function withLock<T>(sourceDir: string, fn: () => T): T {
    const base = snapshotBase(sourceDir);
    fs.mkdirSync(base, { recursive: true });
    const lock = path.join(base, '.lock');
    for (let attempt = 0; ; attempt++) {
        try {
            fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' });
            break;
        } catch (e: any) {
            if (e.code !== 'EEXIST' || attempt > 0) throw new BusyError('[Agent-Undo] Another snapshot or revert is running for this directory.');
            let stale = true;
            try {
                const { pid, at } = JSON.parse(fs.readFileSync(lock, 'utf8'));
                try { process.kill(pid, 0); } // throws if the holder is gone
                catch (k: any) { if (k.code !== 'EPERM') throw k; } // EPERM: alive, just not ours to signal
                stale = Date.now() - at > LOCK_STALE_MS;
            } catch { /* unreadable lock or dead pid: stale */ }
            if (!stale) throw new BusyError('[Agent-Undo] Another snapshot or revert is running for this directory.');
            fs.rmSync(lock, { force: true });
        }
    }
    try { return fn(); } finally { fs.rmSync(lock, { force: true }); }
}

// ---------- ignore rules ----------

function loadIgnore(sourceDir: string): Ignore | null {
    try { return ignore().add(fs.readFileSync(path.join(sourceDir, IGNORE_FILE), 'utf8')); }
    catch { return null; }
}

const posix = (p: string) => p.split(path.sep).join('/');

/** Top-most ignored paths under root (relative). Does not descend into ignored dirs. */
function findIgnored(root: string, ig: Ignore | null, rel = ''): string[] {
    if (!ig) return [];
    const out: string[] = [];
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
        const r = path.join(rel, e.name);
        if (r === '.git') continue;
        if (ig.ignores(posix(r) + (e.isDirectory() ? '/' : ''))) out.push(r);
        else if (e.isDirectory()) out.push(...findIgnored(root, ig, r));
    }
    return out;
}

// ---------- snapshots ----------

/**
 * Delete snapshots without blocking the caller: rename into .trash-* (instant, invisible to
 * listSnapshots), then remove in a detached process. Deleting a 50k-file clone takes ~2s.
 */
function discard(base: string, ids: string[]): void {
    if (ids.length === 0) return;
    for (const id of ids) {
        try { fs.renameSync(path.join(base, id), path.join(base, `.trash-${id}`)); } catch { /* already gone */ }
    }
    // Also sweeps trash left behind by an interrupted earlier delete.
    const trash = fs.readdirSync(base).filter((f) => f.startsWith('.trash-')).map((f) => path.join(base, f));
    const removeNow = () => { for (const t of trash) fs.rmSync(t, { recursive: true, force: true }); };
    if (process.env.AGENT_UNDO_SYNC_DELETE) return removeNow();
    try {
        spawn(process.execPath, ['-e', 'for (const p of process.argv.slice(1)) require("fs").rmSync(p, { recursive: true, force: true })', ...trash], {
            detached: true, stdio: 'ignore',
        }).unref();
    } catch {
        removeNow();
    }
}

/** Claim a snapshot id atomically; snapshots within the same millisecond get a .N suffix (sorts after). */
function claimId(base: string, name?: string): { id: string; createdAt: string } {
    const createdAt = new Date().toISOString();
    // The id is a directory name (255-byte limit); meta.name keeps the full text and still resolves the snapshot.
    const slug = name ? '-' + name.replace(/[^\w-]+/g, '_').slice(0, MAX_SLUG) : '';
    const stamp = createdAt.replace(/[:.]/g, '-');
    let id = stamp + slug;
    for (let n = 1; ; n++) {
        try { fs.mkdirSync(path.join(base, id)); return { id, createdAt }; }
        catch (e: any) { if (e.code !== 'EEXIST') throw e; id = `${stamp}.${n}${slug}`; }
    }
}

function snapshotUnlocked(sourceDir: string, opts: SnapshotOptions): SnapshotMeta {
    const base = snapshotBase(sourceDir);
    const { id, createdAt } = claimId(base, opts.name);
    const data = dataDir(base, id);
    const start = Date.now();

    // Clone whole top-level entries (fast path), then drop nested ignored paths from the clone.
    const ignored = findIgnored(sourceDir, loadIgnore(sourceDir));
    const topIgnored = new Set(ignored.filter((r) => !r.includes(path.sep)));
    const entries = fs.readdirSync(sourceDir).filter((e) => e !== '.git' && !topIgnored.has(e));

    let mode: CloneMode;
    try {
        mode = cloneEntries(sourceDir, data, entries, { maxCopyBytes: maxCopyBytes() });
    } catch (e) {
        forceRemove(path.join(base, id));
        throw e;
    }
    for (const r of ignored) if (!topIgnored.has(r)) fs.rmSync(path.join(data, r), { recursive: true, force: true });

    const meta: SnapshotMeta = {
        id, name: opts.name, createdAt, source: realDir(sourceDir),
        mode, elapsedMs: Date.now() - start, reason: opts.reason, trigger: opts.trigger ?? 'manual',
    };
    fs.writeFileSync(metaFile(base, id), JSON.stringify(meta, null, 2));
    recordStats((st) => {
        st.snapshots++;
        st.byTrigger[meta.trigger!] = (st.byTrigger[meta.trigger!] ?? 0) + 1;
        st.snapshotMsTotal += meta.elapsedMs;
    });
    pruneSnapshots(sourceDir, opts.keep ?? KEEP_DEFAULT);
    return meta;
}

export function takeSnapshot(
    sourceDir: string,
    opts: SnapshotOptions = {},
): SnapshotMeta {
    assertSafeTarget(sourceDir);
    return withLock(sourceDir, () => snapshotUnlocked(sourceDir, opts));
}

export function listSnapshots(sourceDir: string): SnapshotMeta[] {
    const base = snapshotBase(sourceDir);
    if (!fs.existsSync(base)) return [];
    return fs.readdirSync(base)
        .filter((id) => !id.startsWith('.'))
        .sort()
        .flatMap((id) => {
            try { return [JSON.parse(fs.readFileSync(metaFile(base, id), 'utf8')) as SnapshotMeta]; }
            catch { return []; }
        });
}

/** Resolve "latest", an exact id or name, or else an id fragment (newest match wins). */
export function resolveSnapshot(sourceDir: string, ref?: string): SnapshotMeta {
    const all = listSnapshots(sourceDir);
    if (all.length === 0) throw new Error('[Agent-Undo] No snapshots found. Take one first.');
    if (!ref || ref === 'latest') return all[all.length - 1];
    // An exact id or name beats a fragment match, which could otherwise pick a newer, different snapshot.
    const exact = all.filter((s) => s.id === ref || s.name === ref);
    const matches = exact.length ? exact : all.filter((s) => s.id.includes(ref));
    if (matches.length === 0) throw new Error(`[Agent-Undo] No snapshot matches "${ref}".`);
    return matches[matches.length - 1];
}

export function pruneSnapshots(sourceDir: string, keep: number = KEEP_DEFAULT): number {
    const base = snapshotBase(sourceDir);
    // Named snapshots are deliberate; only unnamed ones count against the limit.
    const prunable = listSnapshots(sourceDir).filter((s) => !s.name);
    const drop = prunable.slice(0, Math.max(0, prunable.length - keep));
    discard(base, drop.map((s) => s.id));
    return drop.length;
}

// ---------- diff ----------

/** Relative path -> file size, or `-> target` for a symlink, so a retargeted link counts as a change. */
function walk(root: string, ig: Ignore | null, rel = '', out = new Map<string, number | string>()): Map<string, number | string> {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
        const r = path.join(rel, e.name);
        if (r === '.git') continue;
        if (ig?.ignores(posix(r) + (e.isDirectory() ? '/' : ''))) continue;
        if (e.isDirectory()) walk(root, ig, r, out);
        else if (e.isFile()) out.set(r, fs.statSync(path.join(root, r)).size);
        else if (e.isSymbolicLink()) out.set(r, `-> ${fs.readlinkSync(path.join(root, r))}`);
        else out.set(r, -1);
    }
    return out;
}

/** Read until buf is full or EOF; readSync may legitimately return fewer bytes than asked. */
function readFull(fd: number, buf: Buffer): number {
    let got = 0;
    while (got < buf.length) {
        const n = fs.readSync(fd, buf, got, buf.length - got, null);
        if (n === 0) break;
        got += n;
    }
    return got;
}

/** Byte-for-byte comparison in fixed-size chunks: stops at the first difference and never holds a whole file in memory. */
function sameContent(a: string, b: string): boolean {
    const CHUNK = 64 * 1024;
    const bufA = Buffer.allocUnsafe(CHUNK);
    const bufB = Buffer.allocUnsafe(CHUNK);
    const fdA = fs.openSync(a, 'r');
    try {
        const fdB = fs.openSync(b, 'r');
        try {
            for (;;) {
                const n = readFull(fdA, bufA);
                const m = readFull(fdB, bufB);
                if (n !== m) return false;
                if (n === 0) return true;
                if (!bufA.subarray(0, n).equals(bufB.subarray(0, n))) return false;
            }
        } finally { fs.closeSync(fdB); }
    } finally { fs.closeSync(fdA); }
}

/** What changed in sourceDir since the snapshot, i.e. what a revert would undo. */
export function diffSnapshot(sourceDir: string, ref?: string): DiffResult {
    const snap = resolveSnapshot(sourceDir, ref);
    const snapRoot = dataDir(snapshotBase(sourceDir), snap.id);
    const ig = loadIgnore(sourceDir);
    const before = walk(snapRoot, ig);
    const now = walk(sourceDir, ig);
    const result: DiffResult = { added: [], modified: [], deleted: [] };

    for (const [file, size] of now) {
        if (!before.has(file)) result.added.push(file);
        else if (before.get(file) !== size) result.modified.push(file);
        else if (typeof size === 'number' && size > 0 && !sameContent(path.join(sourceDir, file), path.join(snapRoot, file))) {
            result.modified.push(file);
        }
    }
    for (const file of before.keys()) if (!now.has(file)) result.deleted.push(file);
    return result;
}

// ---------- revert ----------

function moveSync(from: string, to: string): void {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    try { fs.renameSync(from, to); }
    catch (e: any) {
        if (e.code !== 'EXDEV') throw e;
        copyTree(from, to);
        fs.rmSync(from, { recursive: true, force: true });
    }
}

/** Real path of the nearest existing ancestor of p, so a not-yet-existing target is still checked. */
function realAncestor(p: string): string {
    for (let cur = p; ; cur = path.dirname(cur)) {
        try { return fs.realpathSync(cur); } catch { if (path.dirname(cur) === cur) return cur; }
    }
}

function safeRelative(sourceDir: string, p: string): string {
    const root = realDir(sourceDir);
    const rel = path.relative(root, path.resolve(root, p));
    if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel) || rel.split(path.sep)[0] === '.git') {
        throw new Error(`[Agent-Undo] "${p}" is not a path inside the project.`);
    }
    // A symlinked directory inside the project can point anywhere; the target's parent must really live in the project.
    const parent = realAncestor(path.dirname(path.join(root, rel)));
    if (parent !== root && !parent.startsWith(root + path.sep)) {
        throw new Error(`[Agent-Undo] "${p}" is not a path inside the project (it passes through a symlink to ${parent}).`);
    }
    return rel;
}

/** Reject a path that .agentundoignore excludes, or that sits inside an excluded directory. */
function assertNotIgnored(sourceDir: string, rel: string): void {
    const ig = loadIgnore(sourceDir);
    if (!ig) return;
    const parts = posix(rel).split('/');
    for (let i = 1; i <= parts.length; i++) {
        const prefix = parts.slice(0, i).join('/');
        if (ig.ignores(prefix) || ig.ignores(prefix + '/')) {
            throw new Error(`[Agent-Undo] "${rel}" is excluded by ${IGNORE_FILE} and is never touched by a revert.`);
        }
    }
}

/** Rename every top-level entry (except .git) into a new pre-revert snapshot. Returns null if the store is on another volume. */
function moveTreeToBackup(sourceDir: string, reason: string): SnapshotMeta | null {
    const base = snapshotBase(sourceDir);
    const { id, createdAt } = claimId(base, 'pre-revert');
    const data = dataDir(base, id);
    fs.mkdirSync(data);
    const start = Date.now();
    const moved: string[] = [];
    try {
        for (const item of fs.readdirSync(sourceDir)) {
            if (item === '.git') continue;
            fs.renameSync(path.join(sourceDir, item), path.join(data, item));
            moved.push(item);
        }
    } catch (e: any) {
        for (const item of moved) fs.renameSync(path.join(data, item), path.join(sourceDir, item));
        fs.rmSync(path.join(base, id), { recursive: true, force: true });
        if (e.code === 'EXDEV') return null;
        throw e;
    }
    const meta: SnapshotMeta = {
        id, name: 'pre-revert', createdAt, source: realDir(sourceDir), mode: 'moved', elapsedMs: Date.now() - start, reason, trigger: 'pre-revert',
    };
    fs.writeFileSync(metaFile(base, id), JSON.stringify(meta, null, 2));
    return meta;
}

export interface RevertOptions {
    /** Restore only these paths (relative to the project); everything else is left alone. */
    only?: string[];
}

export interface RevertPreview {
    snapshot: SnapshotMeta;
    /** Normalized project-relative paths, or null for a full revert. */
    only: string[] | null;
    /** What the revert would undo, limited to `only` when given. */
    diff: DiffResult;
    /** Deterministic: changes if the snapshot, the scope, or any file in scope changes. */
    token: string;
}

/**
 * Dry run of revertSnapshot: what it would undo, plus a confirm token. The token hashes the snapshot
 * id, the sorted scope (or ALL), the diff, and the current size+mtime of every changed live file, so
 * a tree that moved between preview and confirm yields a different token.
 */
export function previewRevert(sourceDir: string, ref?: string, opts: RevertOptions = {}): RevertPreview {
    const snapshot = resolveSnapshot(sourceDir, ref);
    const only = opts.only?.length ? [...new Set(opts.only.map((p) => posix(safeRelative(sourceDir, p))))].sort() : null;
    only?.forEach((o) => assertNotIgnored(sourceDir, o));
    const inScope = (f: string) => !only || only.some((o) => posix(f) === o || posix(f).startsWith(o + '/'));
    const full = diffSnapshot(sourceDir, snapshot.id);
    const diff: DiffResult = { added: full.added.filter(inScope), modified: full.modified.filter(inScope), deleted: full.deleted.filter(inScope) };
    const stamp = (f: string) => { try { const s = fs.statSync(path.join(sourceDir, f)); return `${s.size}:${s.mtimeMs}`; } catch { return '-'; } };
    const token = crypto.createHash('sha256').update(JSON.stringify([
        snapshot.id, only ?? 'ALL', diff, [...diff.added, ...diff.modified].map(stamp),
    ])).digest('hex').slice(0, 12);
    return { snapshot, only, diff, token };
}

/**
 * Restore sourceDir to a snapshot. A "pre-revert" snapshot is taken first so the revert can be undone.
 * The top-level .git and paths matched by .agentundoignore are never touched.
 */
export function revertSnapshot(
    sourceDir: string,
    ref?: string,
    opts: RevertOptions = {},
): { restored: SnapshotMeta; backup: SnapshotMeta } {
    assertSafeTarget(sourceDir);
    return withLock(sourceDir, () => {
        const base = snapshotBase(sourceDir);
        const snap = resolveSnapshot(sourceDir, ref);
        const snapRoot = dataDir(base, snap.id);
        if (!fs.existsSync(snapRoot)) throw new Error(`[Agent-Undo] Snapshot data missing for ${snap.id}.`);
        const only = opts.only?.map((p) => safeRelative(sourceDir, p));
        only?.forEach((o) => assertNotIgnored(sourceDir, o));
        const reason = `before reverting to ${snap.id}`;
        let backup: SnapshotMeta;

        if (only) {
            backup = snapshotUnlocked(sourceDir, { name: 'pre-revert', reason, trigger: 'pre-revert' });
            for (const rel of only) {
                fs.rmSync(path.join(sourceDir, rel), { recursive: true, force: true });
                // Absent from the snapshot means it was created afterwards: removing it is the revert.
                if (fs.existsSync(path.join(snapRoot, rel))) {
                    cloneEntries(path.join(snapRoot, path.dirname(rel)), path.join(sourceDir, path.dirname(rel)), [path.basename(rel)]);
                }
            }
        } else {
            // Park ignored paths outside the tree, wipe, restore, then put them back.
            const stash = path.join(base, `.stash-${process.pid}`);
            const ignored = findIgnored(sourceDir, loadIgnore(sourceDir));
            for (const r of ignored) moveSync(path.join(sourceDir, r), path.join(stash, r));
            try {
                // Moving the live tree into the backup is both the backup and the wipe, in O(entries).
                // Cross-volume store: clone a backup, then delete.
                backup = moveTreeToBackup(sourceDir, reason) ?? (() => {
                    const b = snapshotUnlocked(sourceDir, { name: 'pre-revert', reason, trigger: 'pre-revert' });
                    for (const item of fs.readdirSync(sourceDir)) {
                        if (item !== '.git') fs.rmSync(path.join(sourceDir, item), { recursive: true, force: true });
                    }
                    return b;
                })();
                try {
                    cloneEntries(snapRoot, sourceDir, fs.readdirSync(snapRoot));
                } catch (e: any) {
                    // Restore failed halfway: put the pre-revert state back so the project is never left empty.
                    const backupData = dataDir(base, backup.id);
                    for (const item of fs.readdirSync(sourceDir)) {
                        if (item !== '.git') forceRemove(path.join(sourceDir, item));
                    }
                    if (backup.mode === 'moved') {
                        for (const item of fs.readdirSync(backupData)) moveSync(path.join(backupData, item), path.join(sourceDir, item));
                        fs.rmSync(path.join(base, backup.id), { recursive: true, force: true });
                    } else {
                        cloneEntries(backupData, sourceDir, fs.readdirSync(backupData));
                    }
                    throw new Error(`[Agent-Undo] Revert failed and was rolled back, project unchanged: ${e.message}`);
                }
            } finally {
                for (const r of ignored) {
                    fs.rmSync(path.join(sourceDir, r), { recursive: true, force: true });
                    moveSync(path.join(stash, r), path.join(sourceDir, r));
                }
                fs.rmSync(stash, { recursive: true, force: true });
            }
        }

        // Keep only the newest pre-revert backup (never the one just restored from).
        discard(base, listSnapshots(sourceDir)
            .filter((old) => old.name === 'pre-revert' && old.id !== backup.id && old.id !== snap.id)
            .map((old) => old.id));
        recordStats((st) => {
            st.reverts++;
            if (only) { st.partialReverts++; st.pathsRestored += only.length; }
        });
        return { restored: snap, backup };
    });
}
