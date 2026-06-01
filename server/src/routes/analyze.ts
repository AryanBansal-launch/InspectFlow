import { Router } from "express";
import { z } from "zod";
import { analyzeStyleChange } from "../tools/analyzeStyleChange.js";
import { createLogger } from "../logger/index.js";
import { hasGeminiKey } from "../config/env.js";
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
 * 200: { success: true, file: "src/...", suggestion: { replace, with, reason? } }
 * 400: validation error or file not found
 * 503: GEMINI_API_KEY not configured
 */
analyzeRouter.post("/analyze", async (req, res) => {
  if (!hasGeminiKey()) {
    res.status(503).json({
      success: false,
      error: "GEMINI_API_KEY is not configured. Add it to .env and restart the server.",
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
  log.info({ file: file ?? "(auto-discover)", property, value }, "analyze request");

  try {
    const analysis = await analyzeStyleChange({ file, property, value, className, selector });
    res.json({ success: true, file: analysis.file, suggestion: analysis.suggestion });
  } catch (error) {
    const message = (error as Error).message;
    log.error({ err: error, file, property }, "analysis failed");

    const isClientError =
      message.includes("not found") ||
      message.includes("outside the project root") ||
      message.includes("directory") ||
      message.includes("Cannot determine");

    res.status(isClientError ? 400 : 500).json({ success: false, error: message });
  }
});
