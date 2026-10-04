// Statusline segment: "⏪ undo · 3 snaps · 2m". Reads Claude Code's statusline JSON on stdin.
import { listSnapshots } from './snapshot';
import { readLevel } from './config';
import { readInput } from './hooks/common';

export function ago(ms: number): string {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.round(s / 60)}m`;
    if (s < 86400) return `${Math.round(s / 3600)}h`;
    return `${Math.round(s / 86400)}d`;
}

readInput().then((input) => {
    const level = readLevel();
    if (level === 'off') return;
    const cwd = input.workspace?.current_dir || input.cwd || process.cwd();
    let snaps: ReturnType<typeof listSnapshots> = [];
    try { snaps = listSnapshots(cwd); } catch { /* unreadable store */ }
    const tag = level === 'full' ? 'undo' : `undo:${level}`;
    const color = level === 'paranoid' ? 173 : 108;
    const detail = snaps.length ? ` · ${snaps.length} snap${snaps.length === 1 ? '' : 's'} · ${ago(Date.now() - Date.parse(snaps[snaps.length - 1].createdAt))}` : ' · no snaps';
    process.stdout.write(`\x1b[38;5;${color}m⏪ ${tag}${detail}\x1b[0m`);
}).finally(() => process.exit(0));
