import { Router } from "express";
import { z } from "zod";
import { analyzeStyleChange } from "../tools/analyzeStyleChange.js";
import { analyzeTextChange } from "../tools/analyzeTextChange.js";
import { createLogger } from "../logger/index.js";
import { safeValidate } from "../validation/schemas.js";

const log = createLogger("routes:analyze");
export const analyzeRouter: Router = Router();

const analyzeRequestSchema = z.object({
  file: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || !v.includes("\0"), "file must not contain null bytes")
    .refine(
      (v) => !v || !v.split(/[\\/]/).includes(".."),
      "file must not contain '..' segments",
    )
    .refine(
      (v) => !v || !/^([a-zA-Z]:[\\/]|[\\/])/.test(v),
      "file must be a relative path",
    ),
  property: z
    .string()
    .trim()
    .min(1, "property is required")
    .regex(/^-?[a-zA-Z][a-zA-Z0-9-]*$/, "must be a valid CSS property name"),
  value: z.string().trim().min(1, "value is required").max(2000),
  className: z.string().trim().max(4000).optional(),
  selector: z.string().trim().max(1000).optional(),
  mode: z.enum(["local", "ai"]).optional(),
  changeType: z.enum(["css", "text"]).optional(),
  previousValue: z.string().trim().max(10000).optional(),
});

/**
 * POST /analyze
 *
 * Reads the source file and calls Gemini to produce a find-and-replace
 * edit suggestion.
 *
 * `file` is optional — when omitted the server searches PROJECT_ROOT for a
 * source file containing `className` and uses the best match automatically.
 *
 * Common Tailwind edits resolve via a deterministic local mapper (no API call).
 * Only cases the mapper can't handle fall back to Gemini.
 *
 * 200: { success: true, file: "src/...", suggestion: { replace, with, reason? } }
 * 400: validation error or file not found
 * 503: Gemini needed but unavailable (no key / quota exhausted)
 */
analyzeRouter.post("/analyze", async (req, res) => {
  const result = safeValidate(analyzeRequestSchema, req.body);
  if (!result.ok) {
    log.warn({ errors: result.errors }, "rejected invalid analyze request");
    res.status(400).json({ success: false, errors: result.errors });
    return;
  }

  const { file, property, value, className, selector, mode, changeType, previousValue } = result.data;
  log.info({ file: file ?? "(auto-discover)", property, value, mode: mode ?? "local", changeType }, "analyze request");

  try {
    // Text content change: find the old string in source and swap it for the new one.
    if (changeType === "text") {
      if (!previousValue) {
        res.status(400).json({ success: false, error: "previousValue is required for text changes" });
        return;
      }
      const analysis = await analyzeTextChange({ file, oldText: previousValue, newText: value, className });
      res.json({ success: true, file: analysis.file, suggestion: analysis.suggestion, source: analysis.source });
      return;
    }

    const analysis = await analyzeStyleChange({ file, property, value, className, selector, mode });
    res.json({
      success: true,
      file: analysis.file,
      suggestion: analysis.suggestion,
      source: analysis.source,
    });
  } catch (error) {
    const message = (error as Error).message;
    const name = (error as Error).name;
    log.error({ err: error, file, property }, "analysis failed");

    // No deterministic mapping → 422 so the client can offer "Analyze with AI".
    if (name === "NoLocalMappingError") {
      res.status(422).json({ success: false, error: message, canUseAi: true });
      return;
    }

    const isClientError =
      message.includes("not found") ||
      message.includes("outside the project root") ||
      message.includes("directory") ||
      message.includes("Cannot determine");

    // Gemini unavailable (no key or quota exhausted) → 503.
    const isGeminiUnavailable =
      message.includes("GEMINI_API_KEY") ||
      message.includes("quota") ||
      message.includes("high demand") ||
      message.includes("RESOURCE_EXHAUSTED");

    const status = isClientError ? 400 : isGeminiUnavailable ? 503 : 500;
    res.status(status).json({ success: false, error: message });
  }
});
