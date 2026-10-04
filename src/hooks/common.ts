// Shared plumbing for the lifecycle hooks: read the JSON payload, emit context in the shape the
// host expects, never throw. The same bundles serve Claude Code, Codex, Cursor and Gemini CLI.

export interface HookInput {
    hook_event_name?: string;
    session_id?: string;
    cwd?: string;
    source?: string;
    prompt?: string;
    tool_name?: string;
    tool_input?: { command?: string | string[]; cmd?: string | string[] };
    workspace?: { current_dir?: string };
    workspace_roots?: string[];
}

export type Platform = 'claude' | 'codex' | 'cursor' | 'gemini';
const PLATFORMS: Platform[] = ['claude', 'codex', 'cursor', 'gemini'];

/**
 * Which host runs this hook. The hook configs for other hosts pass `--platform <name>`; without
 * it, fall back to the env vars those hosts set for hook processes (same detection as
 * ponytail-runtime.js: Codex sets PLUGIN_DATA, Cursor sets CURSOR_VERSION only in hook envs).
 * Anything else is Claude Code, whose output is unchanged.
 */
export function detectPlatform(argv: string[] = process.argv, env: NodeJS.ProcessEnv = process.env): Platform {
    const i = argv.indexOf('--platform');
    const named = i >= 0 ? argv[i + 1] : undefined;
    if (PLATFORMS.includes(named as Platform)) return named as Platform;
    if (env.PLUGIN_DATA) return 'codex';
    if (env.CURSOR_VERSION) return 'cursor';
    return 'claude';
}

export const platform = detectPlatform();

/**
 * What to print for `event`. '' means print nothing.
 * - Claude, Gemini: `hookSpecificOutput` JSON; silence when there is nothing to add.
 * - Codex: same JSON, but always print a JSON object (no systemMessage: Codex shows it as a warning).
 * - Cursor: `additional_context` (+ `continue: true` on beforeSubmitPrompt). preToolUse must not be
 *   empty, so it gets a no-op payload; never `permission`, which would override Cursor's own approval.
 */
export function formatOutput(p: Platform, event: string, context = ''): string {
    if (p === 'cursor') {
        if (context) return JSON.stringify({ additional_context: context, ...(event === 'UserPromptSubmit' && { continue: true }) });
        return event === 'PreToolUse' ? JSON.stringify({ agent_message: '' }) : '';
    }
    if (context) return JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } });
    if (p === 'codex') return JSON.stringify(event === 'PreToolUse' ? { hookSpecificOutput: { hookEventName: event } } : {});
    return '';
}

let emitted = false;

export function emitContext(event: string, context: string): void {
    emitted = true;
    process.stdout.write(formatOutput(platform, event, context));
}

/** Project root: Claude/Codex send `cwd`; Cursor sends `workspace_roots`; env vars as a last resort. */
export const projectDir = (input: HookInput): string =>
    input.cwd || input.workspace_roots?.[0] || process.env.CURSOR_PROJECT_DIR || process.env.GEMINI_PROJECT_DIR || process.cwd();

/** Shell tool names across hosts: Claude `Bash`, Cursor `Shell`, Codex `shell`/`exec_command`/..., Gemini `run_shell_command`. */
const SHELL_TOOLS = new Set(['Bash', 'Shell', 'shell', 'bash', 'local_shell', 'shell_command', 'exec_command', 'container.exec', 'run_shell_command']);

/** The shell command line, or null when the tool is not a shell. Codex `shell` passes argv as an array. */
export function shellCommand(input: HookInput): string | null {
    if (!SHELL_TOOLS.has(input.tool_name ?? '')) return null;
    const c = input.tool_input?.command ?? input.tool_input?.cmd;
    return Array.isArray(c) ? c.join(' ') : typeof c === 'string' ? c : '';
}

export function readInput(): Promise<HookInput> {
    return new Promise((resolve) => {
        let raw = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (c) => (raw += c));
        process.stdin.on('end', () => {
            try { resolve(JSON.parse(raw.replace(/^﻿/, ''))); } catch { resolve({}); }
        });
    });
}

/** Run a hook body; any failure exits 0 so a hook can never block the agent. */
export function runHook(event: string, body: (input: HookInput) => void | Promise<void>): void {
    readInput().then(body).catch(() => {}).finally(() => {
        if (!emitted) process.stdout.write(formatOutput(platform, event));
        process.exit(0);
    });
}

export const lastSnapshotAgeMs = (snaps: { createdAt: string }[]) =>
    snaps.length ? Date.now() - Date.parse(snaps[snaps.length - 1].createdAt) : Infinity;
