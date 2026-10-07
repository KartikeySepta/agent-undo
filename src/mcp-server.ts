#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { takeSnapshot, revertSnapshot, listSnapshots, diffSnapshot, previewRevert, RevertPreview } from "./snapshot";
import { readLevel } from "./config";
import { VERSION } from "./version";
import { status, doctor } from "./status";
import fs from "fs";
import path from "path";

const realPath = (p: string) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

const server = new Server(
  { name: "agent-undo-mcp", version: VERSION },
  { capabilities: { tools: {} } },
);

const snapshotProp = { type: "string", description: "Snapshot id, name, or 'latest' (default)." };
const projectProp = { type: "string", description: "Absolute path of the project. Defaults to the session's project directory." };

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "take_snapshot",
      description: "Take an instant copy-on-write snapshot of the working directory. Call BEFORE risky changes (installs, migrations, bulk deletes).",
      inputSchema: { type: "object", properties: { name: { type: "string", description: "Optional label, e.g. 'before-migration'. Named snapshots are never auto-pruned." }, project_dir: projectProp } },
    },
    {
      name: "list_snapshots",
      description: "List available snapshots for the project (oldest first) with what triggered each.",
      inputSchema: { type: "object", properties: { project_dir: projectProp } },
    },
    {
      name: "diff_snapshot",
      description: "Show files added/modified/deleted since a snapshot. Call this BEFORE revert_environment to see what will be lost.",
      inputSchema: { type: "object", properties: { snapshot: snapshotProp, project_dir: projectProp } },
    },
    {
      name: "revert_environment",
      description: "Restore the working directory to a snapshot. Two steps: called without `confirm` it reverts NOTHING and returns a preview (every path that would be undone) plus a confirm_token. Check each path is yours and broken; if any are not yours, or the level is paranoid, show the user the preview and ask first. Then call again with the same snapshot and paths plus confirm: \"<token>\". A revert destroys all changes since the snapshot in its scope, including legitimate work; a 'pre-revert' backup is taken automatically so it can be undone.",
      inputSchema: {
        type: "object",
        properties: {
          snapshot: snapshotProp,
          project_dir: projectProp,
          paths: { type: "array", items: { type: "string" }, description: "Restore only these project-relative paths; everything else is left alone. Prefer this when only some files are broken." },
          confirm: { type: "string", description: "The confirm_token from a preview of this exact revert. Omit it to get the preview." },
        },
      },
    },
    {
      name: "undo_status",
      description: "agent-undo level, snapshot count, lifetime stats, and environment checks (clone engine, store volume).",
      inputSchema: { type: "object", properties: { project_dir: projectProp } },
    },
  ],
}));

const text = (t: string, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError && { isError }) });

const PREVIEW_CAP = 50;

/** Models sometimes send one path as a bare string. Accept that; reject anything else that isn't a list of non-empty strings. */
function parsePaths(raw: unknown): string[] | undefined | Error {
  if (raw === undefined || raw === null) return undefined;
  const list = typeof raw === "string" ? [raw] : raw;
  if (!Array.isArray(list) || list.some((p) => typeof p !== "string" || !p.trim())) {
    return new Error("`paths` must be an array of project-relative path strings.");
  }
  return list.length ? list : undefined;
}

/** Step one of a revert: what it would undo, and how to confirm. Nothing on disk changes. */
function previewText(p: RevertPreview, staleToken?: string): string {
  const { added, modified, deleted } = p.diff;
  const lines = [...added.map((f) => `+ ${f}`), ...modified.map((f) => `~ ${f}`), ...deleted.map((f) => `- ${f}`)];
  const total = lines.length;
  const scope = p.only ? `only ${p.only.join(", ")}` : "ALL files";
  const paranoid = readLevel() === "paranoid";
  return [
    staleToken ? `confirm token "${staleToken}" does not match this revert (the snapshot, the paths or the files changed since the preview). Nothing was reverted. Fresh preview:` : "PREVIEW ONLY: nothing was reverted.",
    `Reverting to ${p.snapshot.id} (${scope}) would undo ${total} change(s): ${added.length} added (deleted by the revert), ${modified.length} modified, ${deleted.length} deleted (restored by the revert).`,
    ...lines.slice(0, PREVIEW_CAP),
    ...(total > PREVIEW_CAP ? [`... and ${total - PREVIEW_CAP} more`] : []),
    "",
    paranoid
      ? "Level is PARANOID: do not confirm yourself. Show the user this list and ask; confirm only after they say yes."
      : "Before confirming, check every path above is yours and broken. If any are not yours (edits the user or someone else made) show the user this list and ask first; to keep good work, pass `paths` with only the broken files.",
    `To revert, call revert_environment again with the same snapshot and paths plus confirm: "${p.token}".`,
    `confirm_token: ${p.token}`,
  ].join("\n");
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = (request.params.arguments ?? {}) as { name?: string; snapshot?: string; paths?: unknown; project_dir?: string; confirm?: string };
  const cwd = args.project_dir || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  // Some hosts (Codex plugins, Gemini extensions) start the server inside the plugin's own
  // directory. Never silently snapshot or revert agent-undo itself: ask for project_dir instead.
  if (!args.project_dir && !process.env.CLAUDE_PROJECT_DIR && realPath(cwd) === realPath(path.join(__dirname, ".."))) {
    return text(`agent-undo: the MCP server is running in its own install directory (${cwd}), not your project. Call the tool again with project_dir set to the project's absolute path.`, true);
  }
  try {
    switch (request.params.name) {
      case "take_snapshot": {
        const m = takeSnapshot(cwd, { name: args.name, trigger: "manual" });
        return text(`Snapshot ${m.id} taken (${m.mode}, ${m.elapsedMs}ms).`);
      }
      case "list_snapshots": {
        const all = listSnapshots(cwd);
        return text(all.length ? all.map((s) => `${s.id} [${s.trigger ?? "manual"}, ${s.mode}]${s.reason ? " " + s.reason : ""}`).join("\n") : "No snapshots.");
      }
      case "diff_snapshot": {
        const d = diffSnapshot(cwd, args.snapshot);
        return text([
          ...d.added.map((f) => `+ ${f}`), ...d.modified.map((f) => `~ ${f}`), ...d.deleted.map((f) => `- ${f}`),
          `${d.added.length} added, ${d.modified.length} modified, ${d.deleted.length} deleted since snapshot.`,
        ].join("\n"));
      }
      case "revert_environment": {
        const only = parsePaths(args.paths);
        if (only instanceof Error) return text(`Error: ${only.message}`, true);
        const preview = previewRevert(cwd, args.snapshot, { only });
        if (args.confirm !== preview.token) return text(previewText(preview, args.confirm));
        const { restored, backup } = revertSnapshot(cwd, preview.snapshot.id, { only });
        const scope = only ? ` (only ${only.join(", ")})` : "";
        return text(`Reverted to ${restored.id}${scope}. To undo this revert: revert_environment with snapshot "${backup.id}".`);
      }
      case "undo_status": {
        const checks = doctor(cwd).map((c) => `${c.ok === true ? "ok" : c.ok === false ? "FAIL" : "warn"}  ${c.label}: ${c.detail}`);
        return text(JSON.stringify(status(cwd), null, 2) + "\n\n" + checks.join("\n"));
      }
      default:
        return text("Tool not found", true);
    }
  } catch (e: any) {
    return text(`Error: ${e.message}`, true);
  }
});

server.connect(new StdioServerTransport()).then(() => console.error("Agent-Undo MCP Server running on stdio"));
