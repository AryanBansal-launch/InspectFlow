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
