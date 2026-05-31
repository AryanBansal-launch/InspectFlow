import { Router } from "express";
import { healthRouter } from "./health.js";
import { styleChangeRouter } from "./styleChange.js";

/**
 * Aggregates all HTTP API routes. The MCP transport is mounted separately in
 * the Express app factory.
 */
export const apiRouter: Router = Router();

apiRouter.use(healthRouter);
apiRouter.use(styleChangeRouter);
