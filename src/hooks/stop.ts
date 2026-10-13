// Stop (Claude Code): at paranoid level, with a saved check marked auto, run it when the agent's
// turn ends and record green/red on the snapshot that matches the tree. Silent: never blocks the agent.
import { runCheck } from '../check';
import { readCheckConfig } from '../snapshot';
import { readLevel, isProjectDir } from '../config';
import { runHook, projectDir } from './common';

const CHECK_TIMEOUT_MS = 60_000;

runHook('Stop', (input) => {
    if (readLevel() !== 'paranoid') return;
    const cwd = projectDir(input);
    if (!isProjectDir(cwd)) return;
    const cfg = readCheckConfig(cwd);
    if (!cfg?.auto) return;
    runCheck(cwd, cfg.command, { stdio: 'pipe', timeoutMs: CHECK_TIMEOUT_MS });
});
