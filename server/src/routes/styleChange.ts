import { Router } from "express";
import { createLogger } from "../logger/index.js";
import { changeStore } from "../store/changeStore.js";
import { safeValidate, styleChangeSchema } from "../validation/schemas.js";

const log = createLogger("routes:style-change");

export const styleChangeRouter: Router = Router();

/**
 * Feature 2 — receive a CSS change captured by the Chrome extension, validate
 * it, store it, and acknowledge. Analysis and file writes happen later via the
 * MCP tools; this endpoint only records the change.
 */
styleChangeRouter.post("/style-change", (req, res) => {
  const result = safeValidate(styleChangeSchema, req.body);

  if (!result.ok) {
    log.warn({ errors: result.errors }, "rejected invalid style-change payload");
    res.status(400).json({ success: false, errors: result.errors });
    return;
  }

  const stored = changeStore.add(result.data, new Date().toISOString());
  log.info(
    { id: stored.id, file: stored.file, property: stored.property, value: stored.value },
    "captured style change",
  );

  res.status(201).json({ success: true, change: stored });
});

/**
 * Inspect recently captured changes (newest first). Handy for debugging the
 * extension → server pipeline.
 */
styleChangeRouter.get("/style-change", (req, res) => {
  const rawLimit = Number(req.query.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;
  res.json({ success: true, count: changeStore.size(), changes: changeStore.list(limit) });
});
