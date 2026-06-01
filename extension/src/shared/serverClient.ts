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
