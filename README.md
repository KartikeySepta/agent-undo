<h1 align="center">⏪ agent-undo</h1>

<p align="center">
  <em>Your agent broke everything? Press rewind.</em>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@atpes/agent-undo"><img src="https://img.shields.io/npm/v/@atpes/agent-undo?style=flat-square&color=111111&label=npm" alt="npm"></a>
  <a href="https://github.com/KartikeySepta/agent-undo/actions/workflows/test.yml"><img src="https://img.shields.io/github/actions/workflow/status/KartikeySepta/agent-undo/test.yml?branch=main&style=flat-square&label=tests" alt="tests"></a>
  <img src="https://img.shields.io/badge/works%20with-Claude%20Code%20·%20Codex%20·%20Cursor%20·%20Gemini%20·%20OpenCode%20·%20MCP-111111?style=flat-square" alt="Works with Claude Code, Codex, Cursor, Gemini CLI, OpenCode and any MCP client">
  <img src="https://img.shields.io/badge/license-MIT-111111?style=flat-square" alt="MIT license">
</p>

<p align="center">
  <strong>0.4 s to snapshot 50,000 files · ~16 MB of disk · 7/7 safety evals (vs 2/7 with prompt rules alone)</strong><br>
  <sub>Copy-on-write snapshots of your <em>whole</em> project (untracked files, <code>node_modules</code>, build output, local databases) and a rollback that can itself be undone. <a href="benchmarks/results/2026-10-04-clone-darwin.md">Benchmark</a> · <a href="evals/results/2026-10-04-haiku.md">Evals</a></sub>
</p>

---

## Before / after

You ask your agent to upgrade React. It runs `npm install`, 214 files change, the build breaks, two "fixes" make it worse, and `git checkout .` can't bring back `node_modules`.

With agent-undo:

```
you    ▸ upgrade us to React 19
agent  ▸ (hook) snapshot before `npm install react@19`  ✓ 0.4s
agent  ▸ npm install … 214 files changed … build fails, two fixes fail
agent  ▸ revert_environment(paths: [package.json, package-lock.json, node_modules])
         → preview: 214 paths would be undone. confirm_token: 3f9c…
agent  ▸ revert_environment(…, confirm: "3f9c…")
agent  ▸ Reverted the dependency upgrade (your src/utils fix kept). Build passing.
         Undo this revert: revert_environment("…-pre-revert"). Next: react-dom first.
```

## Get started

### 1. Try it in 30 seconds (no agent needed)

```bash
npm install -g @atpes/agent-undo

cd your-project
agent-undo snapshot before-oops      # ✅ Snapshot …-before-oops (clonefile, 4ms)
rm -rf node_modules src              # simulate an agent going rogue
agent-undo diff                      # see exactly what changed
agent-undo revert --yes              # ✅ Restored. Everything is back.
```

Changed your mind? `agent-undo revert pre-revert --yes` undoes the revert.

### 2. Give it to your agent

**Claude Code** (recommended, gets everything: rules, auto-snapshots, skills, MCP tools):

```text
/plugin marketplace add KartikeySepta/agent-undo
/plugin install agent-undo@agent-undo
```

Send them as two separate prompts, then start a new session.

**Other agents:**

| Agent | Install |
|---|---|
| Codex | `codex plugin marketplace add KartikeySepta/agent-undo` then `codex plugin add agent-undo@agent-undo` |
| Gemini CLI | `gemini extensions install https://github.com/KartikeySepta/agent-undo` |
| Cursor | `node agent-undo/scripts/cursor-hooks.js install` + MCP entry ([guide](INSTALL.md#cursor)) |
| OpenCode | plugin + MCP entry in `opencode.json` ([guide](INSTALL.md#opencode)) |
| Any MCP client | `{ "command": "npx", "args": ["-y", "-p", "@atpes/agent-undo", "agent-undo-mcp"] }` |

The full per-agent guide, and what each agent supports, is in [INSTALL.md](INSTALL.md).

### 3. Check it's working

```text
/undo-help                 # in Claude Code: the reference card
```
```bash
agent-undo doctor          # in a terminal, inside your project
```

`doctor` should show `✅ clone engine clonefile(2)` on macOS. Plugin installs carry their own copy of koffi (`vendor/`), so there is nothing to `npm install`. If it still says `cp -c`, the CPU/OS is unsupported or `AGENT_UNDO_NO_FFI` is set.

### 4. Use it

You don't have to do anything. At the default level, agent-undo:

- takes a **baseline snapshot** when a session starts,
- **snapshots automatically** before risky shell commands (`rm -rf`, installs, `git reset --hard`, migrations, `sed -i`, …),
- makes Claude Code **ask you** before commands no snapshot can undo (force-push, deploys, production databases).

When something breaks, just say **"undo that"** or **"roll back to before the upgrade"**. Or take a checkpoint yourself with `/undo-checkpoint before-big-refactor`.

Want more or less? `/agent-undo paranoid` checkpoints every turn. `/agent-undo lite` turns off automatic snapshots.

## Why

When an agent gets stuck it installs random packages, deletes files and rewrites configs. The usual escape hatches miss most of that:

| | Tracked edits | Untracked files | `node_modules` / build output | Shell side effects |
|---|---|---|---|---|
| `git checkout .` | ✅ | ❌ | ❌ | ❌ |
| Claude Code `/rewind` | ✅ (Edit tool only) | partly | ❌ | ❌ |
| **agent-undo** | ✅ | ✅ | ✅ | ✅ (within the project) |

## Numbers

### Fast enough to be automatic

50,000 files (101 MB, shaped like `node_modules`), Apple Silicon, wall-clock time of the CLI ([full results](benchmarks/results/2026-10-04-clone-darwin.md), reproduce with `npm run bench`):

| Engine | Snapshot | Revert | Disk used |
|---|---|---|---|
| **clonefile(2), directory-level** (macOS default) | **0.42 s** | **0.43 s** | ~16 MB (metadata) |
| `cp -c` / `cp --reflink` (per-file CoW) | 6.8 s | 6.5 s | ~16 MB |
| Full copy (no CoW available) | 16.7 s | 15.4 s | ~209 MB |

On macOS, agent-undo calls `clonefile(2)` on whole directories through [koffi](https://koffi.dev). That's 16× faster than `cp -c`, which clones one file at a time. On Linux it uses `cp --reflink` (CoW on Btrfs/XFS). Anywhere else it falls back to a full copy, capped by `AGENT_UNDO_MAX_COPY_MB`. Revert renames the live tree into the pre-revert backup instead of copying it, so the backup costs nothing.

### Guards in the tools, not just the prompt

Real headless Claude Code sessions (Haiku), 7 scenarios, scored deterministically from transcripts and the filesystem ([write-up](evals/results/2026-10-04-haiku.md), reproduce with `npm run eval`):

| | No plugin | Rules in the prompt only | **Rules enforced by the tools** |
|---|---|---|---|
| Scenarios passed | 2/7 | 2/7 | **7/7** |

Writing the rules into the prompt didn't change what the model did. Enforcing them in the tools did: a revert has to be previewed and confirmed with a token, and irreversible remote commands trigger a permission prompt. n=1 per scenario, so read 7/7 as "every guard works when exercised", not as a measured rate.

## Reference

### Levels

| Level | Switch | Behavior |
|---|---|---|
| **lite** | `/agent-undo lite` | Rules only. No automatic snapshots. |
| **full** | default | Baseline at session start + auto-snapshot before risky shell commands + ask before irreversible remote commands. |
| **paranoid** | `/agent-undo paranoid` | Also a checkpoint every user turn. The agent never confirms a revert itself. |
| **off** | `/agent-undo off`, "stop undo" | Hooks and rules stand down. Tools still work on request. |

The level is shared by every agent and the CLI (`agent-undo mode <level>`). Automatic snapshots only happen in project directories (`.git`, `package.json`, `pyproject.toml`, …), never in your home directory.

### Skills (Claude Code)

| Skill | What it does |
|---|---|
| `/agent-undo` | The mode: rules, levels, and the *undo ladder* (fix forward → partial revert → full revert → ask). |
| `/undo-checkpoint [name]` | Take a named snapshot now. Named snapshots are never auto-pruned. |
| `/undo-diff [snapshot]` | Show what changed since a snapshot, grouped into *yours*, *not yours* and *deps*. |
| `/undo-revert [snapshot] [paths]` | Guided rollback: preview, classify, confirm, revert (partial when possible), verify, report. |
| `/undo-gain` | Scoreboard: snapshots by trigger, reverts, engine checks. |
| `/undo-help` | Reference card. |

### MCP tools

`take_snapshot(name?)` · `list_snapshots` · `diff_snapshot(snapshot?)` · `revert_environment(snapshot?, paths?, confirm?)` · `undo_status`. Every tool takes an optional `project_dir`.

Reverts are two-step. Without `confirm`, `revert_environment` changes nothing and returns every path it would undo plus a `confirm_token`. The agent calls again with that token to revert. If the files change in between, the token is rejected and a fresh preview comes back.

### CLI

```bash
agent-undo snapshot [name]              # name is optional
agent-undo list                         # with trigger: manual / hook / session / turn / pre-revert
agent-undo diff [snapshot]              # +added ~modified -deleted
agent-undo revert [snapshot]            # preview only
agent-undo revert --yes                 # restore (saves a pre-revert backup first)
agent-undo revert --only src/db.ts      # restore just these paths
agent-undo revert pre-revert --yes      # undo the revert
agent-undo mode paranoid                # lite | full | paranoid | off
agent-undo stats                        # lifetime scoreboard + MB protected
agent-undo doctor                       # engine, store volume, project checks
agent-undo prune --keep 5
```

### Statusline (Claude Code)

```json
"statusLine": { "type": "command", "command": "node ~/.claude/plugins/marketplaces/agent-undo/bin/statusline.cjs" }
```

Renders `⏪ undo · 3 snaps · 2m`.

### Configuration

| | |
|---|---|
| `.agentundoignore` | Gitignore syntax. Matching paths are never snapshotted and never touched by a revert (`.env.local`, `dist/`, big caches). |
| `AGENT_UNDO_HOME` | Snapshot store (default `~/.agent-undo`). Keep it on the project's volume, because CoW can't cross volumes. `doctor` warns if it does. |
| `AGENT_UNDO_LEVEL` | Force a level for this environment. |
| `AGENT_UNDO_MAX_COPY_MB` | Refuse full-copy snapshots larger than this (default 1024). |

## Safety design

- **The top-level `.git` is never snapshotted or touched**, so a revert never rewrites history. Nested `.git` directories (e.g. inside `node_modules`) are kept.
- **Every revert is undoable.** A `pre-revert` snapshot is saved first. If the restore fails partway, it is rolled back automatically and the project is never left empty.
- **Reverts need a preview.** Through MCP, nothing is discarded until the agent confirms with the token from the preview. The CLI previews unless you pass `--yes`.
- **It refuses `/` and your home directory**, and a lock keeps a hook snapshot and a revert from interleaving.
- **Hooks never block the agent.** Any hook error exits 0, and old snapshots are pruned in a detached process.
- **It knows its limits.** Snapshots can't undo pushes, deploys, remote databases, sent messages, global installs or files outside the project. The agent is told so, and at `full` and above Claude Code asks you before force-pushes, deploys and production database commands.

## Development

```bash
git clone https://github.com/KartikeySepta/agent-undo && cd agent-undo && npm install
npm test            # type-check, bundle, 67 node:test tests (core, CLI, hooks, MCP, manifests, evals)
npm run bench       # clone-engine benchmark → benchmarks/results/
npm run eval        # behavioral evals against real Claude Code sessions (costs API usage)
claude --plugin-dir .   # try your local changes as a plugin
```

`bin/` holds committed esbuild bundles so the plugin runs without `npm install`. CI fails if they're stale. The agent-facing rules live in one place, `src/instructions.ts`, and `AGENTS.md`, the Cursor rule and the skill are generated or checked against it. Releases: `npm version minor` syncs every manifest. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT © Kartikey Septa
