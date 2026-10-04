"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/instructions.ts
var instructions_exports = {};
__export(instructions_exports, {
  CORE_RULES: () => CORE_RULES,
  getInstructions: () => getInstructions
});
module.exports = __toCommonJS(instructions_exports);
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CORE_RULES,
  getInstructions
});
