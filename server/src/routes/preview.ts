import { Router } from "express";
import { z } from "zod";
import {
  generateContextDiff,
  generateSimpleDiff,
} from "../analyzers/diffGenerator.js";
import { createLogger } from "../logger/index.js";
import { safeValidate } from "../validation/schemas.js";

const log = createLogger("routes:preview");
export const previewRouter: Router = Router();

const previewSchema = z.object({
  replace: z.string().min(1, "replace is required"),
  with: z.string(),
  file: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || !v.includes("\0"), "file must not contain null bytes")
    .refine(
      (v) => !v || !v.split(/[\\/]/).includes(".."),
      "file must not contain '..' segments",
    ),
});

/**
 * POST /preview
 *
 * Returns a diff preview for a proposed edit.
 * Body: { replace, with, file? }
 * 200: { success: true, diff, contextDiff?, lineNumber? }
 */
previewRouter.post("/preview", async (req, res) => {
  const result = safeValidate(previewSchema, req.body);
  if (!result.ok) {
    res.status(400).json({ success: false, errors: result.errors });
    return;
  }

  const { replace, with: withStr, file } = result.data;

  if (file) {
    const diff = await generateContextDiff(file, replace, withStr);
    log.debug({ file, found: diff.found, lineNumber: diff.lineNumber }, "preview generated");
    res.json({
      success: true,
      diff: diff.simpleDiff,
      contextDiff: diff.contextDiff,
      lineNumber: diff.lineNumber,
      found: diff.found,
    });
    return;
  }

  res.json({
    success: true,
    diff: generateSimpleDiff(replace, withStr),
    found: true,
  });
});
