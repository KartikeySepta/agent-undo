# Changelog

## 1.3.0 (2026-10-04)

First npm release, as `@atpes/agent-undo` (the unscoped name belongs to another project). Commands are still `agent-undo` and `agent-undo-mcp`.

### Safety
- Two-step revert over MCP: `revert_environment` without `confirm` changes nothing and returns the paths it would undo plus a `confirm_token` (bound to the snapshot, scope and current diff); a stale token re-previews.
- PreToolUse asks before irreversible commands outside the project (force-push, terraform apply/destroy, kubectl delete/apply, prod deploys, destructive SQL against non-local DBs) at levels full and paranoid.
- Rules: revert is two-step, "roll it back" is not consent to discard unmentioned work, and a new rule 8 states the snapshot boundary.

### Evals
- `evals/`: 7 behavioral scenarios with deterministic scoring (`npm run eval`). Haiku, n=1 per scenario: prompt-only rules 2/7 (same as no plugin); with the tool-level guards 7/7. See `evals/results/2026-10-04-haiku.md`.

### Other agents
- Codex plugin (`.codex-plugin/`), Cursor hooks installer (`scripts/cursor-hooks.js`) and rule, Gemini CLI extension with `/undo-*` commands, OpenCode plugin. See INSTALL.md.
- `AGENTS.md`, generated from `src/instructions.ts`; `scripts/check-rule-copies.js` and `scripts/check-versions.js` guard drift.
- Hooks emit each host's output shape (`--platform codex|cursor|gemini`); Claude Code output unchanged. Claude hooks moved to `hooks/claude-hooks.json` because Gemini CLI auto-loads `hooks/hooks.json`.
- The MCP server refuses to default to its own install directory and asks for `project_dir`.
- `$agent-undo <level>` switches levels too (Codex skill syntax).

## 1.2.0 (2026-10-04)

### Engine
- Directory-level `clonefile(2)` on macOS via optional koffi: 50k-file snapshot in ~0.4s (was ~6.8s with `cp -c`).
- Revert moves the live tree into the pre-revert backup instead of copying it (~0.4s), and rolls back automatically if the restore fails partway.
- `.agentundoignore`, `revert --only <paths>`, a per-project lock, and non-blocking pruning.
- Fixed: snapshots taken in the same millisecond collided; `fs.cpSync` could abort the process on unreadable dirs (Node 26).

### Claude Code plugin
- Plugin and marketplace manifests. MCP server declared by the plugin.
- Skills: `agent-undo` (levels lite/full/paranoid/off), `undo-checkpoint`, `undo-diff`, `undo-revert`, `undo-gain`, `undo-help`.
- Hooks: SessionStart baseline + rules, UserPromptSubmit level switching + paranoid per-turn checkpoints, PreToolUse risky-command snapshots, SubagentStart rules.
- `agent-undo mode|stats|doctor`, MCP `undo_status`, `project_dir` on all tools, statusline.

## 1.1.0
- Named snapshots, `list`, `diff`, undoable revert with preview, auto-prune, PreToolUse hook.
- Real CoW via `cp -c` / `cp --reflink` (Node's FICLONE flags silently copied).

## 1.0.0
- Initial CLI and MCP server.
