// Builds the InspectFlow Chrome extension into ./dist.
// - Bundles each TypeScript entry point with esbuild.
// - Copies static assets (HTML, CSS, manifest, icons).
// Run with `--watch` for incremental rebuilds during development.
import * as esbuild from "esbuild";
import {
  cpSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "src");
const DIST = join(__dirname, "dist");
const watch = process.argv.includes("--watch");

const ENTRY_POINTS = {
  background: join(SRC, "background.ts"),
  devtools: join(SRC, "devtools.ts"),
  panel: join(SRC, "panel.ts"),
  popup: join(SRC, "popup.ts"),
};

/** Copies HTML/CSS sources and the manifest + icons into dist. */
function copyStatic() {
  // HTML + CSS files alongside their entry points.
  for (const file of readdirSync(SRC)) {
    if (file.endsWith(".html")) cpSync(join(SRC, file), join(DIST, file));
  }
  cpSync(join(SRC, "styles"), join(DIST, "styles"), { recursive: true });
  cpSync(join(__dirname, "manifest.json"), join(DIST, "manifest.json"));
  cpSync(join(__dirname, "icons"), join(DIST, "icons"), { recursive: true });
}

/** Ensures icons exist before copying them into dist. */
function ensureIcons() {
  try {
    readdirSync(join(__dirname, "icons")).some((f) => f.endsWith(".png")) ||
      execFileSync(process.execPath, ["scripts/generate-icons.mjs"], {
        cwd: __dirname,
        stdio: "inherit",
      });
  } catch {
    execFileSync(process.execPath, ["scripts/generate-icons.mjs"], {
      cwd: __dirname,
      stdio: "inherit",
    });
  }
}

const buildOptions = {
  entryPoints: ENTRY_POINTS,
  outdir: DIST,
  entryNames: "[name]",
  bundle: true,
  format: "esm",
  target: ["chrome116"],
  platform: "browser",
  sourcemap: true,
  logLevel: "info",
};

async function run() {
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
  ensureIcons();
  copyStatic();

  if (watch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    // esbuild watches the TS graph; re-run `npm run build` for manifest/HTML edits.
    console.log("watching for changes… (re-run build for manifest/HTML edits)");
  } else {
    await esbuild.build(buildOptions);
    console.log(`built extension → ${DIST}`);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
