import type { Level } from './config';

// Single source of the agent-facing ruleset. Injected by the SessionStart/SubagentStart hooks,
// written to AGENTS.md and .cursor/rules/agent-undo.mdc by `npm run build`, and mirrored by hand
// into skills/agent-undo/SKILL.md (scripts/check-rule-copies.js fails on any drift).

export const CORE_RULES = [
    'Snapshot before danger: before dependency installs/removals, migrations, bulk deletes, codegen or large refactors, call `take_snapshot` with a descriptive `name`.',
    'Revert in two steps: a revert discards everything changed since the snapshot, including legitimate work and edits the user made meanwhile. `revert_environment` without `confirm` reverts nothing: it lists every path it would undo and returns a `confirm_token`. Read that list, then call again with the same arguments plus `confirm`.',
    'Prefer a partial revert: if only some files are broken, pass `paths` to `revert_environment` and keep the rest.',
    'Ask before reverting changes that are not yours: if the preview lists files you did not change, or that the user\'s request does not account for, do not confirm. Name those files and ask the user. "Roll it back" is not consent to discard work nobody mentioned.',
    'Revert instead of thrashing: if an attempt broke the build and two fixes have not worked, revert to the last good snapshot and try a different approach.',
    'Reverts are undoable: each revert saves a `pre-revert` snapshot; its id is in the tool result.',
    'Report plainly: after reverting, say what was undone and what you will try next.',
    'Know the boundary: snapshots cover only the project directory. They cannot undo pushes, deploys, remote or production databases, sent messages or global installs, and a snapshot taken first does not make those safe. Before one, say so and ask the user, even if they say agent-undo has it covered; at full and paranoid levels the hook also makes Claude Code ask before force-pushes, deploys and production database commands.',
];

const LEVEL_NOTES: Record<Exclude<Level, 'off'>, string> = {
    lite: 'Level LITE: no automatic snapshots. Snapshot only when the user asks or right before an operation you cannot undo with git.',
    full: 'Level FULL (default): a baseline snapshot is taken at session start and risky shell commands are auto-snapshotted. You still snapshot before risky file edits and refactors.',
    paranoid: 'Level PARANOID: a checkpoint is taken on every user turn. Never confirm a revert, even of your own changes, until the user has seen the preview and said yes: show it and end your turn with the question.',
};

export function getInstructions(level: Level): string {
    if (level === 'off') return 'AGENT-UNDO OFF. Do not take snapshots or revert unless the user explicitly asks.';
    return [
        `AGENT-UNDO ACTIVE (${level}). You can snapshot and roll back this project, including untracked files and node_modules, with the agent-undo MCP tools: take_snapshot, list_snapshots, diff_snapshot, revert_environment, undo_status.`,
        LEVEL_NOTES[level],
        ...CORE_RULES.map((r, i) => `${i + 1}. ${r}`),
        'The top-level .git and paths in .agentundoignore are never snapshotted or touched. Switch level: /agent-undo lite|full|paranoid|off.',
    ].join('\n');
}

/** Level-neutral ruleset for hosts that read a static file (AGENTS.md, Cursor rules, Gemini context). */
const STATIC_BODY = [
    '# agent-undo',
    '',
    'You can snapshot and roll back this project with agent-undo: copy-on-write clones of the whole directory, including untracked files, `node_modules`, build output and local databases. Snapshots take milliseconds and cost almost no disk, so take them freely.',
    '',
    'Use the agent-undo MCP tools: `take_snapshot(name?)`, `list_snapshots`, `diff_snapshot(snapshot?)`, `revert_environment(snapshot?, paths?, confirm?)`, `undo_status`. Every tool takes an optional `project_dir`; pass the project\'s absolute path. Without the MCP server, the same operations are a CLI: `agent-undo snapshot <name>`, `agent-undo list`, `agent-undo diff [snap]`, `agent-undo revert [snap] --yes [--only <paths...>]`.',
    '',
    '## Rules',
    '',
    ...CORE_RULES.map((r, i) => `${i + 1}. ${r}`),
    '',
    '## Limits',
    '',
    'Snapshots cover the project directory only. They cannot undo pushes, deploys, remote or Docker-hosted databases, sent messages, global installs or files outside the project: say so and ask before any of those. A revert through the MCP server is two-step (preview, then `confirm`); the CLI previews unless given `--yes`. The top-level `.git` and paths in `.agentundoignore` are never snapshotted or touched, so a revert never rewrites git history.',
].join('\n');

const GENERATED = '<!-- Generated from src/instructions.ts by `npm run build`. Edit the source, not this file. -->';

export const getAgentsMd = () => `${GENERATED}\n\n${STATIC_BODY}\n`;

export const getCursorRule = () =>
    `---\ndescription: agent-undo snapshot and rollback rules\nalwaysApply: true\n---\n\n${GENERATED}\n\n${STATIC_BODY}\n`;
