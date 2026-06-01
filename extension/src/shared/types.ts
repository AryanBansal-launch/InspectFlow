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
 * A raw CSS change as extracted from the stylesheet diff —  the panel adds
 * `file` and `className` from the inspected element's dataset before
 * displaying it or sending it to the server.
 */
export interface RawCssChange {
  selector: string;
  property: string;
  value: string;
}

/**
 * A CSS change enriched with React source-mapping info read from the
 * `data-source-file` attribute of the currently selected element ($0).
 */
export interface CapturedChange extends RawCssChange {
  id: string;
  capturedAt: string;
  /** Relative source-file path from `data-source-file` (if present). */
  file?: string;
  /** Current className string of the inspected element (if present). */
  className?: string;
}

/** Live state of the debugger capture session. */
export interface CaptureState {
  active: boolean;
  tabId: number | null;
}

/**
 * Messages sent to the background service worker — discriminated on `type`.
 * Each request has a matching response in {@link MessageResponseMap}.
 */
export type RequestMessage =
  | { type: "GET_SETTINGS" }
  | { type: "SET_SETTINGS"; settings: Partial<ExtensionSettings> }
  | { type: "CHECK_SERVER" }
  | { type: "START_CAPTURE"; tabId: number }
  | { type: "STOP_CAPTURE"; tabId: number }
  | { type: "GET_CAPTURE_STATE" };

/** Maps each request `type` to its response payload. */
export interface MessageResponseMap {
  GET_SETTINGS: { settings: ExtensionSettings };
  SET_SETTINGS: { settings: ExtensionSettings };
  CHECK_SERVER: { reachable: boolean; health?: ServerHealth; error?: string };
  START_CAPTURE: { success: boolean; error?: string };
  STOP_CAPTURE: { success: boolean; error?: string };
  GET_CAPTURE_STATE: CaptureState;
}

/**
 * Messages pushed from the background service worker to panel ports —
 * these flow over `chrome.runtime.Port` rather than one-shot sendMessage.
 */
export type PanelPushMessage =
  | { type: "CAPTURE_STARTED"; tabId: number }
  | { type: "CAPTURE_STOPPED" }
  | { type: "CAPTURE_ERROR"; error: string }
  | { type: "CSS_CHANGE_DETECTED"; rawChange: RawCssChange };

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
