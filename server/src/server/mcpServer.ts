import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { changeStore } from "../store/changeStore.js";
import { registerAnalyzeStyleChangeTool } from "../tools/analyzeStyleChange.js";

const SERVER_INFO = {
  name: "inspectflow",
  version: "0.1.0",
} as const;

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

  registerAnalyzeStyleChangeTool(server);
}

export function createMcpServer(): McpServer {
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: {} },
  });
  registerTools(server);
  return server;
}
