import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const demoDir = path.resolve(__dirname, "../demo");
const serverDir = path.resolve(__dirname, "../server");

/**
 * Spins up the MCP server (pointed at the demo project) and the demo Next.js
 * app, then runs the e2e suite against a real Chromium.
 *
 * `reuseExistingServer` lets the tests attach to servers you already have
 * running (the usual dev setup) instead of starting fresh ones.
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // MCP server, sandboxed to the demo project so /apply writes demo files.
      command: "npm run build && node dist/index.js",
      cwd: serverDir,
      env: {
        PROJECT_ROOT: demoDir,
        PORT: "4399",
        HOST: "127.0.0.1",
        LOG_PRETTY: "false",
      },
      url: "http://127.0.0.1:4399/health",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: "npm run dev",
      cwd: demoDir,
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
