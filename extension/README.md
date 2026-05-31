# InspectFlow Chrome Extension

Manifest V3 extension that captures CSS changes you make in Chrome DevTools and
forwards them to the local InspectFlow MCP server for approval-gated source edits.

## Build

```bash
cd extension
npm install
npm run build      # outputs ./dist (the unpacked extension)
npm run dev        # rebuild on change (TS graph); re-run build for manifest/HTML edits
```

`npm run build` regenerates icons if missing, bundles each TypeScript entry with
esbuild, and copies the manifest, HTML, CSS, and icons into `dist/`.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select `extension/dist`.
4. Pin the InspectFlow icon (optional). Click it to set the **MCP server URL**
   (default `http://127.0.0.1:4399`) and **Test** the connection.
5. Open DevTools on your app — a new **InspectFlow** panel appears.

## Architecture

| File              | Context             | Role                                                   |
| ----------------- | ------------------- | ------------------------------------------------------ |
| `background.ts`   | Service worker      | Message hub: settings + server health (debugger later) |
| `devtools.ts`     | DevTools page       | Registers the InspectFlow panel                        |
| `panel.ts`        | DevTools panel      | Shows server status, inspected target, captured changes |
| `popup.ts`        | Toolbar popup       | Server URL settings + connection test                  |
| `shared/types.ts` | All contexts        | Typed message protocol + helpers                       |
| `shared/settings.ts` | All contexts     | `chrome.storage.sync` settings                         |
| `shared/serverClient.ts` | All contexts | Typed fetch client for the MCP server HTTP API         |

Messages flow through the background worker over a typed request/response
protocol (`sendMessage`), so the popup and panel never talk to the network
directly — they ask the worker, which owns settings and server access.

## Permissions

- `debugger` — attach the Chrome Debugger Protocol to capture CSS changes (Phase 3).
- `storage` — persist the server URL.
- `tabs` — identify the inspected tab.
- `host_permissions` for `localhost` / `127.0.0.1` — reach the local server.

All hosts are local; the extension makes no external network requests.
