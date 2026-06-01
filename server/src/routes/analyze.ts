import { Router } from "express";
import { analyzeStyleChange } from "../tools/analyzeStyleChange.js";
import { createLogger } from "../logger/index.js";
import { hasGeminiKey } from "../config/env.js";
import { analyzeRequestSchema } from "../services/geminiService.js";
import { safeValidate } from "../validation/schemas.js";

const log = createLogger("routes:analyze");

export const analyzeRouter: Router = Router();

/**
 * POST /analyze
 *
 * Reads the source file and calls Gemini to produce a find-and-replace
 * edit suggestion. Called by the Chrome extension after capturing a change
 * (Phase 5+).
 *
 * Body: { file, property, value, className?, selector? }
 * 200: { success: true, suggestion: { replace, with, reason? } }
 * 400: { success: false, errors: [...] }
 * 503: { success: false, error: "GEMINI_API_KEY not configured" }
 */
analyzeRouter.post("/analyze", async (req, res) => {
  if (!hasGeminiKey()) {
    res.status(503).json({
      success: false,
      error:
        "GEMINI_API_KEY is not configured. Add it to .env and restart the server.",
    });
    return;
  }

  const result = safeValidate(analyzeRequestSchema, req.body);
  if (!result.ok) {
    log.warn({ errors: result.errors }, "rejected invalid analyze request");
    res.status(400).json({ success: false, errors: result.errors });
    return;
  }

  const { file, property, value, className, selector } = result.data;
  log.info({ file, property, value }, "analyze request");

  try {
    const suggestion = await analyzeStyleChange({
      file,
      property,
      value,
      className,
      selector,
    });
    res.json({ success: true, suggestion });
  } catch (error) {
    const message = (error as Error).message;
    log.error({ err: error, file, property }, "analysis failed");

    // Surface file-not-found / path errors as 400, everything else as 500.
    const isClientError =
      message.includes("not found") ||
      message.includes("outside the project root") ||
      message.includes("directory");

    res.status(isClientError ? 400 : 500).json({ success: false, error: message });
  }
});
