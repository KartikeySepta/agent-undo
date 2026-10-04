# ⏪ Agent-Undo: The Time Machine for AI Coding Agents

> **Stop letting AI ruin your `node_modules`.** Give yourself psychological safety and give your AI the power to clean up its own messes.

[![npm version](https://img.shields.io/npm/v/agent-undo.svg)](https://npmjs.com/package/agent-undo)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

AI Agents (like Claude Code, Cursor, and OpenDev) are incredible, but they hallucinate. When an agent gets stuck, it often tries to "fix" the problem by blindly installing random packages, deleting untracked files, and messing up your database config. 

**The standard advice is "just use git to undo it." But Git is flawed:**
`git checkout .` does not delete the 10 garbage untracked files the AI just created, and it certainly does not revert your corrupted `node_modules` folder.

**Enter `agent-undo`.**
It uses OS-level mathematical Copy-on-Write (CoW) to take an instantaneous, zero-space snapshot of your *entire directory* before the AI starts. If the AI breaks your code, you press rewind.

---

## ⚡️ The Physics Engine

`agent-undo` clones your directory with the OS's native copy-on-write: `cp -c` (APFS `clonefile`) on macOS and `cp --reflink` on Linux (Btrfs/XFS). Only filesystem metadata is duplicated, so a snapshot of a large `node_modules` takes milliseconds and almost no extra disk space.

On filesystems without CoW (ext4, cross-volume) it falls back to a full copy and says so (`mode: copy`), so you are never misled about cost.

> Node's own `COPYFILE_FICLONE` flags are not used: `copyFileSync` with `FICLONE_FORCE` returns `ENOSYS` on APFS, so they silently degrade to real copies.

---

## 🚀 Installation

Install it globally so you have it everywhere:
```bash
npm install -g agent-undo
```

---

## 🛠️ Usage 1: The Human CLI (Safety Net)

```bash
agent-undo snapshot before-refactor   # name is optional
agent-undo list                       # all snapshots for this directory
agent-undo diff                       # +added ~modified -deleted since latest snapshot
agent-undo revert                     # preview what would be undone
agent-undo revert --yes               # do it (saves a "pre-revert" backup first)
agent-undo revert pre-revert --yes    # undo the revert
agent-undo prune --keep 5             # drop old unnamed snapshots
```

Safety: it refuses to run in `/` or your home directory, never touches the top-level `.git`, keeps nested `.git` folders (e.g. inside `node_modules`), and auto-prunes unnamed snapshots to the newest 10.

---

## 🤖 Usage 2: The MCP Server (Autonomous Cleanup)

Don't want to babysit the AI? Give the AI the power to revert its own mistakes. 
`agent-undo` ships with a fully compliant **Model Context Protocol (MCP)** Server.

### Connecting to Claude Code / Cursor
Add the following to your MCP configuration (e.g., `claude_mcp.json`):
```json
{
  "mcpServers": {
    "agent-undo": {
      "command": "npx",
      "args": ["agent-undo-mcp"]
    }
  }
}
```

### Tools
`take_snapshot(name?)`, `list_snapshots`, `diff_snapshot(snapshot?)`, `revert_environment(snapshot?)`. The `SKILL.md` tells the agent to diff before reverting and to ask when the diff contains changes it did not make.

### Auto-snapshot hook (Claude Code)
`hooks/hooks.json` registers a `PreToolUse` hook that snapshots before destructive Bash commands (`rm -rf`, `npm install`, `git reset --hard`, migrations, ...), throttled to one per minute, so safety does not depend on the model remembering. Install this repo as a Claude Code plugin, or copy the hook entry into your `settings.json` with an absolute path.

---

## 📝 License
MIT License. Build confidently. Code fearlessly.
