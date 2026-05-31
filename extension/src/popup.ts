// Popup logic: edit the server URL and test connectivity to the MCP server.

import { sendMessage } from "./shared/types.js";

const serverUrlInput = document.getElementById("server-url") as HTMLInputElement;
const saveBtn = document.getElementById("save") as HTMLButtonElement;
const testBtn = document.getElementById("test") as HTMLButtonElement;
const dot = document.getElementById("dot") as HTMLSpanElement;
const statusText = document.getElementById("status-text") as HTMLSpanElement;
const details = document.getElementById("details") as HTMLDivElement;

function setStatus(state: "ok" | "err" | "warn" | "", text: string): void {
  dot.className = `dot ${state}`.trim();
  statusText.textContent = text;
  statusText.className = state === "" ? "muted" : "";
}

/** Loads persisted settings into the form. */
async function loadSettings(): Promise<void> {
  const res = await sendMessage({ type: "GET_SETTINGS" });
  if (res.ok) {
    serverUrlInput.value = res.data.settings.serverUrl;
  }
}

/** Persists the entered server URL. */
async function save(): Promise<void> {
  saveBtn.disabled = true;
  try {
    const res = await sendMessage({
      type: "SET_SETTINGS",
      settings: { serverUrl: serverUrlInput.value.trim() },
    });
    if (res.ok) {
      serverUrlInput.value = res.data.settings.serverUrl;
      setStatus("", "Saved");
    } else {
      setStatus("err", res.error);
    }
  } finally {
    saveBtn.disabled = false;
  }
}

/** Tests connectivity to the configured server and shows a summary. */
async function test(): Promise<void> {
  testBtn.disabled = true;
  details.hidden = true;
  setStatus("", "Checking…");
  try {
    const res = await sendMessage({ type: "CHECK_SERVER" });
    if (!res.ok) {
      setStatus("err", res.error);
      return;
    }
    if (res.data.reachable && res.data.health) {
      const h = res.data.health;
      setStatus(h.geminiConfigured ? "ok" : "warn", "Connected");
      details.hidden = false;
      details.innerHTML = "";
      const lines: [string, string][] = [
        ["Service", h.service],
        ["Project root", h.projectRoot],
        ["Gemini", h.geminiConfigured ? `ready (${h.geminiModel})` : "API key missing"],
        ["Captured", String(h.capturedChanges)],
      ];
      for (const [k, v] of lines) {
        const row = document.createElement("div");
        row.className = "row";
        row.style.margin = "2px 0";
        const key = document.createElement("span");
        key.className = "muted";
        key.textContent = `${k}:`;
        const val = document.createElement("span");
        val.style.marginLeft = "auto";
        val.style.fontFamily = "var(--mono)";
        val.textContent = v;
        row.append(key, val);
        details.appendChild(row);
      }
    } else {
      setStatus("err", res.data.error ?? "Unreachable");
    }
  } finally {
    testBtn.disabled = false;
  }
}

saveBtn.addEventListener("click", () => void save());
testBtn.addEventListener("click", () => void test());
serverUrlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") void save();
});

void loadSettings().then(() => void test());
