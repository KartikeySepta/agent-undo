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

// src/instructions.ts
var CORE_RULES = [
  "Snapshot before danger: before dependency installs/removals, migrations, bulk deletes, codegen or large refactors, call `take_snapshot` with a descriptive `name`.",
  "Diff before revert: a revert discards everything changed since the snapshot, including legitimate work and edits the user made meanwhile. Call `diff_snapshot` first.",
  "Prefer a partial revert: if only some files are broken, pass `paths` to `revert_environment` and keep the rest.",
  "Ask before reverting changes that are not yours: if the diff shows files you did not touch this session, stop and ask the user.",
  "Revert instead of thrashing: if an attempt broke the build and two fixes have not worked, revert to the last good snapshot and try a different approach.",
  "Reverts are undoable: each revert saves a `pre-revert` snapshot; its id is in the tool result.",
  "Report plainly: after reverting, say what was undone and what you will try next."
];
var LEVEL_NOTES = {
  lite: "Level LITE: no automatic snapshots. Snapshot only when the user asks or right before an operation you cannot undo with git.",
  full: "Level FULL (default): a baseline snapshot is taken at session start and risky shell commands are auto-snapshotted. You still snapshot before risky file edits and refactors.",
  paranoid: "Level PARANOID: a checkpoint is taken on every user turn. Never revert anything, even your own changes, without the user confirming the diff first."
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

// src/hooks/common.ts
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
function emitContext(event, context) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } }));
}
function runHook(body) {
  readInput().then(body).catch(() => {
  }).finally(() => process.exit(0));
}

// src/hooks/subagent-start.ts
runHook(() => {
  const level = readLevel();
  if (level !== "off") emitContext("SubagentStart", getInstructions(level));
});
