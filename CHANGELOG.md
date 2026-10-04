# Changelog

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
