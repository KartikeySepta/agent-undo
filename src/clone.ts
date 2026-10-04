import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

/**
 * clonefile: macOS clonefile(2) on a whole directory, one syscall (~14x faster than cp -c).
 * cow:       per-file copy-on-write via `cp -c` (macOS) or `cp --reflink=always` (Linux).
 * copy:      real byte copy; no CoW on this filesystem or across volumes.
 */
export type CloneMode = 'clonefile' | 'cow' | 'copy';

const RANK: Record<CloneMode, number> = { clonefile: 0, cow: 1, copy: 2 };
const CLONE_NOFOLLOW = 0x0001; // clone symlinks themselves, not their targets

type ClonefileFn = (src: string, dst: string, flags: number) => number;
let clonefileFn: ClonefileFn | null | undefined;

// Node has no clonefile binding; koffi (optional dependency) gives us one without a compiler.
function nativeClonefile(): ClonefileFn | null {
    if (clonefileFn !== undefined) return clonefileFn;
    clonefileFn = null;
    if (process.platform !== 'darwin' || process.env.AGENT_UNDO_NO_FFI) return null;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const koffi = require('koffi');
        clonefileFn = koffi
            .load('/usr/lib/libSystem.B.dylib')
            .func('int clonefile(const char *src, const char *dst, uint32_t flags)') as ClonefileFn;
    } catch {
        // koffi not installed (e.g. plugin used without npm install): fall back to cp -c.
    }
    return clonefileFn;
}

/**
 * Plain recursive copy. Uses `cp -Rp` on POSIX because Node's fs.cpSync aborts the whole
 * process (uncatchable SIGABRT, seen on Node 26) when it meets an unreadable directory.
 */
export function copyTree(src: string, dst: string): void {
    if (process.platform === 'win32') {
        fs.cpSync(src, dst, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
    } else {
        execFileSync('cp', ['-Rp', src, dst], { stdio: 'pipe' });
    }
}

/**
 * rmSync that also removes trees containing unreadable dirs (e.g. a partial `cp -p` copy of a
 * 000 dir). Node 24's rmSync fails on those (ENOTEMPTY/EACCES) where Node 22 succeeded.
 */
export function forceRemove(p: string): void {
    try {
        fs.rmSync(p, { recursive: true, force: true });
        return;
    } catch { /* fall through: make dirs writable/readable, retry once */ }
    const unlock = (dir: string) => {
        try { fs.chmodSync(dir, 0o700); } catch { return; }
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.isDirectory()) unlock(path.join(dir, e.name));
        }
    };
    if (fs.lstatSync(p).isDirectory()) unlock(p);
    fs.rmSync(p, { recursive: true, force: true });
}

export function sizeOf(p: string): number {
    const st = fs.lstatSync(p);
    if (!st.isDirectory()) return st.size;
    let total = 0;
    for (const e of fs.readdirSync(p)) total += sizeOf(path.join(p, e));
    return total;
}

export interface CloneOptions {
    /** Refuse (throw) if a real byte copy would exceed this many bytes. Snapshot-only: a revert must never stop halfway. */
    maxCopyBytes?: number;
}

/** Clone `entries` (names directly under `from`) into the existing directory `to`. Returns the slowest mode used. */
export function cloneEntries(from: string, to: string, entries: string[], opts: CloneOptions = {}): CloneMode {
    fs.mkdirSync(to, { recursive: true });
    const native = nativeClonefile();
    const cowFlag = process.platform === 'darwin' ? '-c' : '--reflink=always';
    let worst: CloneMode = 'clonefile';
    let copiedBytes = 0;

    for (const name of entries) {
        const src = path.join(from, name);
        const dst = path.join(to, name);
        let mode: CloneMode;

        if (native && native(src, dst, CLONE_NOFOLLOW) === 0) {
            mode = 'clonefile';
        } else {
            // dst did not exist before this entry, so removing a partial result is always safe.
            forceRemove(dst);
            try {
                if (process.platform === 'win32') throw new Error('no cp');
                execFileSync('cp', ['-R', cowFlag, src, dst], { stdio: 'pipe' });
                mode = 'cow';
            } catch {
                forceRemove(dst);
                if (opts.maxCopyBytes !== undefined) {
                    copiedBytes += sizeOf(src);
                    if (copiedBytes > opts.maxCopyBytes) {
                        throw new Error(
                            `[Agent-Undo] No copy-on-write on this filesystem and the snapshot would copy over ` +
                            `${Math.round(opts.maxCopyBytes / 1e6)} MB. Add large dirs to .agentundoignore, or raise AGENT_UNDO_MAX_COPY_MB.`,
                        );
                    }
                }
                copyTree(src, dst);
                mode = 'copy';
            }
        }
        if (RANK[mode] > RANK[worst]) worst = mode;
    }
    return worst;
}

/** For `agent-undo doctor`: is the directory-level clonefile fast path available? */
export const hasNativeClonefile = () => nativeClonefile() !== null;
