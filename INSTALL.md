# Installing agent-undo

agent-undo runs on Node.js 18 or newer, and `node` has to be on the `PATH` your agent's hook and
MCP processes see (nvm/Nix users: the non-interactive shell's `PATH`). Everything it runs is
committed under `bin/`, so `npm install` is optional; it only adds
[koffi](https://koffi.dev) for the fast whole-directory `clonefile(2)` path on macOS. Run
`node bin/agent-undo.cjs doctor` in a clone to see which snapshot engine you get.

## What each agent gets

| Agent | Rules | MCP tools | Auto-snapshot before risky shell commands | Baseline at session start | `/agent-undo <level>` switching | Commands |
|---|---|---|---|---|---|---|
| [Claude Code](#claude-code) | ✅ hook | ✅ | ✅ | ✅ | ✅ | `/undo-*` skills |
| [Codex](#codex) | ✅ hook | ✅ | ✅ | ✅ | ✅ (`$agent-undo <level>`) | `$undo-*` skills |
| [Cursor](#cursor) | ✅ hook or rule file | ✅ | ✅ | ✅ | ✅ (plain message) | none |
| [Gemini CLI](#gemini-cli) | ✅ `AGENTS.md` | ✅ | optional, [manual hooks](#optional-hooks-experimental) | optional | `agent-undo mode` | `/undo-*` |
| [OpenCode](#opencode) | ✅ plugin | ✅ | ✅ (OpenCode 1) | ✅ | `agent-undo mode` | none |
| [Any MCP client](#any-mcp-client) | copy `AGENTS.md` | ✅ | ❌ | ❌ | `agent-undo mode` | none |

The level (`lite`, `full`, `paranoid`, `off`) is stored in `~/.agent-undo/level` and shared by
every agent and the CLI: `agent-undo mode paranoid` changes it everywhere, and
`AGENT_UNDO_LEVEL` overrides it for one environment.

Outside Claude Code the MCP server may start in agent-undo's own directory instead of your
project. It refuses to snapshot itself, and the session-start hook tells the agent which
`project_dir` to pass, so this only matters if you call the tools by hand.

## Claude Code

```text
/plugin marketplace add KartikeySepta/agent-undo
```
```text
/plugin install agent-undo@agent-undo
```

Send them as two separate prompts. Or from a terminal:

```bash
claude plugin marketplace add KartikeySepta/agent-undo
claude plugin install agent-undo@agent-undo
```

Update with `claude plugin marketplace update agent-undo`. To try a local clone without
installing: `claude --plugin-dir /path/to/agent-undo`.

## Codex

```bash
codex plugin marketplace add KartikeySepta/agent-undo
codex plugin add agent-undo@agent-undo
```

Run `codex`, open `/hooks`, review and trust agent-undo's three hooks (SessionStart,
UserPromptSubmit, PreToolUse on shell tools), then start a new thread. The plugin also declares
the MCP server and ships the skills; invoke them as `$undo-checkpoint`, `$undo-diff`,
`$undo-revert`, `$undo-help`. Files: [`.codex-plugin/`](.codex-plugin/).

MCP server only, without the plugin, in `~/.codex/config.toml`:

```toml
[mcp_servers.agent-undo]
command = "node"
args = ["/absolute/path/to/agent-undo/bin/agent-undo-mcp.cjs"]
```

Codex reads `AGENTS.md`: copy [`AGENTS.md`](AGENTS.md) into your project (or
`~/.codex/AGENTS.md` for every project) to get the rules without hooks.

## Cursor

```bash
git clone https://github.com/KartikeySepta/agent-undo
node agent-undo/scripts/cursor-hooks.js install            # ~/.cursor/hooks.json, every project
node agent-undo/scripts/cursor-hooks.js install --project  # <cwd>/.cursor/hooks.json instead
```

This merges three hooks into `hooks.json` and keeps any hooks already there: `sessionStart`
(rules + background baseline), `beforeSubmitPrompt` (send `/agent-undo lite|full|paranoid|off` as
a plain message; per-turn checkpoints in paranoid) and `preToolUse` on `Shell` (snapshot before
risky commands). The entries run `node` from that clone, so leave it in place or re-run
`install` after moving it. Cursor reloads `hooks.json` on save; open a new chat.

Add the MCP server in `~/.cursor/mcp.json` (or a project's `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "agent-undo": { "command": "node", "args": ["/absolute/path/to/agent-undo/bin/agent-undo-mcp.cjs"] }
  }
}
```

No hooks? Copy [`.cursor/rules/agent-undo.mdc`](.cursor/rules/agent-undo.mdc) into your
project's `.cursor/rules/` for always-on rules instead (with hooks installed it only duplicates
them). Uninstall: `node agent-undo/scripts/cursor-hooks.js uninstall` (add `--project` if you
installed it there); it removes only agent-undo's entries.

## Gemini CLI

```bash
gemini extensions install https://github.com/KartikeySepta/agent-undo
```

The extension ([`gemini-extension.json`](gemini-extension.json)) loads [`AGENTS.md`](AGENTS.md)
as always-on context, starts the MCP server, and adds `/undo-checkpoint`, `/undo-diff`,
`/undo-revert` and `/undo-help` ([`commands/`](commands/)). Update with
`gemini extensions update agent-undo`; remove with `gemini extensions uninstall agent-undo`.

### Optional hooks (experimental)

The extension ships no hooks: Gemini auto-loads an extension's `hooks/hooks.json`, and
agent-undo's Claude hooks use Claude event names, so they live elsewhere. To get the baseline and
automatic snapshots before risky shell commands, add this to `~/.gemini/settings.json` with the
path to your extension (`gemini extensions list` shows it) or a clone. This follows the Gemini
CLI hook format but has not been tested against a live Gemini CLI.

```json
{
  "hooks": {
    "SessionStart": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "node /absolute/path/to/agent-undo/bin/hook-session-start.cjs --platform gemini" }] }
    ],
    "BeforeTool": [
      { "matcher": "run_shell_command", "hooks": [{ "type": "command", "command": "node /absolute/path/to/agent-undo/bin/hook-pretooluse.cjs --platform gemini" }] }
    ]
  }
}
```

## OpenCode

```bash
git clone https://github.com/KartikeySepta/agent-undo
```

Then in your `opencode.json` (project or `~/.config/opencode/opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["/absolute/path/to/agent-undo/.opencode/plugins/agent-undo.mjs"],
  "mcp": {
    "agent-undo": { "type": "local", "command": ["node", "/absolute/path/to/agent-undo/bin/agent-undo-mcp.cjs"], "enabled": true }
  }
}
```

OpenCode 2 uses `"plugins"` and wants the directory: `"plugins": ["/absolute/path/to/agent-undo/.opencode/plugins"]`.

The plugin ([`.opencode/plugins/agent-undo.mjs`](.opencode/plugins/agent-undo.mjs)) adds the
rules for the active level to the system prompt, takes the baseline on a session's first turn,
and (OpenCode 1) snapshots before risky `bash` commands. On OpenCode 2 it injects the rules only.
OpenCode also reads `AGENTS.md` from your project, so copying [`AGENTS.md`](AGENTS.md) there
gives the rules without the plugin.

## Any MCP client

Windsurf, Cline, Zed, Claude Desktop and anything else that speaks MCP over stdio:

```json
{
  "mcpServers": {
    "agent-undo": { "command": "node", "args": ["/absolute/path/to/agent-undo/bin/agent-undo-mcp.cjs"] }
  }
}
```

Tools: `take_snapshot(name?)`, `list_snapshots`, `diff_snapshot(snapshot?)`,
`revert_environment(snapshot?, paths?, confirm?)` (two-step: preview, then `confirm`), `undo_status`; each takes `project_dir`. For the rules,
copy [`AGENTS.md`](AGENTS.md) into the project; agents that read it (Codex, Amp, Jules, OpenCode,
Copilot, Junie when pointed at it) then know when to snapshot and how to revert safely.

## CLI

```bash
npm install -g @atpes/agent-undo
agent-undo doctor
```

The package is scoped (`@atpes/agent-undo`) because the unscoped `agent-undo` name on npm belongs
to an unrelated project; the commands are still `agent-undo` and `agent-undo-mcp`. Any MCP client
can also run the server with `npx -y -p @atpes/agent-undo agent-undo-mcp`. To hack on it, clone
the repository and `npm install -g .` instead. Commands:
`snapshot [name]`, `list`, `diff [snap]`, `revert [snap] [--yes] [--only <paths...>]`,
`mode [level]`, `stats`, `doctor`, `prune --keep <n>`.

## Uninstall

| Agent | Command |
|---|---|
| Claude Code | `claude plugin uninstall agent-undo` |
| Codex | `codex plugin remove agent-undo` |
| Cursor | `node agent-undo/scripts/cursor-hooks.js uninstall [--project]`, then remove the MCP entry |
| Gemini CLI | `gemini extensions uninstall agent-undo` |
| OpenCode | remove the `plugin`/`plugins` and `mcp` entries |
| CLI | `npm uninstall -g @atpes/agent-undo` |

Snapshots live in `~/.agent-undo` (or `AGENT_UNDO_HOME`); delete it to reclaim the space.
