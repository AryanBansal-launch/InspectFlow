import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { changeStore } from "../store/changeStore.js";

/**
 * Metadata advertised to MCP clients.
 */
const SERVER_INFO = {
  name: "inspectflow",
  version: "0.1.0",
} as const;

/**
 * Registers every InspectFlow MCP tool on a server instance.
 *
 * Phase 1 exposes `list_recent_changes`, a live, read-only view of the changes
 * captured from DevTools. The analysis/preview/apply tools are registered by
 * their respective modules in later phases via this same hook.
 */
function registerTools(server: McpServer): void {
  server.registerTool(
    "list_recent_changes",
    {
      title: "List recent style changes",
      description:
        "Returns the most recent CSS changes captured from Chrome DevTools, " +
        "newest first. Useful for inspecting the capture pipeline.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .describe("Maximum number of changes to return (default 50)."),
      },
    },
    async ({ limit }) => {
      const changes = changeStore.list(limit ?? 50);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ count: changeStore.size(), changes }, null, 2),
          },
        ],
      };
    },
  );
}

/**
 * Builds a fully configured MCP server instance. A fresh instance is created
 * per request in stateless HTTP mode (see {@link ./express.ts}).
 */
export function createMcpServer(): McpServer {
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: {} },
  });

  registerTools(server);

  return server;
}
