#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { takeSnapshot, revertSnapshot, listSnapshots, diffSnapshot } from "./snapshot";
import { VERSION } from "./version";
import { status, doctor } from "./status";

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
      description: "Restore the working directory to a snapshot. Destroys all changes made since, including legitimate work. Run diff_snapshot first and only revert when the changes are broken. A 'pre-revert' backup is taken automatically so the revert can be undone.",
      inputSchema: {
        type: "object",
        properties: {
          snapshot: snapshotProp,
          project_dir: projectProp,
          paths: { type: "array", items: { type: "string" }, description: "Restore only these project-relative paths; everything else is left alone. Prefer this when only some files are broken." },
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

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = (request.params.arguments ?? {}) as { name?: string; snapshot?: string; paths?: string[]; project_dir?: string };
  const cwd = args.project_dir || process.env.CLAUDE_PROJECT_DIR || process.cwd();
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
        const { restored, backup } = revertSnapshot(cwd, args.snapshot, { only: args.paths?.length ? args.paths : undefined });
        const scope = args.paths?.length ? ` (only ${args.paths.join(", ")})` : "";
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
