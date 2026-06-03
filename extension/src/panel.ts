// InspectFlow DevTools panel.
//
// Detection strategy (v2): poll the computed style of the currently-selected
// element ($0) via chrome.devtools.inspectedWindow.eval and diff it. This works
// regardless of how DevTools applies a style edit (inline, rule edit, external
// sheet) and needs NO debugger — so there's no "Chrome is being debugged"
// banner and no service-worker lifecycle issues.
//
// Flow: Start Capture → poll $0 every 400ms → detect changed properties →
// send to server → Analyze (Gemini) → diff preview → Apply (writes file).

import { sendMessage } from "./shared/types.js";
import type {
  CapturedChange,
  MessageResponse,
  MessageResponseMap,
  RequestMessage,
} from "./shared/types.js";

/** Wraps sendMessage and catches "extension reloaded" errors. */
async function safeSend<T extends RequestMessage["type"]>(
  message: Extract<RequestMessage, { type: T }>,
): Promise<MessageResponse<MessageResponseMap[T]>> {
  try {
    return await sendMessage(message);
  } catch (e) {
    if ((e as Error).message?.includes("Extension context invalidated")) {
      showReloadBanner();
    }
    throw e;
  }
}

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

let captureActive = false;
let geminiConfigured = false;
const changes: CapturedChange[] = [];
let changeCounter = 0;

type SendStatus =
  | { state: "sending" }
  | { state: "sent"; serverId: string }
  | { state: "failed"; error: string };

type AnalysisState =
  | { state: "idle" }
  | { state: "analyzing"; mode: "local" | "ai" }
  | { state: "done"; file: string; suggestion: { replace: string; with: string; reason?: string }; contextDiff: string; lineNumber: number; source?: "local" | "ai" }
  | { state: "error"; error: string; canUseAi: boolean };

type ApplyState =
  | { state: "idle" }
  | { state: "applying" }
  | { state: "applied"; lineNumber: number }
  | { state: "failed"; error: string };

const sendStatuses = new Map<string, SendStatus>();
const analysisStates = new Map<string, AnalysisState>();
const applyStates = new Map<string, ApplyState>();

// ---------------------------------------------------------------------------
// Computed-style detection
// ---------------------------------------------------------------------------

/** Properties we watch on the selected element. Shorthands where Chrome resolves them. */
const TRACKED_PROPS = [
  "padding", "margin", "border-radius", "border-width", "border-color",
  "color", "background-color",
  "font-size", "font-weight", "line-height", "letter-spacing", "text-align", "text-transform",
  "width", "height", "min-width", "max-width", "min-height", "max-height",
  "gap", "row-gap", "column-gap",
  "opacity", "box-shadow",
  "display", "flex-direction", "align-items", "justify-content",
  "position", "top", "right", "bottom", "left", "z-index",
];

interface ElementSnapshot {
  id: string;
  tag: string;
  className: string;
  file: string;
  props: Record<string, string>;
}

/** Expression evaluated in the page context against the selected element ($0). */
const SNAPSHOT_EXPR = `(function(){
  var el = $0;
  if (!el || el.nodeType !== 1) return null;
  if (!el.__inspectflowId) {
    el.__inspectflowId = 'if-' + Date.now().toString(36) + Math.floor(Math.random()*1e6).toString(36);
  }
  var cs = window.getComputedStyle(el);
  var PROPS = ${JSON.stringify(TRACKED_PROPS)};
  var props = {};
  for (var i = 0; i < PROPS.length; i++) {
    props[PROPS[i]] = cs.getPropertyValue(PROPS[i]);
  }
  var cls = el.getAttribute ? (el.getAttribute('class') || '') : '';
  return JSON.stringify({
    id: el.__inspectflowId,
    tag: el.tagName ? el.tagName.toLowerCase() : '',
    className: cls,
    file: (el.dataset && el.dataset.sourceFile) ? el.dataset.sourceFile : '',
    props: props
  });
})()`;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let baseline: ElementSnapshot | null = null; // reference values to diff against
let lastSnap: ElementSnapshot | null = null; // previous poll (for stability gate)

function snapshotSelectedElement(): Promise<ElementSnapshot | null> {
  return new Promise((resolve) => {
    chrome.devtools.inspectedWindow.eval(SNAPSHOT_EXPR, (result: unknown, ex) => {
      if (ex || typeof result !== "string") {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(result) as ElementSnapshot);
      } catch {
        resolve(null);
      }
    });
  });
}

async function pollOnce(): Promise<void> {
  const snap = await snapshotSelectedElement();

  if (!snap) {
    // No element selected — reset so the next selection establishes a fresh baseline.
    baseline = null;
    lastSnap = null;
    return;
  }

  // New element selected → establish baseline, do not report.
  if (!baseline || baseline.id !== snap.id) {
    baseline = snap;
    lastSnap = snap;
    return;
  }

  // Stability gate: a property must hold the same value across two consecutive
  // polls (filters out mid-transition frames) AND differ from the baseline.
  const confirmed: { property: string; value: string }[] = [];
  for (const prop of TRACKED_PROPS) {
    const curr = snap.props[prop] ?? "";
    const prev = lastSnap?.props[prop] ?? "";
    const base = baseline.props[prop] ?? "";
    if (curr === prev && curr !== base) {
      confirmed.push({ property: prop, value: curr });
      baseline.props[prop] = curr; // don't re-report this value
    }
  }

  lastSnap = snap;

  for (const change of confirmed) {
    recordChange({
      selector: snap.className ? `${snap.tag}.${snap.className.split(/\s+/)[0]}` : snap.tag,
      property: change.property,
      value: change.value,
      className: snap.className,
      file: snap.file,
    });
  }
}

interface DetectedChange {
  selector: string;
  property: string;
  value: string;
  className: string;
  file: string;
}

function recordChange(info: DetectedChange): void {
  const change: CapturedChange = {
    id: `change-${++changeCounter}`,
    capturedAt: new Date().toISOString(),
    selector: info.selector,
    property: info.property,
    value: info.value,
    ...(info.file ? { file: info.file } : {}),
    ...(info.className ? { className: info.className } : {}),
  };
  changes.unshift(change);
  analysisStates.set(change.id, { state: "idle" });
  applyStates.set(change.id, { state: "idle" });
  renderChanges();
  sendToServer(change);
}

function sendToServer(change: CapturedChange): void {
  sendStatuses.set(change.id, { state: "sending" });
  updateCardSendStatus(change.id);

  safeSend({ type: "SEND_STYLE_CHANGE", change })
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

async function analyzeChange(change: CapturedChange, mode: "local" | "ai"): Promise<void> {
  analysisStates.set(change.id, { state: "analyzing", mode });
  updateCardAnalysis(change.id, change);

  const analyzeRes = await safeSend({ type: "ANALYZE_CHANGE", change, mode });
  if (!analyzeRes.ok || !analyzeRes.data.success || !analyzeRes.data.suggestion) {
    const err = analyzeRes.ok ? (analyzeRes.data.error ?? "Analysis failed") : analyzeRes.error;
    const canUseAi = analyzeRes.ok ? Boolean(analyzeRes.data.canUseAi) : false;
    analysisStates.set(change.id, { state: "error", error: err, canUseAi });
    updateCardAnalysis(change.id, change);
    return;
  }

  const { suggestion, file: resolvedFile, source } = analyzeRes.data;
  const effectiveFile = resolvedFile ?? change.file ?? "";

  let contextDiff = `- ${suggestion.replace}\n+ ${suggestion.with}`;
  let lineNumber = -1;

  if (effectiveFile) {
    const previewRes = await safeSend({
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
    source,
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

  const res = await safeSend({
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
  if (captureActive) stopCapture();
  else startCapture();
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

function startCapture(): void {
  captureActive = true;
  baseline = null;
  lastSnap = null;
  setCaptureActive(true);
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => void pollOnce(), 400);
}

function stopCapture(): void {
  captureActive = false;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  setCaptureActive(false);
}

function setCaptureActive(active: boolean): void {
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
  try {
    const res = await safeSend({ type: "CHECK_SERVER" });
    if (!res.ok || !res.data.reachable) {
      serverDotEl.className = "dot err";
      serverTextEl.textContent = "Server unreachable";
      return;
    }
    const h = res.data.health!;
    geminiConfigured = h.geminiConfigured ?? false;
    serverDotEl.className = geminiConfigured ? "dot ok" : "dot warn";
    serverTextEl.textContent = geminiConfigured ? "Gemini ready" : "No Gemini key";
    renderChanges();
  } catch {
    serverDotEl.className = "dot err";
    serverTextEl.textContent = "Server unreachable";
  }
}

function showInspectedTarget(): void {
  chrome.devtools.inspectedWindow.eval("location.href", (result: unknown, ex) => {
    if (ex || typeof result !== "string") return;
    inspectedTargetEl.textContent = `Inspecting: ${result} — select an element, then edit a style.`;
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
      ? "Capture active — select an element in <strong>Elements</strong>, then edit a style value."
      : "Click <strong>Start Capture</strong>, select an element in Elements, then edit a style value.";
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
  renderAnalyzeButtons(actionsEl, change);

  const diffEl = document.createElement("div");
  diffEl.dataset["diffFor"] = change.id;

  const applyAreaEl = document.createElement("div");
  applyAreaEl.dataset["applyFor"] = change.id;

  card.append(header, selector, fileEl, meta, sendStatusEl, actionsEl, diffEl, applyAreaEl);
  return card;
}

// ---------------------------------------------------------------------------
// In-place card updates
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

/** Renders the two analysis buttons: deterministic "Analyze" + "Analyze with AI". */
function renderAnalyzeButtons(container: HTMLElement, change: CapturedChange): void {
  const local = document.createElement("button");
  local.className = "secondary";
  local.textContent = "Analyze";
  local.title = "Deterministic Tailwind mapping — instant, no API";
  local.addEventListener("click", () => void analyzeChange(change, "local"));

  const ai = document.createElement("button");
  ai.className = "secondary";
  ai.textContent = "Analyze with AI";

  if (!geminiConfigured) {
    ai.disabled = true;
    // Wrap in a span so the tooltip is visible even when the button is disabled.
    const aiWrapper = document.createElement("span");
    aiWrapper.style.cssText = "display:inline-block; cursor:help;";
    aiWrapper.title =
      "Gemini API key not configured.\n\n" +
      "To enable AI analysis:\n" +
      "1. Get a free key at aistudio.google.com/apikey\n" +
      "2. Add GEMINI_API_KEY=your-key to server/.env\n" +
      "3. Restart the server (npm run dev inside server/)";
    aiWrapper.appendChild(ai);
    container.append(local, aiWrapper);
  } else {
    ai.title = "Use Gemini for smarter analysis (slower, uses API quota)";
    ai.addEventListener("click", () => void analyzeChange(change, "ai"));
    container.append(local, ai);
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
      renderAnalyzeButtons(actionsEl, change);
      break;
    }
    case "analyzing": {
      const span = document.createElement("span");
      span.className = "muted";
      span.style.fontSize = "11px";
      span.textContent = state.mode === "ai" ? "Analyzing with Gemini…" : "Analyzing…";
      actionsEl.appendChild(span);
      break;
    }
    case "error": {
      const span = document.createElement("span");
      span.style.fontSize = "11px";
      span.style.color = "var(--err)";
      span.style.display = "block";
      span.style.marginBottom = "6px";
      span.textContent = `✗ ${state.error}`;
      diffEl.appendChild(span);
      // Always re-offer both buttons so the user can fall back to AI (or retry).
      renderAnalyzeButtons(actionsEl, change);
      break;
    }
    case "done": {
      diffEl.appendChild(buildDiffBlock(state.contextDiff, state.file, state.lineNumber, state.source));
      buildApplyActions(changeId, actionsEl, change, state.suggestion);
      updateCardApply(changeId);
      break;
    }
  }
}

function buildDiffBlock(
  diffText: string,
  file: string | undefined,
  lineNumber: number,
  source?: "local" | "ai",
): HTMLElement {
  const wrapper = document.createElement("div");

  const label = document.createElement("div");
  label.className = "diff-label";
  const where = file && lineNumber > 0 ? `${file}:${lineNumber}` : "Suggested change";
  const badge = source === "ai" ? " · AI" : source === "local" ? " · local" : "";
  label.textContent = where + badge;
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
  _suggestion: { replace: string; with: string },
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

function showReloadBanner(): void {
  if (document.getElementById("reload-banner")) return;
  const banner = document.createElement("div");
  banner.id = "reload-banner";
  banner.style.cssText =
    "background:var(--err);color:#fff;padding:10px 14px;font-size:12px;text-align:center;position:sticky;top:0;z-index:100";
  banner.textContent =
    "Extension was reloaded — close DevTools completely and reopen it to reconnect.";
  document.body.prepend(banner);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

void refreshServerStatus();
renderChanges();
