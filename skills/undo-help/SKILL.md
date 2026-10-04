---
name: undo-help
description: >
  Quick-reference card for agent-undo levels, skills, tools, CLI and config.
  One-shot display, not a persistent mode. Trigger: /undo-help, "agent-undo
  help", "how do I use agent-undo", "what undo commands are there".
---

# Undo Help

Display this card. One-shot: do not change the level or take snapshots.

## Levels

| Level | Trigger | What happens |
|-------|---------|--------------|
| **Lite** | `/agent-undo lite` | No automatic snapshots. |
| **Full** | `/agent-undo full` | Baseline at session start + auto-snapshot before risky shell commands. Default. |
| **Paranoid** | `/agent-undo paranoid` | Checkpoint every turn; never revert without your OK. |
| **Off** | `/agent-undo off` / "stop undo" | Hooks and rules stand down. |

## Skills

| Skill | What it does |
|-------|--------------|
| `/agent-undo` | The mode itself: rules, levels, the undo ladder. |
| `/undo-checkpoint [name]` | Named snapshot now. |
| `/undo-diff [snapshot]` | What changed since a snapshot, grouped: yours / not yours / deps. |
| `/undo-revert [snapshot] [paths]` | Guided rollback: diff, classify, confirm, revert, verify. |
| `/undo-gain` | Scoreboard: snapshots, reverts, engine checks. |
| `/undo-help` | This card. |

## CLI (terminal)

```
agent-undo snapshot [name]     agent-undo revert [snap] [--yes] [--only <paths...>]
agent-undo list                agent-undo diff [snap]
agent-undo mode [level]        agent-undo stats
agent-undo doctor              agent-undo prune --keep 10
```

## Config

| What | How |
|------|-----|
| Never snapshot/touch paths | `.agentundoignore` in the project (gitignore syntax) |
| Snapshot store | `AGENT_UNDO_HOME` (default `~/.agent-undo`); keep it on the project's volume for CoW |
| Force a level | `AGENT_UNDO_LEVEL=lite\|full\|paranoid\|off` |
| Full-copy size cap | `AGENT_UNDO_MAX_COPY_MB` (default 1024) |
| Statusline | `"statusLine": {"type": "command", "command": "node <plugin>/bin/statusline.cjs"}` |

Snapshots never include the top-level `.git`, and can't undo pushes, deploys,
remote databases or anything outside the project.
