// DevTools page entry. Runs when DevTools opens on an inspected tab and
// registers the "InspectFlow" panel. The panel itself (panel.html/panel.ts)
// hosts the UI for reviewing captured changes and approving edits.

chrome.devtools.panels.create(
  "InspectFlow",
  "icons/icon-32.png",
  "panel.html",
  () => {
    // Panel created. Per-panel wiring lives in panel.ts.
  },
);
