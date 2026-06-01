// Background service worker: central message hub and CSS capture engine.
//
// Phase 2: settings, server health checks.
// Phase 3: attach the Chrome Debugger Protocol to the inspected tab, enable
//   the CSS domain, track stylesheet snapshots, and push CssChange events to
//   the DevTools panel via a persistent port.
// Phase 4: sends captured changes to the MCP server (extends onChangeCaptured).

import { diffStylesheets } from "./shared/cssParser.js";
import { getSettings, setSettings } from "./shared/settings.js";
import {
  analyzeChange,
  applyChange,
  checkHealth,
  postStyleChange,
  previewChange,
} from "./shared/serverClient.js";
import type {
  CaptureState,
  ErrResponse,
  MessageResponse,
  MessageResponseMap,
  OkResponse,
  PanelPushMessage,
  RawCssChange,
  RequestMessage,
} from "./shared/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok<T>(data: T): OkResponse<T> {
  return { ok: true, data };
}

function err(message: string): ErrResponse {
  return { ok: false, error: message };
}

// ---------------------------------------------------------------------------
// CDP type stubs (subset of Chrome Debugger Protocol we rely on)
// ---------------------------------------------------------------------------

interface CssStyleSheetHeader {
  styleSheetId: string;
  sourceURL: string;
  isInline: boolean;
  isMutable: boolean;
}

interface SheetState {
  text: string;
  header: CssStyleSheetHeader;
}

// ---------------------------------------------------------------------------
// DebuggerCapture
// ---------------------------------------------------------------------------

class DebuggerCapture {
  private tabId: number | null = null;
  private sheets = new Map<string, SheetState>();
  private ports = new Set<chrome.runtime.Port>();

  /** Registers a panel port for push messages. */
  registerPort(port: chrome.runtime.Port): void {
    this.ports.add(port);
    port.onDisconnect.addListener(() => this.ports.delete(port));
    // Immediately tell the panel the current capture state.
    this.pushTo(port, {
      type: this.tabId !== null ? "CAPTURE_STARTED" : "CAPTURE_STOPPED",
      ...(this.tabId !== null ? { tabId: this.tabId } : {}),
    } as PanelPushMessage);
  }

  getTabId(): number | null {
    return this.tabId;
  }

  getState(): CaptureState {
    return { active: this.tabId !== null, tabId: this.tabId };
  }

  /** Attaches the debugger to `tabId` and enables the CSS domain. */
  async start(tabId: number): Promise<void> {
    if (this.tabId !== null) await this.stop(this.tabId);
    this.sheets.clear();

    try {
      await chrome.debugger.attach({ tabId }, "1.3");
    } catch (e) {
      throw new Error(
        `Could not attach debugger: ${(e as Error).message}. ` +
          "Close Chrome DevTools on this tab and try again.",
      );
    }

    this.tabId = tabId;

    try {
      await chrome.debugger.sendCommand({ tabId }, "CSS.enable");
    } catch (e) {
      await this.detachSilently(tabId);
      this.tabId = null;
      throw new Error(`Failed to enable CSS domain: ${(e as Error).message}`);
    }

    this.broadcast({ type: "CAPTURE_STARTED", tabId });
  }

  /** Detaches the debugger and resets state. */
  async stop(tabId: number): Promise<void> {
    if (this.tabId !== tabId) return;
    this.tabId = null;
    this.sheets.clear();
    await this.detachSilently(tabId);
    this.broadcast({ type: "CAPTURE_STOPPED" });
  }

  /** Called when Chrome force-detaches our debugger (e.g. DevTools opens). */
  handleForcedDetach(reason: string): void {
    this.tabId = null;
    this.sheets.clear();
    this.broadcast({
      type: "CAPTURE_ERROR",
      error: `Debugger detached: ${reason}. Re-attach capture.`,
    });
  }

  /** Handles a CDP event from the attached tab. */
  async handleEvent(
    tabId: number,
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    if (tabId !== this.tabId) return;

    if (method === "CSS.styleSheetAdded") {
      const header = params["header"] as CssStyleSheetHeader | undefined;
      if (!header) return;
      try {
        const result = (await chrome.debugger.sendCommand(
          { tabId },
          "CSS.getStyleSheetText",
          { styleSheetId: header.styleSheetId },
        )) as { text: string } | undefined;
        this.sheets.set(header.styleSheetId, {
          text: result?.text ?? "",
          header,
        });
      } catch {
        this.sheets.set(header.styleSheetId, { text: "", header });
      }
      return;
    }

    if (method === "CSS.styleSheetChanged") {
      const styleSheetId = params["styleSheetId"] as string | undefined;
      if (!styleSheetId) return;
      await this.processSheetChange(tabId, styleSheetId);
      return;
    }

    if (method === "CSS.styleSheetRemoved") {
      const styleSheetId = params["styleSheetId"] as string | undefined;
      if (styleSheetId) this.sheets.delete(styleSheetId);
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async processSheetChange(
    tabId: number,
    styleSheetId: string,
  ): Promise<void> {
    let newText: string;
    try {
      const result = (await chrome.debugger.sendCommand(
        { tabId },
        "CSS.getStyleSheetText",
        { styleSheetId },
      )) as { text: string } | undefined;
      newText = result?.text ?? "";
    } catch (e) {
      this.broadcast({
        type: "CAPTURE_ERROR",
        error: `getStyleSheetText failed: ${(e as Error).message}`,
      });
      return;
    }

    const oldText = this.sheets.get(styleSheetId)?.text ?? "";
    const existingHeader = this.sheets.get(styleSheetId)?.header;

    // Update snapshot before notifying so a rapid second change diffs correctly.
    this.sheets.set(styleSheetId, {
      text: newText,
      header: existingHeader ?? {
        styleSheetId,
        sourceURL: "",
        isInline: false,
        isMutable: true,
      },
    });

    const changes: RawCssChange[] = diffStylesheets(oldText, newText);
    for (const rawChange of changes) {
      this.broadcast({ type: "CSS_CHANGE_DETECTED", rawChange });
    }
  }

  private broadcast(message: PanelPushMessage): void {
    const dead: chrome.runtime.Port[] = [];
    for (const port of this.ports) {
      try {
        port.postMessage(message);
      } catch {
        dead.push(port);
      }
    }
    for (const port of dead) this.ports.delete(port);
  }

  private pushTo(port: chrome.runtime.Port, message: PanelPushMessage): void {
    try {
      port.postMessage(message);
    } catch {
      this.ports.delete(port);
    }
  }

  private async detachSilently(tabId: number): Promise<void> {
    try {
      await chrome.debugger.detach({ tabId });
    } catch {
      // Tab may be closed or already detached.
    }
  }
}

// ---------------------------------------------------------------------------
// Process-level singleton
// ---------------------------------------------------------------------------

const capture = new DebuggerCapture();

// CDP events — must be registered at top level to survive service-worker restarts.
chrome.debugger.onEvent.addListener(
  (source: chrome.debugger.Debuggee, method: string, params: object | undefined) => {
    if (source.tabId !== undefined) {
      void capture.handleEvent(
        source.tabId,
        method,
        (params as Record<string, unknown>) ?? {},
      );
    }
  },
);

// Forced detach (e.g. Chrome DevTools opens and steals the connection).
chrome.debugger.onDetach.addListener(
  (source: chrome.debugger.Debuggee, reason: string) => {
    if (source.tabId !== undefined && source.tabId === capture.getTabId()) {
      capture.handleForcedDetach(reason);
    }
  },
);

// Panel connects a persistent port for push messages.
chrome.runtime.onConnect.addListener((port: chrome.runtime.Port) => {
  if (port.name === "inspectflow-panel") {
    capture.registerPort(port);
  }
});

// ---------------------------------------------------------------------------
// Request/response message handler
// ---------------------------------------------------------------------------

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
    case "START_CAPTURE": {
      try {
        await capture.start(message.tabId);
        return ok({ success: true });
      } catch (e) {
        return ok({ success: false, error: (e as Error).message });
      }
    }
    case "STOP_CAPTURE": {
      try {
        await capture.stop(message.tabId);
        return ok({ success: true });
      } catch (e) {
        return ok({ success: false, error: (e as Error).message });
      }
    }
    case "GET_CAPTURE_STATE": {
      return ok(capture.getState());
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
          file: message.change.file,       // optional — server auto-discovers if absent
          selector: message.change.selector,
          property: message.change.property,
          value: message.change.value,
          className: message.change.className,
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
    return true;
  },
);

chrome.runtime.onInstalled.addListener(() => {
  void setSettings({});
});
