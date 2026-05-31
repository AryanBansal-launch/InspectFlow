// InspectFlow DevTools panel logic.
//
// Phase 2: render the panel shell, report server connectivity, and show which
// tab is being inspected. Phases 3–6 populate the "Captured changes" list and
// render the diff/approval UI here.

import { sendMessage } from "./shared/types.js";

const serverDot = document.getElementById("server-dot") as HTMLSpanElement;
const serverText = document.getElementById("server-text") as HTMLSpanElement;
const refreshBtn = document.getElementById("refresh") as HTMLButtonElement;
const inspectedTarget = document.getElementById(
  "inspected-target",
) as HTMLParagraphElement;

/** Queries the background worker for server health and reflects it in the UI. */
async function refreshServerStatus(): Promise<void> {
  serverDot.className = "dot";
  serverText.textContent = "Checking server…";
  serverText.className = "muted";

  const res = await sendMessage({ type: "CHECK_SERVER" });

  if (!res.ok) {
    serverDot.className = "dot err";
    serverText.textContent = `Error: ${res.error}`;
    return;
  }

  if (res.data.reachable && res.data.health) {
    const { health } = res.data;
    serverDot.className = "dot ok";
    serverText.textContent = `Connected · ${health.geminiConfigured ? "Gemini ready" : "Gemini key missing"}`;
    serverText.className = "";
  } else {
    serverDot.className = "dot err";
    serverText.textContent = `Server unreachable${res.data.error ? `: ${res.data.error}` : ""}`;
  }
}

/** Shows the URL of the tab DevTools is currently inspecting. */
function showInspectedTarget(): void {
  chrome.devtools.inspectedWindow.eval(
    "location.href",
    (result: unknown, exception) => {
      if (exception || typeof result !== "string") {
        inspectedTarget.textContent = "Inspecting: (unavailable)";
        return;
      }
      inspectedTarget.textContent = `Inspecting: ${result}`;
    },
  );
}

refreshBtn.addEventListener("click", () => {
  void refreshServerStatus();
});

void refreshServerStatus();
showInspectedTarget();
