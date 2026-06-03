import { readSourceFile } from "./fileReader.js";

export interface TextSearchResult {
  found: boolean;
  /** The exact string in the source file to use as the `replace` side of the edit. */
  exactMatch: string;
}

/**
 * Finds `searchText` in a source file and returns the exact string to replace.
 *
 * Strategy:
 * 1. Exact substring match — the trimmed text appears verbatim in the file.
 * 2. Trimmed line match — a single line trims down to `searchText` (handles
 *    JSX indentation / whitespace surrounding inline text nodes).
 */
export async function findTextInSource(
  filePath: string,
  searchText: string,
): Promise<TextSearchResult> {
  const content = await readSourceFile(filePath);
  const trimmed = searchText.trim();

  if (!trimmed) return { found: false, exactMatch: searchText };

  // 1. Exact substring match.
  if (content.includes(trimmed)) {
    return { found: true, exactMatch: trimmed };
  }

  // 2. Line-level trimmed match — handles surrounding indentation / whitespace.
  for (const line of content.split("\n")) {
    if (line.trim() === trimmed) {
      return { found: true, exactMatch: line };
    }
  }

  return { found: false, exactMatch: searchText };
}
