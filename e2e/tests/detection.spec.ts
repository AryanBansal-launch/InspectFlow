import { test, expect } from "@playwright/test";

// The exact property set the panel watches on the selected element ($0).
const TRACKED_PROPS = [
  "padding", "margin", "border-radius", "border-width", "border-color",
  "color", "background-color",
  "font-size", "font-weight", "line-height", "letter-spacing", "text-align", "text-transform",
  "width", "height", "min-width", "max-width", "min-height", "max-height",
  "gap", "row-gap", "column-gap",
  "opacity", "box-shadow",
  "display", "flex-direction", "align-items", "justify-content",
  "position", "top", "right", "bottom", "left", "z-index",
];

/**
 * Validates the core detection mechanism the panel uses: snapshot an element's
 * computed style, mutate it (as DevTools would), snapshot again, diff.
 *
 * This is the exact logic from panel.ts `pollOnce`, run inside a real Chromium
 * against the live demo page — so it proves the approach works regardless of
 * how a style edit is applied.
 */
test.describe("computed-style detection core", () => {
  test("detects a padding change on an element", async ({ page }) => {
    await page.goto("/");

    const result = await page.evaluate((props) => {
      const snap = (el: Element): Record<string, string> => {
        const cs = getComputedStyle(el);
        const out: Record<string, string> = {};
        for (const name of props) out[name] = cs.getPropertyValue(name);
        return out;
      };

      const el =
        document.querySelector("a.bg-indigo-600") ??
        document.querySelector("nav a") ??
        document.querySelector("a");
      if (!el) return { error: "no target element found" } as const;

      const before = snap(el);
      // Simulate a DevTools style edit (inline override is one of the ways
      // DevTools applies changes; computed style reflects it either way).
      (el as HTMLElement).style.setProperty("padding", "32px");
      const after = snap(el);

      const changed = props
        .filter((p) => before[p] !== after[p])
        .map((p) => ({ property: p, before: before[p], after: after[p] }));
      return { changed } as const;
    }, TRACKED_PROPS);

    expect("error" in result ? result.error : undefined).toBeUndefined();
    if ("changed" in result) {
      const padding = result.changed.find((c) => c.property === "padding");
      expect(padding, "padding change should be detected").toBeTruthy();
      expect(padding!.after).toBe("32px");
    }
  });

  test("detects a color change", async ({ page }) => {
    await page.goto("/");

    const detected = await page.evaluate((props) => {
      const snap = (el: Element): Record<string, string> => {
        const cs = getComputedStyle(el);
        const out: Record<string, string> = {};
        for (const name of props) out[name] = cs.getPropertyValue(name);
        return out;
      };
      const el = document.querySelector("h1");
      if (!el) return null;
      const before = snap(el);
      (el as HTMLElement).style.setProperty("color", "rgb(0, 0, 255)");
      const after = snap(el);
      return before["color"] !== after["color"] ? after["color"] : null;
    }, TRACKED_PROPS);

    expect(detected).toBe("rgb(0, 0, 255)");
  });

  test("does not report changes when nothing is edited", async ({ page }) => {
    await page.goto("/");

    const changed = await page.evaluate((props) => {
      const snap = (el: Element): Record<string, string> => {
        const cs = getComputedStyle(el);
        const out: Record<string, string> = {};
        for (const name of props) out[name] = cs.getPropertyValue(name);
        return out;
      };
      const el = document.querySelector("h1");
      if (!el) return ["no-element"];
      const a = snap(el);
      const b = snap(el);
      return props.filter((p) => a[p] !== b[p]);
    }, TRACKED_PROPS);

    expect(changed).toEqual([]);
  });
});
