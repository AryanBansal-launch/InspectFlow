// Project Tailwind theme awareness.
//
// The deterministic mapper assumes Tailwind's DEFAULT theme. Real projects
// customise it — brand colors most of all — so a color the developer picks may
// be a named token (`bg-brand-500`) rather than an arbitrary hex. This module
// reads the project's theme and feeds custom colors + named spacing into the
// mapper so those map to readable classes.
//
// It PARSES rather than EXECUTES the config, so it needs no tailwindcss install
// and works the same locally and in Docker:
//   • Tailwind v4 — scans CSS for `@theme { --color-*, --spacing-* }`.
//   • Tailwind v3 — best-effort dynamic import of tailwind.config.{js,cjs,mjs},
//     reading theme.colors / theme.extend.colors / spacing.
//
// On any failure it silently leaves the defaults in place. Re-checks the source
// at most once per TTL so config edits are picked up without per-request cost.

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { env } from "../config/env.js";
import { createLogger } from "../logger/index.js";
import { listSourceFiles } from "./fileSearch.js";
import { setCustomColors } from "./tailwindColors.js";
import { setCustomSpacing } from "./tailwindMap.js";

const log = createLogger("tailwind-theme");

const TTL_MS = 3000;
let lastLoad = 0;
let loading: Promise<void> | null = null;

/** Loads + applies the project theme, at most once per TTL. Never throws. */
export async function ensureThemeApplied(): Promise<void> {
  if (Date.now() - lastLoad < TTL_MS) return;
  if (loading) return loading;
  loading = loadAndApply()
    .catch((e) => log.debug({ err: (e as Error).message }, "theme load skipped"))
    .finally(() => {
      lastLoad = Date.now();
      loading = null;
    });
  return loading;
}

async function loadAndApply(): Promise<void> {
  const files = await listSourceFiles();

  const colors: Record<string, string> = {};
  const spacing: Record<string, string> = {};

  // --- Tailwind v4: @theme blocks in CSS ---
  for (const abs of files) {
    if (path.extname(abs).toLowerCase() !== ".css") continue;
    let css: string;
    try {
      css = await readFile(abs, "utf-8");
    } catch {
      continue;
    }
    if (!css.includes("@theme")) continue;
    parseV4Theme(css, colors, spacing);
  }

  // --- Tailwind v3: tailwind.config.{js,cjs,mjs} at the project root ---
  // Probed directly rather than via the source walk, whose extension filter
  // excludes .cjs. (.ts configs can't be imported without a loader — skipped.)
  const configPath = await findV3Config();
  if (configPath) {
    await parseV3Config(configPath, colors, spacing);
  }

  setCustomColors(colors);
  setCustomSpacing(spacing);

  const colorCount = Object.keys(colors).length;
  const spacingCount = Object.keys(spacing).length;
  if (colorCount || spacingCount) {
    log.info({ colorCount, spacingCount }, "applied custom Tailwind theme");
  }
}

// ---------------------------------------------------------------------------
// Tailwind v4 — CSS @theme parsing
// ---------------------------------------------------------------------------

/** Extracts custom `--color-*` / `--spacing-*` vars from each `@theme` block. */
function parseV4Theme(
  css: string,
  colors: Record<string, string>,
  spacing: Record<string, string>,
): void {
  for (const block of themeBlocks(css)) {
    const varRe = /--([a-zA-Z0-9-]+):\s*([^;]+);/g;
    let m: RegExpExecArray | null;
    while ((m = varRe.exec(block)) !== null) {
      const key = m[1]!;
      const value = m[2]!.trim();

      if (key.startsWith("color-")) {
        const hex = toHex(value);
        if (hex) colors[key.slice("color-".length)] = hex;
      } else if (key.startsWith("spacing-")) {
        const px = toPx(value);
        if (px !== null) spacing[`${px}px`] = key.slice("spacing-".length);
      }
    }
  }
}

/** Yields the `{...}` body of each `@theme` (and `@theme inline`) block. */
function* themeBlocks(css: string): Generator<string> {
  const re = /@theme[^{]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
    }
    yield css.slice(start, i - 1);
    re.lastIndex = i;
  }
}

// ---------------------------------------------------------------------------
// Tailwind v3 — config object parsing
// ---------------------------------------------------------------------------

/** Returns the path to a root-level tailwind.config.{js,cjs,mjs}, or null. */
async function findV3Config(): Promise<string | null> {
  for (const name of ["tailwind.config.js", "tailwind.config.cjs", "tailwind.config.mjs"]) {
    const abs = path.join(env.PROJECT_ROOT, name);
    try {
      await stat(abs);
      return abs;
    } catch {
      /* not present */
    }
  }
  return null;
}

async function parseV3Config(
  configPath: string,
  colors: Record<string, string>,
  spacing: Record<string, string>,
): Promise<void> {
  let cfg: Record<string, unknown>;
  try {
    const mod = (await import(pathToFileURL(configPath).href)) as Record<string, unknown>;
    cfg = (mod.default ?? mod) as Record<string, unknown>;
  } catch (e) {
    log.debug({ err: (e as Error).message }, "v3 config import failed");
    return;
  }

  const theme = (cfg.theme ?? {}) as Record<string, unknown>;
  const extend = (theme.extend ?? {}) as Record<string, unknown>;

  for (const src of [theme.colors, extend.colors]) {
    if (src && typeof src === "object") flattenColors(src as Record<string, unknown>, "", colors);
  }
  for (const src of [theme.spacing, extend.spacing]) {
    if (src && typeof src === "object") {
      for (const [token, value] of Object.entries(src as Record<string, unknown>)) {
        if (typeof value !== "string") continue;
        const px = toPx(value);
        if (px !== null) spacing[`${px}px`] = token;
      }
    }
  }
}

/** Flattens a (possibly nested) Tailwind color object to token → hex. */
function flattenColors(
  obj: Record<string, unknown>,
  prefix: string,
  out: Record<string, string>,
): void {
  for (const [key, value] of Object.entries(obj)) {
    // `DEFAULT` collapses to the bare prefix (e.g. brand.DEFAULT → "brand").
    const token = key === "DEFAULT" ? prefix : prefix ? `${prefix}-${key}` : key;
    if (typeof value === "string") {
      const hex = toHex(value);
      if (hex && token) out[token] = hex;
    } else if (value && typeof value === "object") {
      flattenColors(value as Record<string, unknown>, token, out);
    }
  }
}

// ---------------------------------------------------------------------------
// Value normalisation
// ---------------------------------------------------------------------------

/** Converts hex / rgb() color strings to "#rrggbb". Returns null otherwise
 *  (e.g. oklch/hsl — skipped, since the default palette already covers them). */
function toHex(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) {
    return "#" + v.slice(1).split("").map((c) => c + c).join("");
  }
  const m = v.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  if (m) {
    const h = (n: string) => Number(n).toString(16).padStart(2, "0");
    return `#${h(m[1]!)}${h(m[2]!)}${h(m[3]!)}`;
  }
  return null;
}

/** Converts px / rem / em lengths to pixels (rem/em assume 16px). Null otherwise. */
function toPx(value: string): number | null {
  const v = value.trim();
  if (v === "0") return 0;
  let m = v.match(/^(-?[\d.]+)px$/);
  if (m) return parseFloat(m[1]!);
  m = v.match(/^(-?[\d.]+)r?em$/);
  if (m) return Math.round(parseFloat(m[1]!) * 16);
  return null;
}

// Resets cached load state — used by tests.
export function _resetThemeCache(): void {
  lastLoad = 0;
  loading = null;
}
