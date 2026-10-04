// UserPromptSubmit: switch levels on `/agent-undo <level>` or "stop undo", and in paranoid mode
// checkpoint every turn before the agent starts working.
import { takeSnapshot, listSnapshots } from '../snapshot';
import { readLevel, writeLevel, isLevel, isProjectDir, Level } from '../config';
import { getInstructions } from '../instructions';
import { runHook, emitContext, lastSnapshotAgeMs } from './common';

const TURN_THROTTLE_MS = 15_000;

export function parseLevelCommand(prompt: string): Level | null {
    const p = prompt.trim().toLowerCase();
    const m = p.match(/^\/(?:agent-undo:)?agent-undo\s+(\w+)/);
    if (m && isLevel(m[1])) return m[1];
    if (/^(stop|disable) (agent-)?undo\b|^\/(?:agent-undo:)?agent-undo\s+stop\b/.test(p)) return 'off';
    return null;
}

runHook((input) => {
    const prompt = input.prompt ?? '';
    const switched = parseLevelCommand(prompt);
    if (switched) {
        writeLevel(switched);
        emitContext('UserPromptSubmit', `agent-undo level is now ${switched.toUpperCase()}.\n${getInstructions(switched)}`);
        return;
    }
    if (readLevel() !== 'paranoid') return;
    const cwd = input.cwd || process.cwd();
    if (!isProjectDir(cwd) || lastSnapshotAgeMs(listSnapshots(cwd)) < TURN_THROTTLE_MS) return;
    takeSnapshot(cwd, { reason: `turn: ${prompt.replace(/\s+/g, ' ').slice(0, 60)}`, trigger: 'turn', keep: 20 });
});
