---
name: agent-undo
description: Teaches the AI to use the Time Machine rollback tools when it makes mistakes or breaks the environment.
metadata:
  model: inherit
---

# Agent Undo / Time Machine Skill

You have been granted access to the `agent-undo` MCP server. This gives you the superpower to travel through time and undo your own mistakes.

## Rules of Engagement

1. **Take Snapshots Before Danger:** Before you run any potentially destructive commands (e.g., `npm install`, database migrations, deleting files, or running complex bash scripts), you MUST call the `take_snapshot` tool first.
2. **Never Panic:** If a command you ran breaks the build, throws unfixable errors, or ruins the dependencies, **DO NOT** guess blindly and start deleting files manually.
3. **Use the Rollback Tool:** If you are stuck in an error loop or realize you hallucinated, immediately call the `revert_environment` tool. This will instantly reset the directory to the state it was in before you started.
4. **Admit Defeat Gracefully:** After reverting, tell the user: *"My previous attempt broke the code, so I successfully rewound the environment back to safety. Let's try a different approach."*

By following these rules, you provide psychological safety to the human developer. They know you can never permanently break their environment.
