import fs from 'fs';
import os from 'os';
import path from 'path';

export const LEVELS = ['off', 'lite', 'full', 'paranoid'] as const;
export type Level = (typeof LEVELS)[number];
export const DEFAULT_LEVEL: Level = 'full';

export const storeHome = () => process.env.AGENT_UNDO_HOME ?? path.join(os.homedir(), '.agent-undo');
const levelFile = () => path.join(storeHome(), 'level');

export const isLevel = (v: unknown): v is Level => LEVELS.includes(v as Level);

/** AGENT_UNDO_LEVEL env > level file (set by `/agent-undo <level>` or `agent-undo mode`) > full. */
export function readLevel(): Level {
    const env = process.env.AGENT_UNDO_LEVEL;
    if (isLevel(env)) return env;
    try {
        const saved = fs.readFileSync(levelFile(), 'utf8').trim();
        if (isLevel(saved)) return saved;
    } catch { /* no level saved yet */ }
    return DEFAULT_LEVEL;
}

export function writeLevel(level: Level): void {
    fs.mkdirSync(storeHome(), { recursive: true });
    fs.writeFileSync(levelFile(), level + '\n');
}

/** Automatic snapshots only fire in directories that look like a project, never in ~/Downloads and friends. */
const PROJECT_MARKERS = ['.git', '.agentundoignore', 'package.json', 'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'go.mod', 'Gemfile', 'pom.xml', 'build.gradle', 'composer.json', 'deno.json'];
export const isProjectDir = (dir: string) => PROJECT_MARKERS.some((m) => fs.existsSync(path.join(dir, m)));

// ---------- hook error log ----------
// Hooks must never block the agent, so they exit 0 on any failure. That made a broken hook look
// exactly like a working one; this keeps the evidence where `doctor` can find it.

const hooksLog = () => path.join(storeHome(), 'hooks.log');
const HOOKS_LOG_MAX = 64 * 1024;

export function logHookError(event: string, err: unknown): void {
    try {
        fs.mkdirSync(storeHome(), { recursive: true });
        const file = hooksLog();
        try { if (fs.statSync(file).size > HOOKS_LOG_MAX) fs.renameSync(file, file + '.1'); } catch { /* no log yet */ }
        const msg = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').slice(0, 300);
        fs.appendFileSync(file, `${new Date().toISOString()} ${event} ${msg}\n`);
    } catch { /* logging must never fail a hook */ }
}

/** The most recent hook failure line, or null if none was ever logged. */
export function lastHookError(): string | null {
    try { return fs.readFileSync(hooksLog(), 'utf8').trimEnd().split('\n').at(-1) || null; }
    catch { return null; }
}
