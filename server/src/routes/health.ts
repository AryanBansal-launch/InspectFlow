import { Router } from "express";
import { env, hasGeminiKey } from "../config/env.js";
import { changeStore } from "../store/changeStore.js";

export const healthRouter: Router = Router();

/**
 * Liveness/readiness probe and quick configuration summary. Useful for the
 * Chrome extension popup to confirm the server is reachable and configured.
 */
healthRouter.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "inspectflow-server",
    projectRoot: env.PROJECT_ROOT,
    geminiConfigured: hasGeminiKey(),
    geminiModel: env.GEMINI_MODEL,
    capturedChanges: changeStore.size(),
  });
});
