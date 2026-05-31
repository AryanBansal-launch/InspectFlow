import { pino, type Logger, type LoggerOptions } from "pino";
import { env } from "../config/env.js";

const options: LoggerOptions = {
  level: env.LOG_LEVEL,
  base: { service: "inspectflow-server" },
  redact: {
    // Never leak secrets into logs.
    paths: ["GEMINI_API_KEY", "*.GEMINI_API_KEY", "headers.authorization"],
    censor: "[redacted]",
  },
};

if (env.LOG_PRETTY) {
  options.transport = {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:HH:MM:ss.l",
      ignore: "pid,hostname,service",
    },
  };
}

/**
 * Root application logger. Use `logger.child({ module: "..." })` to create
 * scoped loggers that automatically tag their module name.
 */
export const logger: Logger = pino(options);

/**
 * Creates a child logger bound to a specific module name.
 */
export function createLogger(module: string): Logger {
  return logger.child({ module });
}
