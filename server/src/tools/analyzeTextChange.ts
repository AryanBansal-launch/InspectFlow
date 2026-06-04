import { createLogger } from "../logger/index.js";
import { findFilesByClassName, resolveSourceHint } from "../services/fileSearch.js";
import { findTextInSource } from "../services/textSearch.js";

const log = createLogger("analyze-text");

export interface AnalyzeTextChangeInput {
  file?: string;
  oldText: string;
  newText: string;
  className?: string;
  /** Absolute source path from the React fiber; resolved to a relative path. */
  sourceHint?: string;
}

export interface AnalyzeTextChangeResult {
  file: string;
  suggestion: { replace: string; with: string; reason?: string };
  source: "local";
}

/**
 * Locates `oldText` in the source file and returns a find-and-replace suggestion
 * that swaps it for `newText`, preserving any surrounding JSX whitespace/indentation.
 */
export async function analyzeTextChange(
  input: AnalyzeTextChangeInput,
): Promise<AnalyzeTextChangeResult> {
  let filePath = input.file?.trim();

  if (!filePath && input.sourceHint?.trim()) {
    const resolved = await resolveSourceHint(input.sourceHint);
    if (resolved) filePath = resolved;
  }

  if (!filePath) {
    if (!input.className?.trim()) {
      throw new Error(
        "Cannot determine the source file: neither 'file' nor 'className' was provided.",
      );
    }
    const matches = await findFilesByClassName(input.className);
    if (matches.length === 0) {
      throw new Error(
        `No source file found containing className="${input.className.slice(0, 80)}". ` +
          "Ensure PROJECT_ROOT points to the project's source directory.",
      );
    }
    filePath = matches[0]!.file;
  }

  const trimmedOld = input.oldText.trim();
  const result = await findTextInSource(filePath, trimmedOld);

  if (!result.found) {
    throw new Error(
      `Text "${trimmedOld.slice(0, 80)}" not found in ${filePath}. ` +
        "The text may come from a prop or variable rather than a literal string.",
    );
  }

  // Preserve surrounding whitespace: if the match was a full indented line, swap
  // only the inner text so indentation is kept.
  const withStr = result.exactMatch.replace(trimmedOld, input.newText);

  log.info({ file: filePath, replace: result.exactMatch, with: withStr }, "text change resolved");

  return {
    file: filePath,
    suggestion: {
      replace: result.exactMatch,
      with: withStr,
      reason: `Update text from "${trimmedOld}" to "${input.newText}"`,
    },
    source: "local",
  };
}
