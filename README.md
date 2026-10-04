# ⏪ agent-undo

**A time machine for AI coding agents.** Instant copy-on-write snapshots of your whole project, including untracked files, `node_modules` and build output, plus safe rollback that you can itself undo.

```
you    ▸ upgrade us to React 19
agent  ▸ (hook) snapshot before `npm install react@19`  ✓ 0.4s
agent  ▸ npm install … 214 files changed … build fails, two fixes fail
agent  ▸ diff_snapshot → revert_environment(paths: [package.json, package-lock.json, node_modules])
agent  ▸ Reverted the dependency upgrade (your src/utils fix kept). Build passing.
         Undo this revert: revert_environment("…-pre-revert"). Next: react-dom first.
```

## Why

When an agent gets stuck it installs random packages, deletes files and rewrites configs. The usual escape hatches miss most of that:

| | Tracked edits | Untracked files | `node_modules` / build output | Shell side effects |
|---|---|---|---|---|
| `git checkout .` | ✅ | ❌ | ❌ | ❌ |
| Claude Code `/rewind` | ✅ (Edit tool only) | partly | ❌ | ❌ |
| **agent-undo** | ✅ | ✅ | ✅ | ✅ (within the project) |

## Fast enough to be automatic

50,000 files (101 MB, node_modules-shaped), Apple Silicon, Node 26. Wall-clock time of the CLI ([full results](benchmarks/results/2026-10-04-clone-darwin.md)):

| Engine | Snapshot | Revert | Disk used |
|---|---|---|---|
| **clonefile(2), directory-level** (macOS default) | **0.42 s** | **0.43 s** | ~16 MB (metadata) |
| `cp -c` / `cp --reflink` (per-file CoW) | 6.8 s | 6.5 s | ~16 MB |
| Full copy (no CoW available) | 16.7 s | 15.4 s | ~209 MB |

On macOS, agent-undo calls `clonefile(2)` on whole directories through [koffi](https://koffi.dev). That's 16× faster than `cp -c`, which clones one file at a time. On Linux it uses `cp --reflink` (CoW on Btrfs/XFS). Anywhere else it falls back to a full copy, capped by `AGENT_UNDO_MAX_COPY_MB`, and the snapshot's `mode` field says so. Revert renames the live tree into the pre-revert backup instead of copying it, so the backup costs nothing.

> Node's built-in `COPYFILE_FICLONE` is not used: `copyFileSync(…, COPYFILE_FICLONE_FORCE)` returns `ENOSYS` on APFS, so it silently falls back to real copies.

## Install (Claude Code plugin)

```text
/plugin marketplace add KartikeySepta/agent-undo
/plugin install agent-undo@agent-undo
```

To try it from a local clone without installing:

```bash
git clone https://github.com/KartikeySepta/agent-undo && cd agent-undo && npm install
claude --plugin-dir /path/to/agent-undo
```

`npm install` in the plugin directory is optional. It adds koffi for the fast macOS path. Without it, agent-undo uses `cp -c`. Run `agent-undo doctor` to check which engine you have.

## What it does once installed

| Level | Trigger | Behavior |
|---|---|---|
| **lite** | `/agent-undo lite` | Rules only. No automatic snapshots. |
| **full** | default | Baseline snapshot at session start (in the background). Auto-snapshot before risky shell commands: `rm -rf`, installs, `git reset --hard`, migrations, `sed -i`, … |
| **paranoid** | `/agent-undo paranoid` | Also a checkpoint every user turn. The agent never reverts without your OK. |
| **off** | `/agent-undo off`, "stop undo" | Hooks and rules stand down. Tools still work on request. |

Automatic snapshots only happen in project directories (`.git`, `package.json`, `pyproject.toml`, …), never in your home directory.

### Skills

| Skill | What it does |
|---|---|
| `/agent-undo` | The mode: rules, levels, and the *undo ladder* (fix forward → partial revert → full revert → ask). |
| `/undo-checkpoint [name]` | Take a named snapshot now. Named snapshots are never auto-pruned. |
| `/undo-diff [snapshot]` | Show what changed since a snapshot, grouped into *yours*, *not yours* and *deps*. |
| `/undo-revert [snapshot] [paths]` | Guided rollback: diff, classify, confirm, revert (partial when possible), verify, report. |
| `/undo-gain` | Scoreboard: snapshots by trigger, reverts, engine checks. |
| `/undo-help` | Reference card. |

### MCP tools

`take_snapshot(name?)` · `list_snapshots` · `diff_snapshot(snapshot?)` · `revert_environment(snapshot?, paths?, confirm?)` · `undo_status`. Every tool takes an optional `project_dir`.

Reverts through MCP are two-step: without `confirm`, `revert_environment` changes nothing and returns the list of paths it would undo plus a `confirm_token`; the agent calls again with that token to revert. If the tree changes in between, the token is rejected and a fresh preview comes back.

Other MCP clients (Cursor, Windsurf, …):

```json
{ "mcpServers": { "agent-undo": { "command": "npx", "args": ["-y", "-p", "@atpes/agent-undo", "agent-undo-mcp"] } } }
```

### Statusline

```json
"statusLine": { "type": "command", "command": "node /path/to/agent-undo/bin/statusline.cjs" }
```

Renders `⏪ undo · 3 snaps · 2m`.

## CLI

```bash
npm install -g @atpes/agent-undo   # commands: agent-undo, agent-undo-mcp

agent-undo snapshot before-refactor     # name is optional
agent-undo list                         # with trigger: manual / hook / session / turn / pre-revert
agent-undo diff                         # +added ~modified -deleted since the latest snapshot
agent-undo revert                       # preview only
agent-undo revert --yes                 # restore (saves a pre-revert backup first)
agent-undo revert --only src/db.ts      # restore just these paths
agent-undo revert pre-revert --yes      # undo the revert
agent-undo mode paranoid                # lite | full | paranoid | off
agent-undo stats                        # lifetime scoreboard + MB protected
agent-undo doctor                       # engine, store volume, project checks
agent-undo prune --keep 5
```

## Configuration

| | |
|---|---|
| `.agentundoignore` | Gitignore syntax. Matching paths are never snapshotted and never touched by a revert (`.env.local`, `dist/`, big caches). |
| `AGENT_UNDO_HOME` | Snapshot store (default `~/.agent-undo`). Keep it on the project's volume, because CoW cannot cross volumes. `doctor` warns if it does. |
| `AGENT_UNDO_LEVEL` | Force a level for this environment. |
| `AGENT_UNDO_MAX_COPY_MB` | Refuse full-copy snapshots larger than this (default 1024). |

## Safety design

- **The top-level `.git` is never snapshotted or touched**, so a revert never rewrites history. Nested `.git` directories (e.g. inside `node_modules`) are kept.
- **Every revert is undoable.** A `pre-revert` snapshot is saved first. If the restore fails partway, it is rolled back automatically and the project is never left empty.
- **It refuses `/` and your home directory.**
- **A lock** stops a hook snapshot and a manual revert from interleaving.
- **Hooks never block the agent.** Any hook error exits 0. Pruning old snapshots happens in a detached process.
- **What it can't undo:** pushes, deploys, remote or Docker databases, sent messages, global installs, files outside the project. The skill tells the agent to say so and ask before doing any of these.

## Development

```bash
npm install
npm test            # type-check, bundle, 35 node:test tests (core, CLI, hooks, MCP, plugin manifest)
npm run bench       # clone-engine benchmark → benchmarks/results/
npm version minor   # bumps package.json, plugin.json, src/version.ts and rebuilds bin/
```

`bin/` holds committed esbuild bundles so the plugin runs without `npm install`. CI fails if they're stale (`scripts/check-bundles.js`). The agent-facing rules live in one place, `src/instructions.ts`, and a test enforces that `skills/agent-undo/SKILL.md` carries them verbatim.

## License

MIT
