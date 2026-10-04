import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { takeSnapshot, revertSnapshot } from "./snapshot";
import path from "path";
import fs from "fs";

const server = new Server(
  {
    name: "agent-undo-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const SNAPSHOT_BASE = path.join(process.cwd(), '.agent-undo', 'snapshots');

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "take_snapshot",
        description: "Takes an instantaneous Copy-on-Write snapshot of the current working directory. Call this BEFORE attempting dangerous experimental changes.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "revert_environment",
        description: "Instantly reverts the entire working directory back to the most recent snapshot. Call this if you broke the environment, ruined dependencies, or got stuck in a hallucination loop.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    if (request.params.name === "take_snapshot") {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const snapshotDir = path.join(SNAPSHOT_BASE, timestamp);
      
      if (!fs.existsSync(SNAPSHOT_BASE)) {
          fs.mkdirSync(SNAPSHOT_BASE, { recursive: true });
      }
      
      takeSnapshot(process.cwd(), snapshotDir);
      
      return {
        content: [{ type: "text", text: `Success! Snapshot taken at ${timestamp}. You can now safely experiment.` }],
      };
    }

    if (request.params.name === "revert_environment") {
      if (!fs.existsSync(SNAPSHOT_BASE)) {
          return { content: [{ type: "text", text: 'Error: No snapshots found. Cannot revert.' }], isError: true };
      }
      
      const snapshots = fs.readdirSync(SNAPSHOT_BASE).sort();
      if (snapshots.length === 0) {
          return { content: [{ type: "text", text: 'Error: No snapshots found.' }], isError: true };
      }
      
      const latestSnapshot = snapshots[snapshots.length - 1];
      const snapshotDir = path.join(SNAPSHOT_BASE, latestSnapshot);
      
      revertSnapshot(process.cwd(), snapshotDir);
      
      return {
        content: [{ type: "text", text: `Success! The entire directory has been reverted to the state from ${latestSnapshot}. The broken files and node_modules are gone.` }],
      };
    }

    throw new Error("Tool not found");
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error executing tool: ${error.message}` }],
      isError: true,
    };
  }
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Agent-Undo MCP Server running on stdio");
}

run().catch(console.error);
