#!/usr/bin/env node
import type { Server } from "node:http";
import { env, hasGeminiKey } from "./config/env.js";
import { logger } from "./logger/index.js";
import { createExpressApp } from "./server/expressApp.js";

function main(): void {
  const app = createExpressApp();

  const server: Server = app.listen(env.PORT, env.HOST, () => {
    logger.info(
      {
        host: env.HOST,
        port: env.PORT,
        projectRoot: env.PROJECT_ROOT,
        geminiConfigured: hasGeminiKey(),
        geminiModel: env.GEMINI_MODEL,
      },
      `InspectFlow MCP server listening on http://${env.HOST}:${env.PORT}`,
    );
    if (!hasGeminiKey()) {
      logger.warn(
        "GEMINI_API_KEY is not set — capture works, but analysis features are disabled.",
      );
    }
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      logger.fatal(`Port ${env.PORT} is already in use on ${env.HOST}.`);
    } else {
      logger.fatal({ err: error }, "HTTP server error");
    }
    process.exit(1);
  });

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info(`Received ${signal}, shutting down gracefully…`);
    server.close((err) => {
      if (err) {
        logger.error({ err }, "error during shutdown");
        process.exit(1);
      }
      logger.info("Server closed. Bye.");
      process.exit(0);
    });
    // Force-exit if connections do not drain promptly.
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  process.on("uncaughtException", (error) => {
    logger.fatal({ err: error }, "uncaught exception");
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    logger.fatal({ err: reason }, "unhandled promise rejection");
    process.exit(1);
  });
}

main();
