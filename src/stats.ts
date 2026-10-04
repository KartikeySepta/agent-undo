import fs from 'fs';
import path from 'path';
import { storeHome } from './config';

export interface Stats {
    snapshots: number;
    byTrigger: Record<string, number>;
    snapshotMsTotal: number;
    reverts: number;
    partialReverts: number;
    pathsRestored: number;
    since: string;
}

const file = () => path.join(storeHome(), 'stats.json');
const empty = (): Stats => ({ snapshots: 0, byTrigger: {}, snapshotMsTotal: 0, reverts: 0, partialReverts: 0, pathsRestored: 0, since: new Date().toISOString() });

export function readStats(): Stats {
    try { return { ...empty(), ...JSON.parse(fs.readFileSync(file(), 'utf8')) }; }
    catch { return empty(); }
}

/** Best-effort counters for /undo-gain. Never throws: stats must not break a snapshot or revert. */
export function recordStats(update: (s: Stats) => void): void {
    try {
        const s = readStats();
        update(s);
        fs.mkdirSync(storeHome(), { recursive: true });
        const tmp = `${file()}.${process.pid}`;
        fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
        fs.renameSync(tmp, file());
    } catch { /* ignore */ }
}
