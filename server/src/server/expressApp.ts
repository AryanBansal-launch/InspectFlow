import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { pinoHttp } from "pino-http";
import { env } from "../config/env.js";
import { createLogger, logger } from "../logger/index.js";
import { apiRouter } from "../routes/index.js";
import { createMcpServer } from "./mcpServer.js";

const log = createLogger("http");

/**
 * Handles a single MCP request using a fresh, stateless server + transport.
 * Each request gets its own instances and they are torn down when the response
 * closes — this keeps the local server simple and avoids cross-request state.
 */
async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    log.error({ err: error }, "MCP request failed");
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
}

/**
 * Builds the Express application: security/CORS middleware, request logging,
 * the JSON API routes, and the MCP HTTP transport endpoint at `/mcp`.
 */
export function createExpressApp(): Express {
  const app = express();

  app.disable("x-powered-by");

  app.use(
    cors({
      origin: env.CORS_ORIGINS === "*" ? true : env.CORS_ORIGINS,
      // The MCP StreamableHTTP transport reads these headers/methods.
      methods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "mcp-session-id"],
      exposedHeaders: ["mcp-session-id"],
    }),
  );

  app.use(express.json({ limit: "1mb" }));
  app.use(pinoHttp({ logger }));

  // JSON API (health, style-change capture, ...).
  app.use("/", apiRouter);

  // Model Context Protocol endpoint (stateless StreamableHTTP transport).
  app.post("/mcp", (req, res) => {
    void handleMcpRequest(req, res);
  });

  // GET/DELETE on /mcp are only meaningful for session-based transports; this
  // server is stateless, so we respond with a clear Method Not Allowed.
  const methodNotAllowed = (_req: Request, res: Response): void => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed: server is stateless." },
      id: null,
    });
  };
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  // 404 for unknown routes.
  app.use((req, res) => {
    res.status(404).json({ success: false, error: `Not found: ${req.method} ${req.path}` });
  });

  // Centralized error handler.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    log.error({ err }, "unhandled request error");
    if (res.headersSent) return;
    res.status(500).json({ success: false, error: "Internal server error" });
  });

  return app;
}
