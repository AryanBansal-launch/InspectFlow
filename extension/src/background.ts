// Background service worker: the extension's central message hub.
//
// Phase 2 responsibilities:
//   - Initialize default settings on install.
//   - Answer settings + server-health requests from the popup and panel.
//
// Phases 3–4 extend this worker to attach the Chrome debugger to the inspected
// tab, capture CSS changes, and forward them to the server.

import { getSettings, setSettings } from "./shared/settings.js";
import { checkHealth } from "./shared/serverClient.js";
import type {
  ErrResponse,
  MessageResponse,
  MessageResponseMap,
  OkResponse,
  RequestMessage,
} from "./shared/types.js";

function ok<T>(data: T): OkResponse<T> {
  return { ok: true, data };
}

function err(message: string): ErrResponse {
  return { ok: false, error: message };
}

/** Routes a single request message to its handler and returns the response. */
async function handleMessage(
  message: RequestMessage,
): Promise<MessageResponse<MessageResponseMap[RequestMessage["type"]]>> {
  switch (message.type) {
    case "GET_SETTINGS": {
      const settings = await getSettings();
      return ok({ settings });
    }
    case "SET_SETTINGS": {
      const settings = await setSettings(message.settings);
      return ok({ settings });
    }
    case "CHECK_SERVER": {
      const settings = await getSettings();
      try {
        const health = await checkHealth(settings.serverUrl);
        return ok({ reachable: true, health });
      } catch (e) {
        return ok({ reachable: false, error: (e as Error).message });
      }
    }
    default: {
      // Exhaustiveness guard: a new message type without a handler is a bug.
      const exhaustive: never = message;
      return err(`Unknown message: ${JSON.stringify(exhaustive)}`);
    }
  }
}

chrome.runtime.onMessage.addListener((message: RequestMessage, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((e: unknown) => sendResponse(err((e as Error).message)));
  // Return true to keep the message channel open for the async response.
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  // Persist defaults (no-op merge if already set) so settings always exist.
  void setSettings({});
});
