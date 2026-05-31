// Shared types used across the extension's contexts (background, devtools
// panel, popup). Kept dependency-free so any context can import them.

/** Persisted user settings (chrome.storage.sync). */
export interface ExtensionSettings {
  /** Base URL of the local InspectFlow MCP server. */
  serverUrl: string;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  serverUrl: "http://127.0.0.1:4399",
};

/** Shape returned by the server's `GET /health` endpoint. */
export interface ServerHealth {
  status: string;
  service: string;
  projectRoot: string;
  geminiConfigured: boolean;
  geminiModel: string;
  capturedChanges: number;
}

/**
 * A CSS change captured from DevTools and (in Phase 4) sent to the server.
 * `file` is resolved from the inspected element's `data-source-file` attribute.
 */
export interface CapturedChange {
  file?: string;
  selector?: string;
  property: string;
  value: string;
  className?: string;
}

/**
 * Messages sent to the background service worker. Discriminated on `type`.
 * Each request has a matching response in {@link MessageResponseMap}.
 */
export type RequestMessage =
  | { type: "GET_SETTINGS" }
  | { type: "SET_SETTINGS"; settings: Partial<ExtensionSettings> }
  | { type: "CHECK_SERVER" };

/** Maps each request `type` to its response payload. */
export interface MessageResponseMap {
  GET_SETTINGS: { settings: ExtensionSettings };
  SET_SETTINGS: { settings: ExtensionSettings };
  CHECK_SERVER: { reachable: boolean; health?: ServerHealth; error?: string };
}

/** A successful response envelope. */
export interface OkResponse<T> {
  ok: true;
  data: T;
}

/** A failed response envelope. */
export interface ErrResponse {
  ok: false;
  error: string;
}

export type MessageResponse<T> = OkResponse<T> | ErrResponse;

/** Type-safe wrapper around `chrome.runtime.sendMessage`. */
export async function sendMessage<T extends RequestMessage["type"]>(
  message: Extract<RequestMessage, { type: T }>,
): Promise<MessageResponse<MessageResponseMap[T]>> {
  return chrome.runtime.sendMessage(message);
}
