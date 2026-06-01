import type { ServerHealth } from "./types.js";

/** Thrown when the server responds with a non-2xx status. */
export class ServerError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ServerError";
  }
}

const REQUEST_TIMEOUT_MS = 5000;

/** Performs a fetch with a timeout, throwing on network/timeout errors. */
async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Request to ${url} timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    throw new Error(`Could not reach ${url}: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Calls `GET /health` and returns the parsed health summary. */
export async function checkHealth(serverUrl: string): Promise<ServerHealth> {
  const res = await fetchWithTimeout(`${serverUrl}/health`);
  if (!res.ok) {
    throw new ServerError(`Server returned ${res.status}`, res.status);
  }
  return (await res.json()) as ServerHealth;
}

/** Payload for `POST /style-change` — mirrors the server's `StyleChange` schema. */
export interface StyleChangePayload {
  file?: string;
  selector?: string;
  property: string;
  value: string;
  className?: string;
}

/** Shape of the `201` success response from `POST /style-change`. */
export interface PostStyleChangeResult {
  success: true;
  change: {
    id: string;
    receivedAt: string;
    file?: string;
    selector?: string;
    property: string;
    value: string;
    className?: string;
  };
}

/** Shape of the `400` validation-error response from `POST /style-change`. */
interface PostStyleChangeError {
  success: false;
  errors: Array<{ path: string; message: string }>;
}

/** Result shape from `POST /analyze`. */
export interface AnalyzeResult {
  success: boolean;
  /** The resolved source file (may be auto-discovered when not supplied). */
  file?: string;
  suggestion?: { replace: string; with: string; reason?: string };
  error?: string;
}

/** Calls `POST /analyze` to get a Gemini edit suggestion. */
export async function analyzeChange(
  serverUrl: string,
  payload: StyleChangePayload,
): Promise<AnalyzeResult> {
  const res = await fetchWithTimeout(`${serverUrl}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return (await res.json()) as AnalyzeResult;
}

/** Result shape from `POST /preview`. */
export interface PreviewResult {
  success: boolean;
  diff?: string;
  contextDiff?: string;
  lineNumber?: number;
  found?: boolean;
  error?: string;
}

/** Calls `POST /preview` to get a contextual diff. */
export async function previewChange(
  serverUrl: string,
  payload: { file: string; replace: string; with: string },
): Promise<PreviewResult> {
  const res = await fetchWithTimeout(`${serverUrl}/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return (await res.json()) as PreviewResult;
}

/** Result shape from `POST /apply`. */
export interface ApplyResult {
  success: boolean;
  lineNumber?: number;
  linesChanged?: number;
  error?: string;
}

/** Calls `POST /apply` to write the approved edit to disk. */
export async function applyChange(
  serverUrl: string,
  payload: { file: string; replace: string; with: string },
): Promise<ApplyResult> {
  const res = await fetchWithTimeout(`${serverUrl}/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return (await res.json()) as ApplyResult;
}

/**
 * Posts a captured style change to the MCP server.
 * Throws `ServerError` on non-2xx responses, or a network `Error` on failure.
 */
export async function postStyleChange(
  serverUrl: string,
  payload: StyleChangePayload,
): Promise<PostStyleChangeResult> {
  const res = await fetchWithTimeout(`${serverUrl}/style-change`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (res.status === 400) {
    const body = (await res.json()) as PostStyleChangeError;
    const summary = body.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
    throw new ServerError(`Validation failed — ${summary}`, 400);
  }

  if (!res.ok) {
    throw new ServerError(`Server returned ${res.status}`, res.status);
  }

  return (await res.json()) as PostStyleChangeResult;
}
