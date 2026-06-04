import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as babelParse } from "@babel/parser";
import * as recast from "recast";
import { env } from "../config/env.js";
import { createLogger } from "../logger/index.js";

const log = createLogger("file-writer");

const TSX_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const CSS_EXTENSIONS = new Set([".css", ".scss", ".sass", ".less", ".module.css"]);

/** Options for the recast/babel parser. */
const recastParserOptions = {
  parser: {
    parse(source: string) {
      return babelParse(source, {
        sourceType: "module",
        tokens: true, // required for recast to preserve whitespace
        plugins: [
          "jsx",
          "typescript",
          "decorators",
          "classProperties",
          "optionalChaining",
          "nullishCoalescingOperator",
        ],
      });
    },
  },
};

export interface WriteResult {
  /** Lines that were changed (always 1 for a single-string replacement). */
  linesChanged: number;
  /** 1-based line number of the change. */
  lineNumber: number;
  /** Absolute path that was written. */
  absolutePath: string;
}

/**
 * Applies a find-and-replace edit to a source file on disk.
 *
 * Strategy:
 *  - TypeScript/JavaScript/JSX/TSX: parse with Babel + recast, walk JSX `className`
 *    attributes to find the replacement, then print with preserved formatting.
 *    Falls back to safe first-occurrence string replace when the AST walk does not
 *    locate the string (e.g. inline styles, template literals).
 *  - CSS / SCSS / plain stylesheets: safe first-occurrence string replace.
 *
 * Throws if `replace` is not found anywhere in the file, if the resolved path
 * escapes PROJECT_ROOT, or if the file cannot be read/written.
 */
export async function applyEdit(
  relPath: string,
  replace: string,
  withStr: string,
): Promise<WriteResult> {
  const abs = path.resolve(env.PROJECT_ROOT, relPath);
  const root = env.PROJECT_ROOT.endsWith(path.sep)
    ? env.PROJECT_ROOT
    : env.PROJECT_ROOT + path.sep;

  if (abs !== env.PROJECT_ROOT && !abs.startsWith(root)) {
    throw new Error(`Access denied: '${relPath}' resolves outside the project root.`);
  }

  const content = await readFile(abs, "utf-8");

  if (!content.includes(replace)) {
    throw new Error(
      `The string "${replace}" was not found in ${relPath}. ` +
        "The file may have changed since the analysis was run.",
    );
  }

  const ext = path.extname(abs).toLowerCase();

  if (CSS_EXTENSIONS.has(ext) || !TSX_EXTENSIONS.has(ext)) {
    return applySimpleReplace(abs, content, replace, withStr);
  }

  return applyAstReplace(abs, content, replace, withStr);
}

// ---------------------------------------------------------------------------
// CSS / plain-text replacement
// ---------------------------------------------------------------------------

async function applySimpleReplace(
  abs: string,
  content: string,
  replace: string,
  withStr: string,
): Promise<WriteResult> {
  const lineNumber = lineOf(content, replace);
  const newContent = content.replace(replace, withStr);
  await writeFile(abs, newContent, "utf-8");
  log.info({ file: path.basename(abs), lineNumber, replace, with: withStr }, "applied CSS edit");
  return { linesChanged: 1, lineNumber, absolutePath: abs };
}

// ---------------------------------------------------------------------------
// TypeScript / JSX AST-based replacement
// ---------------------------------------------------------------------------

async function applyAstReplace(
  abs: string,
  content: string,
  replace: string,
  withStr: string,
): Promise<WriteResult> {
  let ast: recast.types.ASTNode;
  try {
    ast = recast.parse(content, recastParserOptions);
  } catch (e) {
    log.warn(
      { file: path.basename(abs), err: (e as Error).message },
      "Babel parse failed — falling back to string replace",
    );
    return applySimpleReplace(abs, content, replace, withStr);
  }

  let changed = false;
  let lineNumber = -1;

  recast.visit(ast, {
    // className="..." JSX attribute
    visitJSXAttribute(nodePath) {
      const attr = nodePath.node;
      const nameNode = attr.name;
      const attrName =
        "name" in nameNode ? String(nameNode.name) : String(nameNode);

      if (attrName === "className" && !changed) {
        const val = attr.value;

        if (
          val &&
          "type" in val &&
          val.type === "StringLiteral" &&
          "value" in val &&
          typeof val.value === "string" &&
          val.value.includes(replace)
        ) {
          const newValue = val.value.replaceAll(replace, withStr);
          (val as { value: string }).value = newValue;
          lineNumber = attr.loc?.start.line ?? lineOf(content, replace);
          changed = true;
        }
      }
      this.traverse(nodePath);
    },

    // className={`template`} or className={'string'} (JSX expression containers)
    visitJSXExpressionContainer(nodePath) {
      if (changed) {
        this.traverse(nodePath);
        return;
      }
      const expr = nodePath.node.expression;
      if (
        expr &&
        "type" in expr &&
        expr.type === "StringLiteral" &&
        "value" in expr &&
        typeof expr.value === "string" &&
        expr.value.includes(replace)
      ) {
        (expr as { value: string }).value = (expr as { value: string }).value.replaceAll(
          replace,
          withStr,
        );
        lineNumber = expr.loc?.start.line ?? lineOf(content, replace);
        changed = true;
      }
      this.traverse(nodePath);
    },
  });

  if (!changed) {
    log.debug(
      { file: path.basename(abs) },
      "AST walk did not locate className — using string replace",
    );
    return applySimpleReplace(abs, content, replace, withStr);
  }

  const printed = recast.print(ast, { useTabs: content.includes("\t") });
  await writeFile(abs, printed.code, "utf-8");
  log.info(
    { file: path.basename(abs), lineNumber, replace, with: withStr },
    "applied AST edit",
  );
  return { linesChanged: 1, lineNumber, absolutePath: abs };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the 1-based line number of the first occurrence of `str` in `content`. */
function lineOf(content: string, str: string): number {
  const idx = content.indexOf(str);
  if (idx === -1) return -1;
  return content.slice(0, idx).split("\n").length;
}
