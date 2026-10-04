---
name: agent-undo
description: Snapshot and roll back the working directory (including untracked files and node_modules) with copy-on-write snapshots. Use before risky changes, and to recover when an attempt breaks the environment.
metadata:
  model: inherit
---

# Agent Undo

Tools from the `agent-undo` MCP server: `take_snapshot`, `list_snapshots`, `diff_snapshot`, `revert_environment`.

## Rules

1. **Snapshot before danger.** Before dependency installs/removals, migrations, bulk deletes, or large refactors, call `take_snapshot` with a descriptive `name`. (A PreToolUse hook also auto-snapshots obvious destructive shell commands, but do not rely on it for edits.)
2. **Diff before you revert.** Revert discards *everything* changed since the snapshot, including legitimate work and edits the user made meanwhile. Call `diff_snapshot` first and check that every listed change is yours and is broken.
3. **Revert only when stuck.** If a change broke the build or you are in an error loop, revert to the snapshot instead of hand-deleting files. Prefer fixing forward when the damage is small.
4. **Ask when unsure.** If the diff contains changes you did not make, ask the user before reverting.
5. **Reverts are undoable.** Every revert first saves a `pre-revert` snapshot; its id is in the tool result. Use it if you reverted too much.
6. **Report plainly.** After reverting, tell the user what was undone and what you will try next.

Snapshots exclude the top-level `.git`, which is never touched. Unnamed snapshots are pruned to the newest 10; named ones are kept.
