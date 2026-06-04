import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
import { createLogger } from "../logger/index.js";

const log = createLogger("file-search");

// ---------------------------------------------------------------------------
// Caching
//
// Analyze is called repeatedly (per captured change), and between calls almost
// nothing on disk changes. Re-walking the tree and re-reading every source file
// each time is the dominant cost on large repos. Two caches remove it:
//   • walk list — TTL'd, so newly-added files appear within WALK_TTL_MS.
//   • file contents — keyed by path, validated by mtime, so unchanged files are
//     never re-read (a stat is far cheaper than a full read).
// ---------------------------------------------------------------------------

const WALK_TTL_MS = 2000;

interface CachedContent {
  mtimeMs: number;
  content: string;
}

const contentCache = new Map<string, CachedContent>();
let walkCache: { at: number; files: string[] } | null = null;

/** Returns all searchable file paths under PROJECT_ROOT, cached for WALK_TTL_MS. */
export async function listSourceFiles(): Promise<string[]> {
  if (walkCache && Date.now() - walkCache.at < WALK_TTL_MS) {
    return walkCache.files;
  }
  const files: string[] = [];
  for await (const f of walkFiles(env.PROJECT_ROOT)) files.push(f);
  walkCache = { at: Date.now(), files };
  return files;
}

/** Reads a file, returning cached contents when its mtime is unchanged. */
async function readCachedFile(absPath: string): Promise<string | null> {
  try {
    const st = await stat(absPath);
    const hit = contentCache.get(absPath);
    if (hit && hit.mtimeMs === st.mtimeMs) return hit.content;
    const content = await readFile(absPath, "utf-8");
    contentCache.set(absPath, { mtimeMs: st.mtimeMs, content });
    return content;
  } catch {
    contentCache.delete(absPath);
    return null;
  }
}

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
 * Resolves a React-fiber source hint (an absolute path captured in the browser,
 * e.g. "/Users/.../src/Hero.tsx") to a path relative to PROJECT_ROOT.
 *
 * Strategy:
 *   1. If the hint resolves under PROJECT_ROOT, return the relative path.
 *   2. Otherwise (different machine layout, e.g. Docker), search the project for
 *      a single file whose path ends with the hint's trailing segments.
 * Returns null when nothing matches — the caller then falls back to className
 * search. The returned path is always relative and inside the project.
 */
export async function resolveSourceHint(hint: string): Promise<string | null> {
  const trimmed = hint.trim();
  if (!trimmed || trimmed.includes("\0")) return null;

  const root = env.PROJECT_ROOT.endsWith(path.sep)
    ? env.PROJECT_ROOT
    : env.PROJECT_ROOT + path.sep;

  // 1. Same-machine: the hint already lives under the project root.
  if (path.isAbsolute(trimmed)) {
    const abs = path.resolve(trimmed);
    if (abs === env.PROJECT_ROOT || abs.startsWith(root)) {
      if ((await readCachedFile(abs)) !== null) {
        return path.relative(env.PROJECT_ROOT, abs);
      }
      /* unreadable — fall through to suffix search */
    }
  }

  // 2. Match by trailing path segments (handles Docker / differing roots).
  const hintParts = trimmed.split(/[\\/]/).filter((p) => p && p !== "..");
  if (hintParts.length === 0) return null;

  const candidates: string[] = [];
  for (const absPath of await listSourceFiles()) {
    const rel = path.relative(env.PROJECT_ROOT, absPath);
    const relParts = rel.split(path.sep);
    // Does the file path end with the hint's trailing segments?
    let depth = 1;
    const max = Math.min(relParts.length, hintParts.length);
    for (let n = 1; n <= max; n++) {
      const relTail = relParts.slice(relParts.length - n).join("/");
      const hintTail = hintParts.slice(hintParts.length - n).join("/");
      if (relTail === hintTail) depth = n;
      else break;
    }
    // Require at least the filename to match.
    if (depth >= 1 && relParts[relParts.length - 1] === hintParts[hintParts.length - 1]) {
      candidates.push(rel);
    }
  }

  // Unambiguous match only — multiple files with the same basename would guess.
  if (candidates.length === 1) {
    log.debug({ hint: trimmed, resolved: candidates[0] }, "resolved source hint by basename");
    return candidates[0]!;
  }
  return null;
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

  for (const absPath of await listSourceFiles()) {
    const content = await readCachedFile(absPath);
    if (content === null) continue;

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
