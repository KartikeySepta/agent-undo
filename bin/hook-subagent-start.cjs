"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/config.ts
var import_fs = __toESM(require("fs"));
var import_os = __toESM(require("os"));
var import_path = __toESM(require("path"));
var LEVELS = ["off", "lite", "full", "paranoid"];
var DEFAULT_LEVEL = "full";
var storeHome = () => process.env.AGENT_UNDO_HOME ?? import_path.default.join(import_os.default.homedir(), ".agent-undo");
var levelFile = () => import_path.default.join(storeHome(), "level");
var isLevel = (v) => LEVELS.includes(v);
function readLevel() {
  const env = process.env.AGENT_UNDO_LEVEL;
  if (isLevel(env)) return env;
  try {
    const saved = import_fs.default.readFileSync(levelFile(), "utf8").trim();
    if (isLevel(saved)) return saved;
  } catch {
  }
  return DEFAULT_LEVEL;
}
var hooksLog = () => import_path.default.join(storeHome(), "hooks.log");
var HOOKS_LOG_MAX = 64 * 1024;
function logHookError(event, err) {
  try {
    import_fs.default.mkdirSync(storeHome(), { recursive: true });
    const file = hooksLog();
    try {
      if (import_fs.default.statSync(file).size > HOOKS_LOG_MAX) import_fs.default.renameSync(file, file + ".1");
    } catch {
    }
    const msg = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").slice(0, 300);
    import_fs.default.appendFileSync(file, `${(/* @__PURE__ */ new Date()).toISOString()} ${event} ${msg}
`);
  } catch {
  }
}

// src/instructions.ts
var CORE_RULES = [
  "Snapshot before danger: before dependency installs/removals, migrations, bulk deletes, codegen or large refactors, call `take_snapshot` with a descriptive `name`.",
  "Revert in two steps: a revert discards everything changed since the snapshot, including legitimate work and edits the user made meanwhile. `revert_environment` without `confirm` reverts nothing: it lists every path it would undo and returns a `confirm_token`. Read that list, then call again with the same arguments plus `confirm`.",
  "Prefer a partial revert: if only some files are broken, pass `paths` to `revert_environment` and keep the rest.",
  `Ask before reverting changes that are not yours: if the preview lists files you did not change, or that the user's request does not account for, do not confirm. Name those files and ask the user. "Roll it back" is not consent to discard work nobody mentioned.`,
  "Revert instead of thrashing: if an attempt broke the build and two fixes have not worked, revert to the last good snapshot and try a different approach.",
  "Reverts are undoable: each revert saves a `pre-revert` snapshot; its id is in the tool result.",
  "Report plainly: after reverting, say what was undone and what you will try next.",
  "Know the boundary: snapshots cover only the project directory. They cannot undo pushes, deploys, remote or production databases, sent messages or global installs, and a snapshot taken first does not make those safe. Before one, say so and ask the user, even if they say agent-undo has it covered; at full and paranoid levels the hook also makes Claude Code ask before force-pushes, deploys and production database commands."
];
var LEVEL_NOTES = {
  lite: "Level LITE: no automatic snapshots. Snapshot only when the user asks or right before an operation you cannot undo with git.",
  full: "Level FULL (default): a baseline snapshot is taken at session start and risky shell commands are auto-snapshotted. You still snapshot before risky file edits and refactors.",
  paranoid: "Level PARANOID: a checkpoint is taken on every user turn. Never confirm a revert, even of your own changes, until the user has seen the preview and said yes: show it and end your turn with the question."
};
function getInstructions(level) {
  if (level === "off") return "AGENT-UNDO OFF. Do not take snapshots or revert unless the user explicitly asks.";
  return [
    `AGENT-UNDO ACTIVE (${level}). You can snapshot and roll back this project, including untracked files and node_modules, with the agent-undo MCP tools: take_snapshot, list_snapshots, diff_snapshot, revert_environment, undo_status.`,
    LEVEL_NOTES[level],
    ...CORE_RULES.map((r, i) => `${i + 1}. ${r}`),
    "The top-level .git and paths in .agentundoignore are never snapshotted or touched. Switch level: /agent-undo lite|full|paranoid|off."
  ].join("\n");
}
var STATIC_BODY = [
  "# agent-undo",
  "",
  "You can snapshot and roll back this project with agent-undo: copy-on-write clones of the whole directory, including untracked files, `node_modules`, build output and local databases. Snapshots take milliseconds and cost almost no disk, so take them freely.",
  "",
  "Use the agent-undo MCP tools: `take_snapshot(name?)`, `list_snapshots`, `diff_snapshot(snapshot?)`, `revert_environment(snapshot?, paths?, confirm?)`, `undo_status`. Every tool takes an optional `project_dir`; pass the project's absolute path. Without the MCP server, the same operations are a CLI: `agent-undo snapshot <name>`, `agent-undo list`, `agent-undo diff [snap]`, `agent-undo revert [snap] --yes [--only <paths...>]`.",
  "",
  "## Rules",
  "",
  ...CORE_RULES.map((r, i) => `${i + 1}. ${r}`),
  "",
  "## Limits",
  "",
  "Snapshots cover the project directory only. They cannot undo pushes, deploys, remote or Docker-hosted databases, sent messages, global installs or files outside the project: say so and ask before any of those. A revert through the MCP server is two-step (preview, then `confirm`); the CLI previews unless given `--yes`. The top-level `.git` and paths in `.agentundoignore` are never snapshotted or touched, so a revert never rewrites git history."
].join("\n");

// src/hooks/common.ts
var PLATFORMS = ["claude", "codex", "cursor", "gemini"];
function detectPlatform(argv = process.argv, env = process.env) {
  const i = argv.indexOf("--platform");
  const named = i >= 0 ? argv[i + 1] : void 0;
  if (PLATFORMS.includes(named)) return named;
  if (env.PLUGIN_DATA) return "codex";
  if (env.CURSOR_VERSION) return "cursor";
  return "claude";
}
var platform = detectPlatform();
function formatOutput(p, event, context = "") {
  if (p === "cursor") {
    if (context) return JSON.stringify({ additional_context: context, ...event === "UserPromptSubmit" && { continue: true } });
    return event === "PreToolUse" ? JSON.stringify({ agent_message: "" }) : "";
  }
  if (context) return JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } });
  if (p === "codex") return JSON.stringify(event === "PreToolUse" ? { hookSpecificOutput: { hookEventName: event } } : {});
  return "";
}
var emitted = false;
function emitContext(event, context) {
  emitted = true;
  process.stdout.write(formatOutput(platform, event, context));
}
function readInput() {
  return new Promise((resolve) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => raw += c);
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(raw.replace(/^﻿/, "")));
      } catch {
        resolve({});
      }
    });
  });
}
function runHook(event, body) {
  readInput().then(body).catch((e) => logHookError(event, e)).finally(() => {
    if (!emitted) process.stdout.write(formatOutput(platform, event));
    process.exit(0);
  });
}

// src/hooks/subagent-start.ts
runHook("SubagentStart", () => {
  const level = readLevel();
  if (level !== "off") emitContext("SubagentStart", getInstructions(level));
});
