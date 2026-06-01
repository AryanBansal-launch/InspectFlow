import { Router } from "express";
import { analyzeRouter } from "./analyze.js";
import { applyRouter } from "./apply.js";
import { healthRouter } from "./health.js";
import { previewRouter } from "./preview.js";
import { styleChangeRouter } from "./styleChange.js";

export const apiRouter: Router = Router();

apiRouter.use(healthRouter);
apiRouter.use(styleChangeRouter);
apiRouter.use(analyzeRouter);
apiRouter.use(previewRouter);
apiRouter.use(applyRouter);
