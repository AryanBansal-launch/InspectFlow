import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  generateContextDiff,
  generateSimpleDiff,
} from "../analyzers/diffGenerator.js";

export function registerPreviewChangeTool(server: McpServer): void {
  server.registerTool(
    "preview_change",
    {
      title: "Preview a proposed source edit",
      description:
        "Generates a diff preview for a proposed find-and-replace edit. " +
        "Provide `file` for a contextual diff with surrounding source lines; " +
        "omit it for a simple two-line diff.",
      inputSchema: {
        replace: z.string().min(1).describe("The exact string to be replaced."),
        with: z.string().describe("The replacement string."),
        file: z
          .string()
          .optional()
          .describe(
            "Relative path to the source file (optional — enables context lines).",
          ),
      },
    },
    async ({ replace, with: withStr, file }) => {
      if (file) {
        const result = await generateContextDiff(file, replace, withStr ?? "");
        return {
          content: [{ type: "text", text: result.contextDiff || result.simpleDiff }],
        };
      }
      return {
        content: [
          { type: "text", text: generateSimpleDiff(replace, withStr ?? "") },
        ],
      };
    },
  );
}
