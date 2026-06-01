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
 * A CSS change captured from the selected element ($0), enriched with the
 * element's className and (optionally) a `data-source-file` path.
 */
export interface CapturedChange {
  id: string;
  capturedAt: string;
  selector: string;
  property: string;
  value: string;
  /** Relative source-file path from `data-source-file` (if present). */
  file?: string;
  /** Current className string of the inspected element (if present). */
  className?: string;
}

/**
 * Messages sent to the background service worker — discriminated on `type`.
 * Each request has a matching response in {@link MessageResponseMap}.
 */
export type RequestMessage =
  | { type: "GET_SETTINGS" }
  | { type: "SET_SETTINGS"; settings: Partial<ExtensionSettings> }
  | { type: "CHECK_SERVER" }
  | { type: "SEND_STYLE_CHANGE"; change: CapturedChange }
  | { type: "ANALYZE_CHANGE"; change: CapturedChange; mode: "local" | "ai" }
  | { type: "PREVIEW_CHANGE"; file: string; replace: string; with: string }
  | { type: "APPLY_CHANGE"; file: string; replace: string; with: string };

/** Maps each request `type` to its response payload. */
export interface MessageResponseMap {
  GET_SETTINGS: { settings: ExtensionSettings };
  SET_SETTINGS: { settings: ExtensionSettings };
  CHECK_SERVER: { reachable: boolean; health?: ServerHealth; error?: string };
  SEND_STYLE_CHANGE: { success: boolean; serverId?: string; error?: string };
  ANALYZE_CHANGE: {
    success: boolean;
    /** The resolved (or auto-discovered) source file. */
    file?: string;
    suggestion?: { replace: string; with: string; reason?: string };
    source?: "local" | "ai";
    /** True when local mapping failed but AI analysis may succeed. */
    canUseAi?: boolean;
    error?: string;
  };
  PREVIEW_CHANGE: {
    success: boolean;
    diff?: string;
    contextDiff?: string;
    lineNumber?: number;
    found?: boolean;
    error?: string;
  };
  APPLY_CHANGE: {
    success: boolean;
    lineNumber?: number;
    linesChanged?: number;
    error?: string;
  };
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
