import { Router } from "express";
import { z } from "zod";
import { createLogger } from "../logger/index.js";
import { safeValidate } from "../validation/schemas.js";
import { applyEdit } from "../writers/fileWriter.js";

const log = createLogger("routes:apply");
export const applyRouter: Router = Router();

const applySchema = z.object({
  file: z
    .string()
    .trim()
    .min(1, "file is required")
    .refine((v) => !v.includes("\0"), "file must not contain null bytes")
    .refine(
      (v) => !v.split(/[\\/]/).includes(".."),
      "file must not contain '..' segments",
    )
    .refine(
      (v) => !/^([a-zA-Z]:[\\/]|[\\/])/.test(v),
      "file must be a relative path",
    ),
  replace: z.string().min(1, "replace is required"),
  with: z.string(),
});

/**
 * POST /apply
 *
 * Writes an approved find-and-replace edit to the source file.
 * MUST only be called after the user has confirmed the diff.
 *
 * Body: { file, replace, with }
 * 200: { success: true, lineNumber, linesChanged }
 * 400: validation error or string not found in file
 * 500: write failure
 */
applyRouter.post("/apply", async (req, res) => {
  const result = safeValidate(applySchema, req.body);
  if (!result.ok) {
    res.status(400).json({ success: false, errors: result.errors });
    return;
  }

  const { file, replace, with: withStr } = result.data;
  log.info({ file, replace, with: withStr }, "apply request — writing file");

  try {
    const writeResult = await applyEdit(file, replace, withStr);
    log.info(
      { file, lineNumber: writeResult.lineNumber },
      "file updated successfully",
    );
    res.json({
      success: true,
      file,
      lineNumber: writeResult.lineNumber,
      linesChanged: writeResult.linesChanged,
    });
  } catch (error) {
    const message = (error as Error).message;
    log.error({ err: error, file }, "apply failed");

    const isClientError =
      message.includes("not found") ||
      message.includes("outside the project root") ||
      message.includes("Access denied");

    res.status(isClientError ? 400 : 500).json({ success: false, error: message });
  }
});
