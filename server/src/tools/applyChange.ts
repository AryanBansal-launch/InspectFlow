import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { applyEdit } from "../writers/fileWriter.js";

export function registerApplyChangeTool(server: McpServer): void {
  server.registerTool(
    "apply_change",
    {
      title: "Apply an approved source edit",
      description:
        "Writes a find-and-replace edit to the source file on disk. " +
        "ONLY call this after the user has explicitly approved the diff shown by `preview_change`. " +
        "Never apply changes without user confirmation.",
      inputSchema: {
        file: z
          .string()
          .min(1)
          .describe("Relative path to the source file from the project root."),
        replace: z.string().min(1).describe("The exact string to replace."),
        with: z.string().describe("The replacement string."),
      },
    },
    async ({ file, replace, with: withStr }) => {
      try {
        const result = await applyEdit(file, replace, withStr ?? "");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  file,
                  lineNumber: result.lineNumber,
                  linesChanged: result.linesChanged,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: false, error: (error as Error).message }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
