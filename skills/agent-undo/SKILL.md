---
name: agent-undo
description: >
  Time machine for the working directory. Instant copy-on-write snapshots of the
  whole project (untracked files, node_modules, build output, local DBs) and
  safe, undoable rollback. Supports levels: lite, full (default), paranoid, off.
  Use before risky operations: dependency installs or removals, migrations, bulk
  deletes, codegen, large refactors. Use to recover when an attempt broke the
  build or the environment, when stuck in an error loop, or when the user says
  "undo that", "roll back", "revert everything", "go back to before", "restore",
  "checkpoint", "snapshot", or "agent-undo". Do NOT use for reverting committed
  git history (use git), or for undoing effects outside the project directory
  (deploys, pushes, sent messages, remote databases).
argument-hint: "[lite|full|paranoid|off]"
license: MIT
---

# Agent Undo

You can rewind this project. Snapshots are copy-on-write clones of the whole
directory: they take milliseconds, cost almost no disk, and capture what git
can't (untracked files, `node_modules`, generated code, local SQLite files).
That makes bold experiments safe, and it makes thrashing unnecessary.

## Persistence

ACTIVE EVERY RESPONSE at the current level. Default: **full**.
Switch: `/agent-undo lite|full|paranoid|off`. "stop undo" turns it off.

## Tools

| Tool | Use it to |
|------|-----------|
| `take_snapshot(name?)` | Checkpoint before something risky. Named snapshots are never auto-pruned. |
| `list_snapshots` | See checkpoints, what triggered each (manual, hook, session, turn, pre-revert). |
| `diff_snapshot(snapshot?)` | See exactly what a revert would undo: `+` added, `~` modified, `-` deleted. |
| `revert_environment(snapshot?, paths?)` | Roll back everything, or only `paths`. Saves a `pre-revert` snapshot first. |
| `undo_status` | Level, snapshot count, engine and volume checks. |

All tools take an optional `project_dir`; pass the project's absolute path if
you are not sure the server is running in it.

## Rules

1. Snapshot before danger: before dependency installs/removals, migrations, bulk deletes, codegen or large refactors, call `take_snapshot` with a descriptive `name`.
2. Diff before revert: a revert discards everything changed since the snapshot, including legitimate work and edits the user made meanwhile. Call `diff_snapshot` first.
3. Prefer a partial revert: if only some files are broken, pass `paths` to `revert_environment` and keep the rest.
4. Ask before reverting changes that are not yours: if the diff shows files you did not touch this session, stop and ask the user.
5. Revert instead of thrashing: if an attempt broke the build and two fixes have not worked, revert to the last good snapshot and try a different approach.
6. Reverts are undoable: each revert saves a `pre-revert` snapshot; its id is in the tool result.
7. Report plainly: after reverting, say what was undone and what you will try next.

## The undo ladder

When something breaks, stop at the first rung that holds:

1. **One obvious line?** Fix forward. A revert is not a substitute for reading the error.
2. **A few files wrong?** `diff_snapshot`, then `revert_environment` with `paths`. Keep the good work.
3. **Environment poisoned** (dependency tree, lockfile, generated code, a migration half-applied)? Full revert to the last good snapshot.
4. **Not sure what is yours?** Show the user the diff and ask. Never guess with someone else's work.

Name snapshots for what comes next, not what came before:
`before-prisma-migrate`, `before-react-19-upgrade`, `before-delete-legacy-api`.

## Output

After a snapshot: one line. `Checkpoint before-react-19-upgrade taken.`
After a revert: what was undone, how to undo the revert, the next approach.

Pattern: `Reverted to <snapshot> (<n> files: ...). Undo: revert_environment("<pre-revert id>"). Next: <approach>.`

## Levels

| Level | What happens |
|-------|--------------|
| **lite** | No automatic snapshots. You snapshot only when asked or before something git can't undo. |
| **full** | Baseline snapshot at session start; risky shell commands auto-snapshotted by a hook. You still checkpoint risky edits. Default. |
| **paranoid** | A checkpoint every user turn. Never revert anything, even your own changes, without the user confirming the diff. |
| **off** | No hooks act, no rules injected. Tools still work on request. |

## What a snapshot cannot undo

Snapshots cover the project directory only. They do **not** undo: commits
already pushed, deploys, remote or Docker-hosted databases, sent emails or
messages, files outside the project, global installs (`npm i -g`, `brew`).
Before any of those, say so and ask; a snapshot is no safety net there.

The top-level `.git` is never snapshotted or touched, so a revert never
rewrites history; it can leave the working tree differing from `HEAD`, which
is expected. Paths listed in `.agentundoignore` (gitignore syntax, e.g.
`.env.local`, `dist/`) are neither saved nor touched.

## Boundaries

agent-undo governs safety, not style; it pairs with any other mode.
`/agent-undo off` or "stop undo": rules and hooks stand down.
