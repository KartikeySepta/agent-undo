// Shared plumbing for Claude Code hooks: read the JSON payload, emit additionalContext, never throw.

export interface HookInput {
    hook_event_name?: string;
    session_id?: string;
    cwd?: string;
    source?: string;
    prompt?: string;
    tool_name?: string;
    tool_input?: { command?: string };
    workspace?: { current_dir?: string };
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

export function emitContext(event: string, context: string): void {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } }));
}

/** Run a hook body; any failure exits 0 silently so a hook can never block the agent. */
export function runHook(body: (input: HookInput) => void | Promise<void>): void {
    readInput().then(body).catch(() => {}).finally(() => process.exit(0));
}

export const lastSnapshotAgeMs = (snaps: { createdAt: string }[]) =>
    snaps.length ? Date.now() - Date.parse(snaps[snaps.length - 1].createdAt) : Infinity;
