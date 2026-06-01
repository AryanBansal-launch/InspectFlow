import { readFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
import { createLogger } from "../logger/index.js";

const log = createLogger("file-reader");

/** Maximum file size we will read and send to Gemini. */
const MAX_BYTES = 256 * 1024; // 256 KB

/**
 * Reads a source file at `relPath` (relative to `PROJECT_ROOT`), returning its
 * UTF-8 text. Throws on path traversal, missing file, or oversized file.
 */
export async function readSourceFile(relPath: string): Promise<string> {
  const abs = path.resolve(env.PROJECT_ROOT, relPath);

  // Sandbox: the resolved path must remain inside PROJECT_ROOT.
  const root = env.PROJECT_ROOT.endsWith(path.sep)
    ? env.PROJECT_ROOT
    : env.PROJECT_ROOT + path.sep;

  if (abs !== env.PROJECT_ROOT && !abs.startsWith(root)) {
    throw new Error(
      `Access denied: '${relPath}' resolves outside the project root.`,
    );
  }

  let buf: Buffer;
  try {
    buf = await readFile(abs);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new Error(`File not found: ${relPath}`);
    if (code === "EISDIR") throw new Error(`Path is a directory: ${relPath}`);
    throw new Error(`Cannot read '${relPath}': ${(e as Error).message}`);
  }

  if (buf.length > MAX_BYTES) {
    throw new Error(
      `File '${relPath}' is ${buf.length} bytes — exceeds the ${MAX_BYTES / 1024} KB limit.`,
    );
  }

  log.debug({ file: relPath, bytes: buf.length }, "read source file");
  return buf.toString("utf-8");
}
