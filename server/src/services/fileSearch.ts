import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
import { createLogger } from "../logger/index.js";

const log = createLogger("file-search");

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "out",
  ".cache",
  ".turbo",
  ".vercel",
  "coverage",
  ".nyc_output",
]);

const SEARCH_EXTENSIONS = new Set([
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  ".mjs",
  ".css",
  ".scss",
  ".module.css",
]);

export interface FileMatch {
  /** Relative path from PROJECT_ROOT. */
  file: string;
  /** Score — higher means a more specific match. */
  score: number;
  /** 1-based line number of the best match (-1 if unknown). */
  lineNumber: number;
}

/** Walks the project tree, yielding absolute paths of searchable source files. */
async function* walkFiles(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
        yield* walkFiles(full);
      }
    } else if (SEARCH_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      yield full;
    }
  }
}

/**
 * Returns the 1-based line number of the first occurrence of `term` in `content`,
 * or -1 if not found.
 */
function lineOf(content: string, term: string): number {
  const idx = content.indexOf(term);
  if (idx === -1) return -1;
  return content.slice(0, idx).split("\n").length;
}

/**
 * Scores how well `content` matches `className`.
 *
 * Strategy (descending specificity):
 *   1. Full className string present verbatim               → score 100
 *   2. Longest contiguous N-class sequence (N ≥ 3) found  → score N × 10
 *   3. No match                                            → score 0
 */
function scoreContent(content: string, className: string): { score: number; term: string } {
  const normalized = className.trim();
  if (!normalized) return { score: 0, term: "" };

  // 1. Full match
  if (content.includes(normalized)) {
    return { score: 100, term: normalized };
  }

  // 2. Longest contiguous subsequence of classes
  const classes = normalized.split(/\s+/).filter(Boolean);
  for (let len = Math.min(classes.length, 6); len >= 3; len--) {
    for (let start = 0; start <= classes.length - len; start++) {
      const seq = classes.slice(start, start + len).join(" ");
      if (content.includes(seq)) {
        return { score: len * 10, term: seq };
      }
    }
  }

  return { score: 0, term: "" };
}

/**
 * Searches all source files under PROJECT_ROOT for files that contain
 * `className` (or the longest matching class sequence within it).
 *
 * Returns results sorted by match score (best first). Returns an empty
 * array if no file contains any meaningful class sequence.
 */
export async function findFilesByClassName(
  className: string,
): Promise<FileMatch[]> {
  if (!className.trim()) return [];

  const matches: FileMatch[] = [];

  for await (const absPath of walkFiles(env.PROJECT_ROOT)) {
    let content: string;
    try {
      content = await readFile(absPath, "utf-8");
    } catch {
      continue;
    }

    const { score, term } = scoreContent(content, className);
    if (score > 0) {
      const relPath = path.relative(env.PROJECT_ROOT, absPath);
      matches.push({ file: relPath, score, lineNumber: lineOf(content, term) });
    }
  }

  matches.sort((a, b) => b.score - a.score);

  log.debug(
    { className: className.slice(0, 60), matchCount: matches.length, topFile: matches[0]?.file },
    "className search complete",
  );

  return matches;
}
