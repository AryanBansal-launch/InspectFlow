// Background service worker: message hub between the panel/popup and the
// MCP server. Detection of CSS changes happens entirely in the DevTools panel
// (via inspectedWindow.eval polling of $0) — the worker only proxies HTTP
// requests to the server and owns settings, so it has no long-lived state and
// is safe to be killed/restarted by Chrome at any time.

import { getSettings, setSettings } from "./shared/settings.js";
import {
  analyzeChange,
  applyChange,
  checkHealth,
  postStyleChange,
  previewChange,
} from "./shared/serverClient.js";
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
    case "SEND_STYLE_CHANGE": {
      const settings = await getSettings();
      try {
        const result = await postStyleChange(settings.serverUrl, {
          file: message.change.file,
          selector: message.change.selector,
          property: message.change.property,
          value: message.change.value,
          className: message.change.className,
        });
        return ok({ success: true, serverId: result.change.id });
      } catch (e) {
        return ok({ success: false, error: (e as Error).message });
      }
    }
    case "ANALYZE_CHANGE": {
      const settings = await getSettings();
      try {
        const result = await analyzeChange(settings.serverUrl, {
          file: message.change.file,
          selector: message.change.selector,
          property: message.change.property,
          value: message.change.value,
          className: message.change.className,
          mode: message.mode,
        });
        return ok(result);
      } catch (e) {
        return ok({ success: false, error: (e as Error).message });
      }
    }
    case "PREVIEW_CHANGE": {
      const settings = await getSettings();
      try {
        const result = await previewChange(settings.serverUrl, {
          file: message.file,
          replace: message.replace,
          with: message.with,
        });
        return ok(result);
      } catch (e) {
        return ok({ success: false, error: (e as Error).message });
      }
    }
    case "APPLY_CHANGE": {
      const settings = await getSettings();
      try {
        const result = await applyChange(settings.serverUrl, {
          file: message.file,
          replace: message.replace,
          with: message.with,
        });
        return ok(result);
      } catch (e) {
        return ok({ success: false, error: (e as Error).message });
      }
    }
    default: {
      const exhaustive: never = message;
      return err(`Unknown message: ${JSON.stringify(exhaustive)}`);
    }
  }
}

chrome.runtime.onMessage.addListener(
  (message: RequestMessage, _sender, sendResponse) => {
    handleMessage(message)
      .then(sendResponse)
      .catch((e: unknown) => sendResponse(err((e as Error).message)));
    return true; // keep the channel open for the async response
  },
);

chrome.runtime.onInstalled.addListener(() => {
  void setSettings({});
});
