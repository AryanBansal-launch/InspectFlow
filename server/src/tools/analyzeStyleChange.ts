import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readSourceFile } from "../services/fileReader.js";
import { analyzeWithGemini } from "../services/geminiService.js";
import type { EditSuggestion } from "../validation/schemas.js";

/** Input validated by the MCP tool and by the HTTP route. */
export interface AnalyzeStyleChangeInput {
  file: string;
  property: string;
  value: string;
  className?: string;
  selector?: string;
}

/**
 * Core analysis logic shared by the MCP tool and the HTTP route.
 * Reads the source file from disk and calls Gemini to produce an EditSuggestion.
 */
export async function analyzeStyleChange(
  input: AnalyzeStyleChangeInput,
): Promise<EditSuggestion> {
  const fileContent = await readSourceFile(input.file);
  return analyzeWithGemini({
    filePath: input.file,
    fileContent,
    property: input.property,
    value: input.value,
    className: input.className,
    selector: input.selector,
  });
}

/**
 * Registers the `analyze_style_change` MCP tool on the given server.
 * Called by the MCP server factory so the tool is available to AI clients.
 */
export function registerAnalyzeStyleChangeTool(server: McpServer): void {
  server.registerTool(
    "analyze_style_change",
    {
      title: "Analyze style change",
      description:
        "Given a CSS change made in Chrome DevTools, reads the source file and " +
        "uses Gemini to determine the equivalent source code edit (Tailwind class " +
        "swap, inline-style value update, or CSS file edit). Returns the exact " +
        "find-and-replace strings. Requires GEMINI_API_KEY to be configured.",
      inputSchema: {
        file: z
          .string()
          .min(1)
          .describe(
            "Relative path to the React/TSX/CSS source file from the project root.",
          ),
        property: z
          .string()
          .min(1)
          .describe("CSS property name (e.g. 'padding')."),
        value: z
          .string()
          .min(1)
          .describe("New CSS value the developer typed (e.g. '32px')."),
        className: z
          .string()
          .optional()
          .describe(
            "Current className string on the inspected element — critical for Tailwind mapping.",
          ),
        selector: z
          .string()
          .optional()
          .describe("CSS selector the rule was applied to."),
      },
    },
    async ({ file, property, value, className, selector }) => {
      try {
        const suggestion = await analyzeStyleChange({
          file,
          property,
          value,
          className,
          selector,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(suggestion, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: (error as Error).message,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
