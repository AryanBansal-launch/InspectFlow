import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { z } from "zod";

// Load variables from a local .env file (if present) before validation.
loadDotenv();

/**
 * Coerces common truthy/falsy string representations into a boolean.
 */
const booleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === "boolean") return value;
    return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
  });

const LogLevel = z.enum([
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
  "silent",
]);

const envSchema = z.object({
  GEMINI_API_KEY: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  GEMINI_MODEL: z.string().trim().min(1).default("gemini-2.5-flash"),
  PORT: z.coerce.number().int().positive().max(65535).default(4399),
  HOST: z.string().trim().min(1).default("127.0.0.1"),
  PROJECT_ROOT: z
    .string()
    .trim()
    .optional()
    .transform((value) =>
      value && value.length > 0
        ? path.resolve(value)
        : path.resolve(process.cwd()),
    ),
  LOG_LEVEL: LogLevel.default("info"),
  LOG_PRETTY: booleanFromString.default(process.env["NODE_ENV"] !== "production" && process.stdout.isTTY),
  CORS_ORIGINS: z
    .string()
    .trim()
    .default("*")
    .transform((value) =>
      value === "*"
        ? ("*" as const)
        : value
            .split(",")
            .map((origin) => origin.trim())
            .filter((origin) => origin.length > 0),
    ),
});

export type AppEnv = z.infer<typeof envSchema>;

/**
 * Parses and validates `process.env` once at startup. On invalid configuration
 * the process exits with a descriptive error instead of failing later at runtime.
 */
function loadEnv(): AppEnv {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");

    // eslint-disable-next-line no-console -- logger is not available yet at this stage.
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }

  return parsed.data;
}

export const env: AppEnv = loadEnv();

/**
 * Convenience flag: analysis features require a Gemini API key.
 */
export const hasGeminiKey = (): boolean => Boolean(env.GEMINI_API_KEY);
