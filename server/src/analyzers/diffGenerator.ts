import { readSourceFile } from "../services/fileReader.js";

export interface DiffResult {
  /** Whether `replace` was found in the file. */
  found: boolean;
  /** Simple one-liner diff: "- replace\n+ with" */
  simpleDiff: string;
  /** Unified-style context diff with surrounding source lines. */
  contextDiff: string;
  /** 1-based line number where the change occurs (-1 if not found). */
  lineNumber: number;
}

/**
 * Generates a simple two-line diff without needing a file on disk.
 * Used by the MCP `preview_change` tool which only receives replace/with.
 */
export function generateSimpleDiff(replace: string, withStr: string): string {
  const replaceLines = replace.split("\n");
  const withLines = withStr.split("\n");
  const removed = replaceLines.map((l) => `- ${l}`).join("\n");
  const added = withLines.map((l) => `+ ${l}`).join("\n");
  return `${removed}\n${added}`;
}

/**
 * Generates a contextual unified diff by reading the source file, locating
 * the `replace` substring, and showing `CONTEXT` lines on each side.
 *
 * For multi-line `replace` values the change is tracked to the first matched line.
 */
export async function generateContextDiff(
  filePath: string,
  replace: string,
  withStr: string,
  contextLines = 2,
): Promise<DiffResult> {
  const simpleDiff = generateSimpleDiff(replace, withStr);

  let content: string;
  try {
    content = await readSourceFile(filePath);
  } catch {
    return { found: false, simpleDiff, contextDiff: "", lineNumber: -1 };
  }

  const charIdx = content.indexOf(replace);
  if (charIdx === -1) {
    return { found: false, simpleDiff, contextDiff: "", lineNumber: -1 };
  }

  const lines = content.split("\n");

  // Find the line index containing charIdx.
  let offset = 0;
  let changeLineIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineEnd = offset + (lines[i]?.length ?? 0) + 1; // +1 for \n
    if (charIdx >= offset && charIdx < lineEnd) {
      changeLineIdx = i;
      break;
    }
    offset = lineEnd;
  }

  const start = Math.max(0, changeLineIdx - contextLines);
  const end = Math.min(lines.length - 1, changeLineIdx + contextLines);

  const diffLines: string[] = [`@@ -${changeLineIdx + 1} @@`];

  for (let i = start; i <= end; i++) {
    const line = lines[i] ?? "";
    if (i === changeLineIdx) {
      // Replace all occurrences on this line (the edit is surgical — only one expected).
      const newLine = line.replaceAll(replace, withStr);
      diffLines.push(`- ${line}`);
      diffLines.push(`+ ${newLine}`);
    } else {
      diffLines.push(`  ${line}`);
    }
  }

  return {
    found: true,
    simpleDiff,
    contextDiff: diffLines.join("\n"),
    lineNumber: changeLineIdx + 1,
  };
}
