import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SERVER = "http://127.0.0.1:4399";
const HERO_REL = "src/components/Hero.tsx";
const heroPath = path.resolve(__dirname, "../../demo", HERO_REL);

/**
 * Exercises the full server pipeline the extension drives — preview → apply —
 * against a real demo source file, then verifies the file changed on disk and
 * the rendered page reflects it after Next.js hot reload.
 *
 * Uses a deterministic Tailwind class swap (no Gemini) so it never flakes on
 * model availability. The original file is restored afterward.
 */
test.describe("full pipeline: preview + apply + hot reload", () => {
  let backup = "";

  test.beforeAll(() => {
    backup = readFileSync(heroPath, "utf8");
  });

  test.afterAll(() => {
    if (backup) writeFileSync(heroPath, backup, "utf8");
  });

  test("server health reports the demo as project root", async ({ request }) => {
    const res = await request.get(`${SERVER}/health`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.projectRoot).toContain("demo");
  });

  test("preview returns a contextual diff for a class swap", async ({ request }) => {
    const content = readFileSync(heroPath, "utf8");
    const match = content.match(/pt-(\d+)/);
    expect(match, "Hero.tsx should contain a pt-N utility").toBeTruthy();
    const oldClass = match![0];

    const res = await request.post(`${SERVER}/preview`, {
      data: { file: HERO_REL, replace: oldClass, with: "pt-40" },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBeTruthy();
    expect(body.found).toBeTruthy();
    expect(body.contextDiff).toContain(`- `);
    expect(body.contextDiff).toContain(`+ `);
  });

  test("apply writes the file and the page updates", async ({ page, request }) => {
    const content = readFileSync(heroPath, "utf8");
    const match = content.match(/pt-(\d+)/);
    expect(match).toBeTruthy();
    const oldClass = match![0];
    const oldN = Number(match![1]);
    const newN = oldN === 40 ? 24 : 40;
    const newClass = `pt-${newN}`;

    const res = await request.post(`${SERVER}/apply`, {
      data: { file: HERO_REL, replace: oldClass, with: newClass },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBeTruthy();
    expect(body.lineNumber).toBeGreaterThan(0);

    // File changed on disk.
    expect(readFileSync(heroPath, "utf8")).toContain(newClass);

    // Page reflects it after Tailwind JIT + hot reload (poll with reloads).
    const expectedPx = `${newN * 4}px`;
    await page.goto("/");
    await expect
      .poll(
        async () => {
          await page.reload({ waitUntil: "networkidle" });
          return page
            .locator("section")
            .first()
            .evaluate((el) => getComputedStyle(el).paddingTop);
        },
        { timeout: 40_000, intervals: [1000, 2000, 3000, 5000] },
      )
      .toBe(expectedPx);
  });

  test("local analyze maps a spacing change without any AI call", async ({ request }) => {
    const content = readFileSync(heroPath, "utf8");
    const match = content.match(/pt-(\d+)/);
    expect(match).toBeTruthy();
    const oldClass = match![0];

    const res = await request.post(`${SERVER}/analyze`, {
      data: {
        mode: "local",
        property: "padding-top",
        value: "96px",
        className: content.match(/className="([^"]*pt-\d+[^"]*)"/)?.[1] ?? oldClass,
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBeTruthy();
    expect(body.source).toBe("local");
    expect(body.suggestion.with).toBe("pt-24");
  });

  test("local analyze returns 422 for an unmappable property", async ({ request }) => {
    const res = await request.post(`${SERVER}/analyze`, {
      data: {
        mode: "local",
        property: "box-shadow",
        value: "0 4px 6px black",
        className: "bg-white rounded-2xl p-6 border border-gray-100 shadow-sm",
      },
    });
    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(body.canUseAi).toBe(true);
  });

  test("apply rejects path traversal", async ({ request }) => {
    const res = await request.post(`${SERVER}/apply`, {
      data: { file: "../../etc/passwd", replace: "root", with: "x" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.success).toBeFalsy();
  });
});
