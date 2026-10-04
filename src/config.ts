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
