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

How do you backup a 2GB `node_modules` folder in 0.1 seconds?
`agent-undo` leverages B-Tree mechanics native to APFS (macOS) and Btrfs (Linux). By using Node's hidden `COPYFILE_FICLONE` flag, we don't actually copy any bytes. We just duplicate the filesystem metadata pointers. 
- **Time to Snapshot:** `< 0.1s`
- **Disk Space Used:** `0 Bytes`

---

## 🚀 Installation

Install it globally so you have it everywhere:
```bash
npm install -g agent-undo
```

---

## 🛠️ Usage 1: The Human CLI (Safety Net)

Protect yourself before you let an experimental AI loose on your codebase.

**1. Take an instant snapshot:**
```bash
agent-undo snapshot
# ✅ Snapshot saved: 2026-10-04T09-00-00Z
```

**2. Let the AI run wild.** (Oh no, it deleted your database and installed deprecated packages!)

**3. Instantly revert the damage:**
```bash
agent-undo revert
# 🚀 Rewinding to snapshot...
# ✅ Environment perfectly restored in 1ms!
```
*(Your rogue `node_modules` are gone, your database is restored, and the git tree is clean).*

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

### How the AI Uses It
The server exposes two tools to the LLM:
1. `take_snapshot`
2. `revert_environment`

Coupled with our `SKILL.md` instruction file, the AI is given the following prompt:
> *"If you execute a command that breaks the build, do not panic. Do not guess blindly. Immediately call `revert_environment` to clean up your mess and apologize to the human."*

Now, if the AI hallucinates, it will autonomously say: *"I messed up the dependencies. I have triggered the rollback tool. Let's try a different approach."*

---

## 📝 License
MIT License. Build confidently. Code fearlessly.
