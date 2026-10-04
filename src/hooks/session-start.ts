// SessionStart: inject the ruleset for the active level and take a baseline snapshot in the
// background (a large repo can take seconds to clone; session start must not wait for it).
import { spawn } from 'child_process';
import { takeSnapshot, listSnapshots } from '../snapshot';
import { readLevel, isProjectDir } from '../config';
import { getInstructions } from '../instructions';
import { runHook, emitContext, lastSnapshotAgeMs, projectDir, platform } from './common';

const BASELINE_THROTTLE_MS = 5 * 60_000;

if (process.argv[2] === '--baseline') {
    // Detached child: the actual baseline snapshot.
    try { takeSnapshot(process.argv[3], { reason: 'session start baseline', trigger: 'session' }); } catch { /* busy/unsafe: skip */ }
} else {
    runHook('SessionStart', (input) => {
        const level = readLevel();
        if (level === 'off') return;
        const cwd = projectDir(input);
        const project = isProjectDir(cwd);
        const snaps = project ? listSnapshots(cwd) : [];

        // Baseline on fresh sessions only (not on resume/compact), and not if one was just taken.
        const fresh = !input.source || input.source === 'startup' || input.source === 'clear';
        let note = project ? `${snaps.length} snapshot(s) exist for this project.` : 'Not a project directory: automatic snapshots are disabled here.';
        if (project && level !== 'lite' && fresh && lastSnapshotAgeMs(snaps) > BASELINE_THROTTLE_MS) {
            spawn(process.execPath, [__filename, '--baseline', cwd], { detached: true, stdio: 'ignore' }).unref();
            note += ' A baseline snapshot of the session start is being taken now.';
        }
        // Outside Claude Code the MCP server may not run in the project, so name it for the tools.
        if (platform !== 'claude') note += ` Project directory: ${cwd} (pass it as project_dir to the agent-undo tools).`;
        emitContext('SessionStart', `${getInstructions(level)}\n${note}`);
    });
}
