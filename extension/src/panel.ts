// InspectFlow DevTools panel.
//
// Phase 3: connect port, start/stop CSS capture, read data-source-file from $0.
// Phase 4: send captured changes to the MCP server.
// Phase 6: Analyze button → Gemini suggestion → contextual diff display.
// Phase 7: Apply/Reject buttons — Apply writes the file via POST /apply.

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

// ---------------------------------------------------------------------------
// Local state
// ---------------------------------------------------------------------------

const tabId = chrome.devtools.inspectedWindow.tabId;
let captureActive = false;
const changes: CapturedChange[] = [];
let changeCounter = 0;

type SendStatus =
  | { state: "sending" }
  | { state: "sent"; serverId: string }
  | { state: "failed"; error: string };

type AnalysisState =
  | { state: "idle" }
  | { state: "analyzing" }
  | { state: "done"; file: string; suggestion: { replace: string; with: string; reason?: string }; contextDiff: string; lineNumber: number }
  | { state: "error"; error: string };

type ApplyState =
  | { state: "idle" }
  | { state: "applying" }
  | { state: "applied"; lineNumber: number }
  | { state: "failed"; error: string };

const sendStatuses = new Map<string, SendStatus>();
const analysisStates = new Map<string, AnalysisState>();
const applyStates = new Map<string, ApplyState>();

// ---------------------------------------------------------------------------
// Port connection to background
// ---------------------------------------------------------------------------

let port = connectPort();

function connectPort(): chrome.runtime.Port {
  const p = chrome.runtime.connect({ name: "inspectflow-panel" });
  p.onMessage.addListener((message: PanelPushMessage) => handlePush(message));
  p.onDisconnect.addListener(() => {
    setTimeout(() => { port = connectPort(); }, 500);
  });
  return p;
}

// ---------------------------------------------------------------------------
// Push message handler
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
// Data-source-file + className enrichment
// ---------------------------------------------------------------------------

interface EvalSourceInfo {
  file: string;
  className: string;
}

function readSourceInfo(): Promise<EvalSourceInfo> {
  return new Promise((resolve) => {
    chrome.devtools.inspectedWindow.eval(
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
        try { resolve(JSON.parse(result) as EvalSourceInfo); }
        catch { resolve({ file: "", className: "" }); }
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
  analysisStates.set(change.id, { state: "idle" });
  applyStates.set(change.id, { state: "idle" });
  renderChanges();
  onChangeCaptured(change);
}

function onChangeCaptured(change: CapturedChange): void {
  sendStatuses.set(change.id, { state: "sending" });
  updateCardSendStatus(change.id);

  sendMessage({ type: "SEND_STYLE_CHANGE", change })
    .then((res) => {
      if (!res.ok) {
        sendStatuses.set(change.id, { state: "failed", error: res.error });
      } else if (res.data.success) {
        sendStatuses.set(change.id, { state: "sent", serverId: res.data.serverId ?? "" });
      } else {
        sendStatuses.set(change.id, { state: "failed", error: res.data.error ?? "Unknown error" });
      }
      updateCardSendStatus(change.id);
    })
    .catch((e: unknown) => {
      sendStatuses.set(change.id, { state: "failed", error: (e as Error).message });
      updateCardSendStatus(change.id);
    });
}

// ---------------------------------------------------------------------------
// Analyze flow
// ---------------------------------------------------------------------------

async function analyzeChange(change: CapturedChange): Promise<void> {
  analysisStates.set(change.id, { state: "analyzing" });
  updateCardAnalysis(change.id, change);

  const analyzeRes = await sendMessage({ type: "ANALYZE_CHANGE", change });
  if (!analyzeRes.ok || !analyzeRes.data.success || !analyzeRes.data.suggestion) {
    const err = analyzeRes.ok ? (analyzeRes.data.error ?? "Analysis failed") : analyzeRes.error;
    analysisStates.set(change.id, { state: "error", error: err });
    updateCardAnalysis(change.id, change);
    return;
  }

  const { suggestion, file: resolvedFile } = analyzeRes.data;
  // Use the server-resolved file (auto-discovered by className when not in the captured change).
  const effectiveFile = resolvedFile ?? change.file ?? "";

  let contextDiff = `- ${suggestion.replace}\n+ ${suggestion.with}`;
  let lineNumber = -1;

  if (effectiveFile) {
    const previewRes = await sendMessage({
      type: "PREVIEW_CHANGE",
      file: effectiveFile,
      replace: suggestion.replace,
      with: suggestion.with,
    });
    if (previewRes.ok && previewRes.data.success) {
      contextDiff = previewRes.data.contextDiff || previewRes.data.diff || contextDiff;
      lineNumber = previewRes.data.lineNumber ?? -1;
    }
  }

  analysisStates.set(change.id, {
    state: "done",
    file: effectiveFile,
    suggestion,
    contextDiff,
    lineNumber,
  });
  updateCardAnalysis(change.id, change);
}

// ---------------------------------------------------------------------------
// Apply flow
// ---------------------------------------------------------------------------

async function applyChange(changeId: string): Promise<void> {
  const analysis = analysisStates.get(changeId);
  if (!analysis || analysis.state !== "done" || !analysis.file) return;

  applyStates.set(changeId, { state: "applying" });
  updateCardApply(changeId);

  const res = await sendMessage({
    type: "APPLY_CHANGE",
    file: analysis.file,
    replace: analysis.suggestion.replace,
    with: analysis.suggestion.with,
  });

  if (!res.ok || !res.data.success) {
    const err = res.ok ? (res.data.error ?? "Apply failed") : res.error;
    applyStates.set(changeId, { state: "failed", error: err });
  } else {
    applyStates.set(changeId, { state: "applied", lineNumber: res.data.lineNumber ?? -1 });
  }
  updateCardApply(changeId);
}

// ---------------------------------------------------------------------------
// Capture controls
// ---------------------------------------------------------------------------

captureBtnEl.addEventListener("click", () => {
  if (captureActive) void stopCapture();
  else void startCapture();
});

clearBtnEl.addEventListener("click", () => {
  changes.length = 0;
  changeCounter = 0;
  sendStatuses.clear();
  analysisStates.clear();
  applyStates.clear();
  renderChanges();
  hideCaptureError();
});

async function startCapture(): Promise<void> {
  captureBtnEl.disabled = true;
  hideCaptureError();
  try {
    const res = await sendMessage({ type: "START_CAPTURE", tabId });
    if (!res.ok) showCaptureError(res.error);
    else if (!res.data.success && res.data.error) showCaptureError(res.data.error);
  } finally { captureBtnEl.disabled = false; }
}

async function stopCapture(): Promise<void> {
  captureBtnEl.disabled = true;
  try { await sendMessage({ type: "STOP_CAPTURE", tabId }); }
  finally { captureBtnEl.disabled = false; }
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
  changeListEl.innerHTML = "";
  if (changes.length === 0) {
    const msg = document.createElement("div");
    msg.className = "empty";
    msg.innerHTML = captureActive
      ? "Capture active — edit a style in the <strong>Elements → Styles</strong> panel."
      : "Click <strong>Start Capture</strong>, then edit a style in the Elements → Styles panel to begin.";
    changeListEl.appendChild(msg);
    return;
  }
  for (const change of changes) changeListEl.appendChild(buildChangeCard(change));
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
  fileEl.className = "change-file";
  // File is either known from capture or will be auto-discovered by the server on Analyze.
  fileEl.textContent = change.file ?? "file auto-discovered on Analyze";

  const meta = document.createElement("div");
  meta.className = "change-meta";
  meta.textContent = new Date(change.capturedAt).toLocaleTimeString();
  if (change.className) {
    meta.textContent += ` · class="${change.className.slice(0, 60)}${change.className.length > 60 ? "…" : ""}"`;
  }

  const sendStatusEl = document.createElement("div");
  sendStatusEl.className = "send-status";
  sendStatusEl.dataset["statusFor"] = change.id;

  const actionsEl = document.createElement("div");
  actionsEl.className = "card-actions";
  actionsEl.dataset["actionsFor"] = change.id;

  const analyzeBtn = document.createElement("button");
  analyzeBtn.className = "secondary";
  analyzeBtn.textContent = "Analyze →";
  analyzeBtn.addEventListener("click", () => void analyzeChange(change));
  actionsEl.appendChild(analyzeBtn);

  const diffEl = document.createElement("div");
  diffEl.dataset["diffFor"] = change.id;

  const applyAreaEl = document.createElement("div");
  applyAreaEl.dataset["applyFor"] = change.id;

  card.append(header, selector, fileEl, meta, sendStatusEl, actionsEl, diffEl, applyAreaEl);
  return card;
}

// ---------------------------------------------------------------------------
// In-place card updates (avoids full re-render)
// ---------------------------------------------------------------------------

function updateCardSendStatus(changeId: string): void {
  const el = changeListEl.querySelector<HTMLElement>(`[data-status-for="${changeId}"]`);
  if (!el) return;
  const status = sendStatuses.get(changeId);
  if (!status) { el.textContent = ""; return; }
  switch (status.state) {
    case "sending": el.className = "send-status sending"; el.textContent = "Sending to server…"; break;
    case "sent":    el.className = "send-status sent";    el.textContent = "✓ Sent to server"; break;
    case "failed":  el.className = "send-status failed";  el.textContent = `✗ ${status.error}`; el.title = status.error; break;
  }
}

function updateCardAnalysis(changeId: string, change: CapturedChange): void {
  const actionsEl = changeListEl.querySelector<HTMLElement>(`[data-actions-for="${changeId}"]`);
  const diffEl = changeListEl.querySelector<HTMLElement>(`[data-diff-for="${changeId}"]`);
  if (!actionsEl || !diffEl) return;

  const state = analysisStates.get(changeId);
  actionsEl.innerHTML = "";
  diffEl.innerHTML = "";

  switch (state?.state) {
    case "idle":
    case undefined: {
      const btn = document.createElement("button");
      btn.className = "secondary";
      btn.textContent = "Analyze →";
      btn.addEventListener("click", () => void analyzeChange(change));
      actionsEl.appendChild(btn);
      break;
    }
    case "analyzing": {
      const span = document.createElement("span");
      span.className = "muted";
      span.style.fontSize = "11px";
      span.textContent = "Analyzing with Gemini…";
      actionsEl.appendChild(span);
      break;
    }
    case "error": {
      const span = document.createElement("span");
      span.style.fontSize = "11px";
      span.style.color = "var(--err)";
      span.textContent = `✗ ${state.error}`;
      const retry = document.createElement("button");
      retry.className = "secondary";
      retry.textContent = "Retry";
      retry.style.marginLeft = "6px";
      retry.addEventListener("click", () => void analyzeChange(change));
      actionsEl.append(span, retry);
      break;
    }
    case "done": {
      diffEl.appendChild(buildDiffBlock(state.contextDiff, state.file, state.lineNumber));
      buildApplyActions(changeId, actionsEl, change, state.suggestion);
      updateCardApply(changeId);
      break;
    }
  }
}

function buildDiffBlock(diffText: string, file: string | undefined, lineNumber: number): HTMLElement {
  const wrapper = document.createElement("div");

  const label = document.createElement("div");
  label.className = "diff-label";
  label.textContent = file && lineNumber > 0
    ? `${file}:${lineNumber}`
    : "Suggested change";
  wrapper.appendChild(label);

  const block = document.createElement("div");
  block.className = "diff-block";
  const pre = document.createElement("pre");

  for (const line of diffText.split("\n")) {
    const span = document.createElement("span");
    if (line.startsWith("-")) span.className = "diff-line-del";
    else if (line.startsWith("+")) span.className = "diff-line-add";
    else if (line.startsWith("@@")) span.className = "diff-line-hdr";
    else span.className = "diff-line-ctx";
    span.textContent = line + "\n";
    pre.appendChild(span);
  }

  block.appendChild(pre);
  wrapper.appendChild(block);
  return wrapper;
}

function buildApplyActions(
  changeId: string,
  container: HTMLElement,
  change: CapturedChange,
  suggestion: { replace: string; with: string },
): void {
  const applyBtn = document.createElement("button");
  applyBtn.textContent = "Apply";
  applyBtn.dataset["applyBtn"] = changeId;
  applyBtn.addEventListener("click", () => void applyChange(changeId));

  const rejectBtn = document.createElement("button");
  rejectBtn.className = "secondary";
  rejectBtn.textContent = "Reject";
  rejectBtn.addEventListener("click", () => {
    analysisStates.set(changeId, { state: "idle" });
    applyStates.set(changeId, { state: "idle" });
    updateCardAnalysis(changeId, change);
  });

  container.append(applyBtn, rejectBtn);
}

function updateCardApply(changeId: string): void {
  const applyAreaEl = changeListEl.querySelector<HTMLElement>(`[data-apply-for="${changeId}"]`);
  const applyBtn = changeListEl.querySelector<HTMLButtonElement>(`[data-apply-btn="${changeId}"]`);
  if (!applyAreaEl) return;

  applyAreaEl.innerHTML = "";
  const state = applyStates.get(changeId);

  if (state?.state === "applying") {
    if (applyBtn) applyBtn.disabled = true;
    const span = document.createElement("span");
    span.className = "muted";
    span.style.fontSize = "11px";
    span.textContent = "Writing file…";
    applyAreaEl.appendChild(span);
  } else if (state?.state === "applied") {
    if (applyBtn) applyBtn.disabled = true;
    const span = document.createElement("span");
    span.className = "apply-success";
    span.textContent = `✓ Applied${state.lineNumber > 0 ? ` (line ${state.lineNumber})` : ""}. Hot reload will reflect the change.`;
    applyAreaEl.appendChild(span);
  } else if (state?.state === "failed") {
    if (applyBtn) applyBtn.disabled = false;
    const span = document.createElement("span");
    span.style.fontSize = "11px";
    span.style.color = "var(--err)";
    span.textContent = `✗ ${state.error}`;
    applyAreaEl.appendChild(span);
  }
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
