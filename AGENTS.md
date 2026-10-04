<!-- Generated from src/instructions.ts by `npm run build`. Edit the source, not this file. -->

# agent-undo

You can snapshot and roll back this project with agent-undo: copy-on-write clones of the whole directory, including untracked files, `node_modules`, build output and local databases. Snapshots take milliseconds and cost almost no disk, so take them freely.

Use the agent-undo MCP tools: `take_snapshot(name?)`, `list_snapshots`, `diff_snapshot(snapshot?)`, `revert_environment(snapshot?, paths?)`, `undo_status`. Every tool takes an optional `project_dir`; pass the project's absolute path. Without the MCP server, the same operations are a CLI: `agent-undo snapshot <name>`, `agent-undo list`, `agent-undo diff [snap]`, `agent-undo revert [snap] --yes [--only <paths...>]`.

## Rules

1. Snapshot before danger: before dependency installs/removals, migrations, bulk deletes, codegen or large refactors, call `take_snapshot` with a descriptive `name`.
2. Diff before revert: a revert discards everything changed since the snapshot, including legitimate work and edits the user made meanwhile. Call `diff_snapshot` first.
3. Prefer a partial revert: if only some files are broken, pass `paths` to `revert_environment` and keep the rest.
4. Ask before reverting changes that are not yours: if the diff shows files you did not touch this session, stop and ask the user.
5. Revert instead of thrashing: if an attempt broke the build and two fixes have not worked, revert to the last good snapshot and try a different approach.
6. Reverts are undoable: each revert saves a `pre-revert` snapshot; its id is in the tool result.
7. Report plainly: after reverting, say what was undone and what you will try next.

## Limits

Snapshots cover the project directory only. They cannot undo pushes, deploys, remote or Docker-hosted databases, sent messages, global installs or files outside the project: say so and ask before any of those. The top-level `.git` and paths in `.agentundoignore` are never snapshotted or touched, so a revert never rewrites git history.
