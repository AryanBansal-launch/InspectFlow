// InspectFlow DevTools panel.
//
// Phase 3 responsibilities:
//   - Connect a persistent port to the background worker for push events.
//   - Start / stop the CSS capture session via the background.
//   - When a CSS change is detected, read `data-source-file` and `className`
//     from the currently selected element ($0) via inspectedWindow.eval.
//   - Render each captured change as a card.
//
// Phase 4 hook: `onChangeCaptured` is called after $0 enrichment — Phase 4
// sends the change to the MCP server from there.

import { sendMessage } from "./shared/types.js";
import type { CapturedChange, PanelPushMessage, RawCssChange } from "./shared/types.js";

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const captureBtnEl = document.getElementById("capture-btn") as HTMLButtonElement;
const clearBtnEl = document.getElementById("clear-btn") as HTMLButtonElement;
const serverDotEl = document.getElementById("server-dot") as HTMLSpanElement;
const serverTextEl = document.getElementById("server-text") as HTMLSpanElement;
const captureErrorEl = document.getElementById("capture-error") as HTMLDivElement;
const captureErrorTextEl = document.getElementById("capture-error-text") as HTMLDivElement;
const targetRowEl = document.getElementById("target-row") as HTMLDivElement;
const inspectedTargetEl = document.getElementById("inspected-target") as HTMLSpanElement;
const changeListEl = document.getElementById("change-list") as HTMLDivElement;
const emptyMsgEl = document.getElementById("empty-msg") as HTMLDivElement;

// ---------------------------------------------------------------------------
// Local state
// ---------------------------------------------------------------------------

const tabId = chrome.devtools.inspectedWindow.tabId;
let captureActive = false;
const changes: CapturedChange[] = [];
let changeCounter = 0;

// ---------------------------------------------------------------------------
// Port connection to background
// ---------------------------------------------------------------------------

let port = connectPort();

function connectPort(): chrome.runtime.Port {
  const p = chrome.runtime.connect({ name: "inspectflow-panel" });
  p.onMessage.addListener((message: PanelPushMessage) => handlePush(message));
  p.onDisconnect.addListener(() => {
    // Service worker restarted — reconnect after a short delay.
    setTimeout(() => {
      port = connectPort();
    }, 500);
  });
  return p;
}

// ---------------------------------------------------------------------------
// Push message handler (background → panel)
// ---------------------------------------------------------------------------

function handlePush(message: PanelPushMessage): void {
  switch (message.type) {
    case "CAPTURE_STARTED":
      setCaptureActive(true);
      hideCaptureError();
      break;

    case "CAPTURE_STOPPED":
      setCaptureActive(false);
      break;

    case "CAPTURE_ERROR":
      setCaptureActive(false);
      showCaptureError(message.error);
      break;

    case "CSS_CHANGE_DETECTED":
      void enrichAndRecord(message.rawChange);
      break;
  }
}

// ---------------------------------------------------------------------------
// Data-source-file + className enrichment via inspectedWindow.eval
// ---------------------------------------------------------------------------

interface EvalSourceInfo {
  file: string;
  className: string;
}

function readSourceInfo(): Promise<EvalSourceInfo> {
  return new Promise((resolve) => {
    chrome.devtools.inspectedWindow.eval(
      // $0 is the currently selected element in the Elements panel.
      `(function(){
         var el = $0;
         return JSON.stringify({
           file: el && el.dataset && el.dataset.sourceFile ? el.dataset.sourceFile : "",
           className: el && typeof el.className === "string" ? el.className : ""
         });
       })()`,
      (result: unknown, exception) => {
        if (exception || typeof result !== "string") {
          resolve({ file: "", className: "" });
          return;
        }
        try {
          resolve(JSON.parse(result) as EvalSourceInfo);
        } catch {
          resolve({ file: "", className: "" });
        }
      },
    );
  });
}

async function enrichAndRecord(rawChange: RawCssChange): Promise<void> {
  const sourceInfo = await readSourceInfo();

  const change: CapturedChange = {
    id: `change-${++changeCounter}`,
    capturedAt: new Date().toISOString(),
    ...rawChange,
    ...(sourceInfo.file ? { file: sourceInfo.file } : {}),
    ...(sourceInfo.className ? { className: sourceInfo.className } : {}),
  };

  changes.unshift(change);
  renderChanges();

  // Phase 4 hook: send to MCP server.
  onChangeCaptured(change);
}

/**
 * Called after every captured change is enriched with source info.
 * Phase 4 extends this to POST the change to the MCP server.
 */
function onChangeCaptured(_change: CapturedChange): void {
  // Intentionally empty in Phase 3 — Phase 4 sends to server here.
}

// ---------------------------------------------------------------------------
// Capture controls
// ---------------------------------------------------------------------------

captureBtnEl.addEventListener("click", () => {
  if (captureActive) {
    void stopCapture();
  } else {
    void startCapture();
  }
});

clearBtnEl.addEventListener("click", () => {
  changes.length = 0;
  changeCounter = 0;
  renderChanges();
  hideCaptureError();
});

async function startCapture(): Promise<void> {
  captureBtnEl.disabled = true;
  hideCaptureError();
  try {
    const res = await sendMessage({ type: "START_CAPTURE", tabId });
    if (!res.ok) {
      showCaptureError(res.error);
    } else if (!res.data.success && res.data.error) {
      showCaptureError(res.data.error);
    }
    // CAPTURE_STARTED push message sets the button state.
  } finally {
    captureBtnEl.disabled = false;
  }
}

async function stopCapture(): Promise<void> {
  captureBtnEl.disabled = true;
  try {
    await sendMessage({ type: "STOP_CAPTURE", tabId });
    // CAPTURE_STOPPED push message sets the button state.
  } finally {
    captureBtnEl.disabled = false;
  }
}

function setCaptureActive(active: boolean): void {
  captureActive = active;
  if (active) {
    captureBtnEl.textContent = "Stop Capture";
    captureBtnEl.classList.add("active");
    showInspectedTarget();
    targetRowEl.style.display = "";
  } else {
    captureBtnEl.textContent = "Start Capture";
    captureBtnEl.classList.remove("active");
    targetRowEl.style.display = "none";
  }
}

// ---------------------------------------------------------------------------
// Server status
// ---------------------------------------------------------------------------

async function refreshServerStatus(): Promise<void> {
  serverDotEl.className = "dot";
  serverTextEl.textContent = "…";
  const res = await sendMessage({ type: "CHECK_SERVER" });
  if (!res.ok || !res.data.reachable) {
    serverDotEl.className = "dot err";
    serverTextEl.textContent = "Server unreachable";
    return;
  }
  const h = res.data.health!;
  serverDotEl.className = h.geminiConfigured ? "dot ok" : "dot warn";
  serverTextEl.textContent = h.geminiConfigured ? "Gemini ready" : "No Gemini key";
}

// ---------------------------------------------------------------------------
// Inspected target
// ---------------------------------------------------------------------------

function showInspectedTarget(): void {
  chrome.devtools.inspectedWindow.eval("location.href", (result: unknown, ex) => {
    if (ex || typeof result !== "string") return;
    inspectedTargetEl.textContent = `Inspecting: ${result}`;
  });
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderChanges(): void {
  // Clear everything except empty message placeholder (re-create it).
  changeListEl.innerHTML = "";

  if (changes.length === 0) {
    const msg = document.createElement("div");
    msg.className = "empty";
    msg.id = "empty-msg";
    if (captureActive) {
      msg.innerHTML =
        "Capture active — edit a style in the <strong>Elements → Styles</strong> panel.";
    } else {
      msg.innerHTML =
        "Click <strong>Start Capture</strong>, then edit a style in the Elements → Styles panel to begin.";
    }
    changeListEl.appendChild(msg);
    return;
  }

  for (const change of changes) {
    changeListEl.appendChild(buildChangeCard(change));
  }
}

function buildChangeCard(change: CapturedChange): HTMLElement {
  const card = document.createElement("div");
  card.className = "change-card";
  card.dataset["changeId"] = change.id;

  const header = document.createElement("div");
  header.className = "change-header";

  const prop = document.createElement("span");
  prop.className = "change-property";
  prop.textContent = change.property + ":";

  const val = document.createElement("span");
  val.className = "change-value";
  val.textContent = change.value;

  header.append(prop, val);

  const selector = document.createElement("div");
  selector.className = "change-selector";
  selector.textContent = change.selector;

  const fileEl = document.createElement("div");
  if (change.file) {
    fileEl.className = "change-file";
    fileEl.textContent = change.file;
  } else {
    fileEl.className = "change-file missing";
    fileEl.innerHTML =
      '<span class="badge-nofile">no data-source-file</span> Add the SourceMapper helper to your component.';
  }

  const meta = document.createElement("div");
  meta.className = "change-meta";
  meta.textContent = new Date(change.capturedAt).toLocaleTimeString();
  if (change.className) {
    meta.textContent += ` · class="${change.className.slice(0, 60)}${change.className.length > 60 ? "…" : ""}"`;
  }

  card.append(header, selector, fileEl, meta);
  return card;
}

// ---------------------------------------------------------------------------
// Error display
// ---------------------------------------------------------------------------

function showCaptureError(message: string): void {
  captureErrorTextEl.textContent = message;
  captureErrorEl.style.display = "";
}

function hideCaptureError(): void {
  captureErrorEl.style.display = "none";
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

void refreshServerStatus();
renderChanges();
