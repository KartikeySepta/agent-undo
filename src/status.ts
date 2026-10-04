// Shared by `agent-undo stats|doctor` and the MCP `undo_status` tool.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listSnapshots, snapshotBase } from './snapshot';
import { hasNativeClonefile, sizeOf } from './clone';
import { readLevel, storeHome, isProjectDir } from './config';
import { readStats } from './stats';
import { VERSION } from './version';

export interface Check { ok: boolean | 'warn'; label: string; detail: string }

export function doctor(projectDir: string): Check[] {
    const checks: Check[] = [];
    const major = Number(process.versions.node.split('.')[0]);
    checks.push({ ok: major >= 18, label: 'node', detail: `v${process.versions.node}${major >= 18 ? '' : ' (need >= 18)'}` });

    if (process.platform === 'darwin') {
        const native = hasNativeClonefile();
        checks.push({ ok: native || 'warn', label: 'clone engine', detail: native ? 'clonefile(2), directory-level (fastest)' : 'cp -c per file: run `npm install` in the plugin dir to enable the koffi fast path' });
    } else if (process.platform === 'linux') {
        checks.push({ ok: 'warn', label: 'clone engine', detail: 'cp --reflink (CoW on Btrfs/XFS; full copy on ext4)' });
    } else {
        checks.push({ ok: 'warn', label: 'clone engine', detail: 'full copy (no CoW support on this platform)' });
    }

    // clonefile/reflink only work within one volume; a store on another disk silently means full copies.
    try {
        fs.mkdirSync(storeHome(), { recursive: true });
        const same = fs.statSync(storeHome()).dev === fs.statSync(projectDir).dev;
        checks.push({ ok: same || 'warn', label: 'same volume', detail: same ? `store ${storeHome()}` : `store ${storeHome()} is on another volume: snapshots will be full copies. Set AGENT_UNDO_HOME to a dir on the project's volume.` });
    } catch (e: any) {
        checks.push({ ok: false, label: 'store', detail: e.message });
    }

    checks.push({ ok: isProjectDir(projectDir) || 'warn', label: 'project', detail: isProjectDir(projectDir) ? projectDir : `${projectDir} has no project marker (.git, package.json, ...): hooks will not auto-snapshot here` });
    checks.push({ ok: projectDir !== os.homedir() || false, label: 'safe target', detail: projectDir === os.homedir() ? 'refuses to snapshot the home directory' : 'ok' });
    checks.push({ ok: true, label: 'level', detail: readLevel() });
    return checks;
}

export function status(projectDir: string) {
    const snaps = listSnapshots(projectDir);
    return {
        version: VERSION,
        level: readLevel(),
        project: projectDir,
        store: snapshotBase(projectDir),
        snapshots: snaps.length,
        latest: snaps.at(-1)?.id ?? null,
        stats: readStats(),
    };
}

/** Logical bytes held by this project's snapshots (what full copies would have cost). Walks the store: slow on huge trees. */
export function protectedBytes(projectDir: string): number {
    const base = snapshotBase(projectDir);
    return listSnapshots(projectDir).reduce((sum, s) => {
        try { return sum + sizeOf(path.join(base, s.id, 'data')); } catch { return sum; }
    }, 0);
}
