import type { RawCssChange } from "./types.js";

interface ParsedRule {
  selector: string;
  declarations: Map<string, string>;
}

/**
 * Parses a flat CSS text (inspector-stylesheet style) into rules.
 * Handles nested braces by tracking depth, so `@media` blocks are skipped
 * cleanly (depth > 1 content is ignored for our purposes).
 */
function parseStylesheet(text: string): ParsedRule[] {
  const rules: ParsedRule[] = [];
  let i = 0;

  while (i < text.length) {
    // Skip whitespace between rules.
    while (i < text.length && /\s/.test(text[i] as string)) i++;
    if (i >= text.length) break;

    // Find the opening brace for this rule.
    const braceOpen = text.indexOf("{", i);
    if (braceOpen === -1) break;

    const selector = text.slice(i, braceOpen).trim();

    // Walk forward to find the matching closing brace, tracking depth.
    let depth = 1;
    let j = braceOpen + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") depth--;
      j++;
    }

    const body = text.slice(braceOpen + 1, j - 1);

    // Only process top-level rules (not @media internals).
    if (selector && !selector.trimStart().startsWith("@")) {
      const declarations = new Map<string, string>();
      for (const decl of body.split(";")) {
        const trimmed = decl.trim();
        if (!trimmed) continue;
        const colon = trimmed.indexOf(":");
        if (colon === -1) continue;
        const prop = trimmed.slice(0, colon).trim().toLowerCase();
        const value = trimmed.slice(colon + 1).trim();
        if (prop) declarations.set(prop, value);
      }
      if (declarations.size > 0) {
        rules.push({ selector, declarations });
      }
    }

    i = j;
  }
  return rules;
}

/**
 * Compares two stylesheet text snapshots and returns every declaration that
 * was added or whose value changed in `newText` relative to `oldText`.
 *
 * This is used after `CSS.styleSheetChanged` to pinpoint exactly what the
 * developer edited in the DevTools Styles panel.
 */
export function diffStylesheets(oldText: string, newText: string): RawCssChange[] {
  const oldRuleMap = new Map(
    parseStylesheet(oldText).map((r) => [r.selector, r.declarations]),
  );

  const changes: RawCssChange[] = [];

  for (const rule of parseStylesheet(newText)) {
    const oldDecls = oldRuleMap.get(rule.selector) ?? new Map<string, string>();
    for (const [property, value] of rule.declarations) {
      if (oldDecls.get(property) !== value) {
        changes.push({ selector: rule.selector, property, value });
      }
    }
  }

  return changes;
}
