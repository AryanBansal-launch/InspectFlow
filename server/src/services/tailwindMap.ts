// Deterministic CSS → Tailwind class mapper.
//
// Handles the common, unambiguous cases (spacing, sizing, radius, font-size,
// colors) with pure arithmetic on the Tailwind scale — no AI, no network, no
// rate limits. The server tries this FIRST; Gemini is only a fallback for
// cases this cannot resolve.

import type { EditSuggestion } from "../validation/schemas.js";
import { isExactTailwindColor, nearestTailwindColor } from "./tailwindColors.js";

/** Tailwind default spacing scale: pixel value → scale token (1 unit = 4px). */
const DEFAULT_SPACING: Record<string, string> = {
  "0px": "0", "1px": "px", "2px": "0.5", "4px": "1", "6px": "1.5", "8px": "2",
  "10px": "2.5", "12px": "3", "14px": "3.5", "16px": "4", "20px": "5",
  "24px": "6", "28px": "7", "32px": "8", "36px": "9", "40px": "10",
  "44px": "11", "48px": "12", "56px": "14", "64px": "16", "80px": "20",
  "96px": "24", "112px": "28", "128px": "32", "144px": "36", "160px": "40",
  "176px": "44", "192px": "48", "208px": "52", "224px": "56", "240px": "60",
  "256px": "64", "288px": "72", "320px": "80", "384px": "96",
};

/**
 * Active spacing map (px → token). Starts as the default scale; the theme loader
 * merges any project-specific named spacing over it via {@link setCustomSpacing}.
 */
let SPACING: Record<string, string> = { ...DEFAULT_SPACING };

/** Merges project spacing overrides (px → token) over the default scale. */
export function setCustomSpacing(overrides: Record<string, string>): void {
  SPACING = { ...DEFAULT_SPACING, ...overrides };
}

/** font-size pixel value → Tailwind text-* token. */
const FONT_SIZE: Record<string, string> = {
  "12px": "xs", "14px": "sm", "16px": "base", "18px": "lg", "20px": "xl",
  "24px": "2xl", "30px": "3xl", "36px": "4xl", "48px": "5xl", "60px": "6xl",
  "72px": "7xl", "96px": "8xl", "128px": "9xl",
};

/** border-radius pixel value → suffix appended to "rounded". */
const RADIUS: Record<string, string> = {
  "0px": "-none", "2px": "-sm", "4px": "", "6px": "-md", "8px": "-lg",
  "12px": "-xl", "16px": "-2xl", "24px": "-3xl", "9999px": "-full",
};

/** font-weight numeric value → Tailwind font-* token. */
const FONT_WEIGHT: Record<string, string> = {
  "100": "thin", "200": "extralight", "300": "light", "400": "normal",
  "500": "medium", "600": "semibold", "700": "bold", "800": "extrabold",
  "900": "black",
};

/** Properties that use the spacing scale, mapped to their class prefixes (priority order). */
const SPACING_PREFIXES: Record<string, string[]> = {
  "padding": ["p"],
  "padding-left": ["pl", "ps", "px"],
  "padding-right": ["pr", "pe", "px"],
  "padding-top": ["pt", "py"],
  "padding-bottom": ["pb", "py"],
  "margin": ["m"],
  "margin-left": ["ml", "ms", "mx"],
  "margin-right": ["mr", "me", "mx"],
  "margin-top": ["mt", "my"],
  "margin-bottom": ["mb", "my"],
  "gap": ["gap"],
  "column-gap": ["gap-x", "gap"],
  "row-gap": ["gap-y", "gap"],
  "width": ["w"],
  "height": ["h"],
  "min-width": ["min-w"],
  "max-width": ["max-w"],
  "min-height": ["min-h"],
  "max-height": ["max-h"],
};

const SIZE_TOKENS = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl"];

/** line-height pixel value → Tailwind numeric leading-* token (1 unit = 4px). */
const LINE_HEIGHT: Record<string, string> = {
  "12px": "3", "16px": "4", "20px": "5", "24px": "6", "28px": "7",
  "32px": "8", "36px": "9", "40px": "10",
};

/** border-width pixel value → suffix appended to "border". */
const BORDER_WIDTH: Record<string, string> = {
  "0px": "-0", "1px": "", "2px": "-2", "4px": "-4", "8px": "-8",
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Converts "rgb(0, 0, 255)" → "#0000ff". Returns the input unchanged if not rgb. */
function rgbToHex(value: string): string {
  const m = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return value;
  const hex = (n: string) => Number(n).toString(16).padStart(2, "0");
  return `#${hex(m[1]!)}${hex(m[2]!)}${hex(m[3]!)}`;
}

/** Wraps a value as a Tailwind arbitrary value (spaces → underscores). */
function arbitrary(prefix: string, value: string): string {
  return `${prefix}-[${value.replace(/\s+/g, "_")}]`;
}

/**
 * Attempts to map a CSS property/value change to a Tailwind class swap, using
 * the element's current className to locate the class being replaced.
 *
 * Returns null when no confident mapping exists (caller falls back to Gemini).
 */
export function mapToTailwind(
  property: string,
  value: string,
  className: string | undefined,
): EditSuggestion | null {
  if (!className) return null;
  const classes = className.split(/\s+/).filter(Boolean);
  const val = value.trim();
  const prop = property.toLowerCase();

  // ---- Spacing / sizing scale ----
  const prefixes = SPACING_PREFIXES[prop];
  if (prefixes) {
    for (const pre of prefixes) {
      const re = new RegExp(`^${escapeRe(pre)}-(.+)$`);
      const old = classes.find((c) => re.test(c));
      if (!old) continue;
      const token = SPACING[val];
      const withClass = token !== undefined ? `${pre}-${token}` : arbitrary(pre, val);
      if (withClass === old) return null;
      return { replace: old, with: withClass, reason: `${property}: ${val} → ${withClass} (local map)` };
    }
    return null;
  }

  // ---- font-size ----
  if (prop === "font-size") {
    const old = classes.find(
      (c) => SIZE_TOKENS.some((t) => c === `text-${t}`) || /^text-\[/.test(c),
    );
    if (!old) return null;
    const token = FONT_SIZE[val];
    const withClass = token ? `text-${token}` : arbitrary("text", val);
    if (withClass === old) return null;
    return { replace: old, with: withClass, reason: `font-size: ${val} → ${withClass} (local map)` };
  }

  // ---- font-weight ----
  if (prop === "font-weight") {
    const old = classes.find((c) => /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/.test(c));
    if (!old) return null;
    const token = FONT_WEIGHT[val];
    if (!token) return null;
    const withClass = `font-${token}`;
    if (withClass === old) return null;
    return { replace: old, with: withClass, reason: `font-weight: ${val} → ${withClass} (local map)` };
  }

  // ---- border-radius ----
  if (prop === "border-radius") {
    const old = classes.find(
      (c) => c === "rounded" || /^rounded-(none|sm|md|lg|xl|2xl|3xl|full)$/.test(c) || /^rounded-\[/.test(c),
    );
    if (!old) return null;
    const suffix = RADIUS[val];
    const withClass = suffix !== undefined ? `rounded${suffix}` : arbitrary("rounded", val);
    if (withClass === old) return null;
    return { replace: old, with: withClass, reason: `border-radius: ${val} → ${withClass} (local map)` };
  }

  // ---- colors (text / background / border) → arbitrary hex ----
  const colorPrefix =
    prop === "color" ? "text" : prop === "background-color" ? "bg" : prop === "border-color" ? "border" : null;
  if (colorPrefix) {
    // Match an existing color utility: prefix-<name>-<shade>, prefix-white/black, or arbitrary.
    const re = new RegExp(
      `^${colorPrefix}-([a-z]+-\\d{2,3}|white|black|transparent|current|\\[[^\\]]+\\])$`,
    );
    const old = classes.find((c) => re.test(c));
    if (!old) return null;
    const hex = rgbToHex(val);
    // Prefer a readable named Tailwind class (text-blue-500) when the picked
    // color IS a palette color; fall back to an arbitrary hex otherwise.
    const named = nearestTailwindColor(hex);
    const withClass = isExactTailwindColor(named)
      ? `${colorPrefix}-${named.name}`
      : arbitrary(colorPrefix, hex);
    if (withClass === old) return null;
    return { replace: old, with: withClass, reason: `${property}: ${val} → ${withClass} (local map)` };
  }

  // ---- opacity ----
  if (prop === "opacity") {
    const old = classes.find((c) => /^opacity-(\d{1,3}|\[[^\]]+\])$/.test(c));
    if (!old) return null;
    const num = Number(val);
    if (Number.isNaN(num)) return null;
    const withClass = `opacity-${Math.round(num * 100)}`;
    if (withClass === old) return null;
    return { replace: old, with: withClass, reason: `opacity: ${val} → ${withClass} (local map)` };
  }

  // ---- text-align ----
  if (prop === "text-align") {
    const ALIGN = new Set(["left", "center", "right", "justify", "start", "end"]);
    if (!ALIGN.has(val)) return null;
    const old = classes.find((c) => /^text-(left|center|right|justify|start|end)$/.test(c));
    if (!old) return null;
    const withClass = `text-${val}`;
    if (withClass === old) return null;
    return { replace: old, with: withClass, reason: `text-align: ${val} → ${withClass} (local map)` };
  }

  // ---- text-transform ----
  if (prop === "text-transform") {
    const TRANSFORM: Record<string, string> = {
      uppercase: "uppercase", lowercase: "lowercase", capitalize: "capitalize", none: "normal-case",
    };
    const withClass = TRANSFORM[val];
    if (!withClass) return null;
    const old = classes.find((c) => /^(uppercase|lowercase|capitalize|normal-case)$/.test(c));
    if (!old) return null;
    if (withClass === old) return null;
    return { replace: old, with: withClass, reason: `text-transform: ${val} → ${withClass} (local map)` };
  }

  // ---- line-height (leading) ----
  if (prop === "line-height") {
    const old = classes.find(
      (c) => /^leading-(none|tight|snug|normal|relaxed|loose|\d{1,2}|\[[^\]]+\])$/.test(c),
    );
    if (!old) return null;
    const token = LINE_HEIGHT[val];
    const withClass = token !== undefined ? `leading-${token}` : arbitrary("leading", val);
    if (withClass === old) return null;
    return { replace: old, with: withClass, reason: `line-height: ${val} → ${withClass} (local map)` };
  }

  // ---- letter-spacing (tracking) ----
  if (prop === "letter-spacing") {
    const old = classes.find(
      (c) => /^tracking-(tighter|tight|normal|wide|wider|widest|\[[^\]]+\])$/.test(c),
    );
    if (!old) return null;
    const withClass = val === "normal" || val === "0px" ? "tracking-normal" : arbitrary("tracking", val);
    if (withClass === old) return null;
    return { replace: old, with: withClass, reason: `letter-spacing: ${val} → ${withClass} (local map)` };
  }

  // ---- border-width ----
  if (prop === "border-width") {
    const old = classes.find((c) => /^border(-(0|2|4|8))?$/.test(c) || /^border-\[[^\]]+\]$/.test(c));
    if (!old) return null;
    const token = BORDER_WIDTH[val];
    const withClass = token !== undefined ? `border${token}` : arbitrary("border", val);
    if (withClass === old) return null;
    return { replace: old, with: withClass, reason: `border-width: ${val} → ${withClass} (local map)` };
  }

  return null;
}
