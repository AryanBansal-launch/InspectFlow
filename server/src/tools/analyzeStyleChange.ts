import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createLogger } from "../logger/index.js";
import { readSourceFile } from "../services/fileReader.js";
import { findFilesByClassName } from "../services/fileSearch.js";
import { analyzeWithGemini } from "../services/geminiService.js";
import { mapToTailwind } from "../services/tailwindMap.js";
import type { EditSuggestion } from "../validation/schemas.js";

const log = createLogger("analyze");

/** Which analyzer to use. `local` = deterministic map; `ai` = Gemini. */
export type AnalyzeMode = "local" | "ai";

export interface AnalyzeStyleChangeInput {
  /** Relative path to the source file. Optional — when absent the server
   *  searches the project by `className` to discover it automatically. */
  file?: string;
  property: string;
  value: string;
  className?: string;
  selector?: string;
  /** "local" (default): deterministic Tailwind map only. "ai": use Gemini. */
  mode?: AnalyzeMode;
}

export interface AnalyzeStyleChangeResult {
  /** The resolved (or auto-discovered) source file path. */
  file: string;
  suggestion: EditSuggestion;
  /** Which analyzer produced the suggestion. */
  source: AnalyzeMode;
}

/** Thrown when the local mapper can't resolve a change (caller should offer AI). */
export class NoLocalMappingError extends Error {
  constructor(property: string) {
    super(
      `No deterministic Tailwind mapping for "${property}" on this element. ` +
        "Click 'Analyze with AI' to use Gemini.",
    );
    this.name = "NoLocalMappingError";
  }
}

/**
 * Core analysis logic shared by the MCP tool and the HTTP route.
 *
 * If `file` is provided it is used directly; otherwise the server greps the
 * project for files containing `className` and picks the best match. This
 * makes the tool work on any React/Next.js app with zero code changes.
 */
export async function analyzeStyleChange(
  input: AnalyzeStyleChangeInput,
): Promise<AnalyzeStyleChangeResult> {
  const mode: AnalyzeMode = input.mode ?? "local";
  let filePath = input.file?.trim();

  if (!filePath) {
    if (!input.className?.trim()) {
      throw new Error(
        "Cannot determine the source file: neither 'file' nor 'className' was provided. " +
          "Select the element in the Elements panel so its className can be read.",
      );
    }

    const matches = await findFilesByClassName(input.className);

    if (matches.length === 0) {
      throw new Error(
        `No source file found containing className="${input.className.slice(0, 80)}". ` +
          "Ensure PROJECT_ROOT points to the project's source directory and the " +
          "component uses a static className string.",
      );
    }

    filePath = matches[0]!.file;
  }

  const fileContent = await readSourceFile(filePath);

  // Deterministic local mapper — instant, free, no rate limits.
  if (mode === "local") {
    const local = mapToTailwind(input.property, input.value, input.className);
    if (local && fileContent.includes(local.replace)) {
      log.info(
        { file: filePath, replace: local.replace, with: local.with, source: "local" },
        "resolved via local Tailwind map",
      );
      return { file: filePath, suggestion: local, source: "local" };
    }
    throw new NoLocalMappingError(input.property);
  }

  // AI mode — explicit user request to use Gemini.
  const suggestion = await analyzeWithGemini({
    filePath,
    fileContent,
    property: input.property,
    value: input.value,
    className: input.className,
    selector: input.selector,
  });

  return { file: filePath, suggestion, source: "ai" };
}

export function registerAnalyzeStyleChangeTool(server: McpServer): void {
  server.registerTool(
    "analyze_style_change",
    {
      title: "Analyze style change",
      description:
        "Given a CSS change made in Chrome DevTools, locates the source file " +
        "(via `file` or auto-discovery from `className`), reads it, and uses Gemini " +
        "to determine the equivalent source code edit. Returns the file path plus the " +
        "exact find-and-replace strings. Requires GEMINI_API_KEY to be configured.",
      inputSchema: {
        file: z
          .string()
          .optional()
          .describe(
            "Relative path to the source file from the project root. " +
              "When omitted the server searches the project by className.",
          ),
        property: z.string().min(1).describe("CSS property name (e.g. 'padding')."),
        value: z.string().min(1).describe("New CSS value (e.g. '32px')."),
        className: z
          .string()
          .optional()
          .describe(
            "Current className of the inspected element — used for Tailwind mapping " +
              "AND for auto-discovering the source file when 'file' is omitted.",
          ),
        selector: z.string().optional().describe("CSS selector the rule was applied to."),
      },
    },
    async ({ file, property, value, className, selector }) => {
      try {
        const result = await analyzeStyleChange({ file, property, value, className, selector });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            { type: "text", text: JSON.stringify({ error: (error as Error).message }) },
          ],
          isError: true,
        };
      }
    },
  );
}
