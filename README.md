# InspectFlow

Edit styles in Chrome DevTools → InspectFlow maps the change to the right
Tailwind class → review a diff → one click writes the source file. Your dev
server's hot reload picks it up instantly, and the change persists on refresh.

```
Chrome DevTools (you edit a style)
        │
        ▼
InspectFlow DevTools panel  ──poll computed style of $0──▶  detects the change
        │
        ▼
Local MCP server  ──┬── deterministic Tailwind map  (instant, no API)   ← "Analyze"
                    └── Gemini AI                    (fallback)          ← "Analyze with AI"
        │
        ▼
Diff preview → Apply → Babel-AST file write → hot reload
```

**Three parts:**

| Part | What it is | Runs where |
| --- | --- | --- |
| `server/` | Local MCP server (Node + Express). Reads/writes your source, exposes MCP tools + an HTTP API. | Host or Docker |
| `extension/` | Chrome MV3 DevTools extension. Captures the style change and drives the flow. | Your browser (load unpacked) |
| `demo/` | A Next.js + Tailwind app to try it on. | Host or Docker |

> The extension **cannot** be containerized — Chrome loads it directly. Docker
> covers the server and the demo; the extension is always a one-time
> "Load unpacked".

---

## Prerequisites

- **Google Chrome** (or any Chromium browser with DevTools).
- **Node.js ≥ 20** — for the local route, and required to build the extension either way.
- **Docker** (optional) — for the containerized server + demo.
- A **Gemini API key** (optional) — only for the "Analyze with AI" button. The
  deterministic "Analyze" button needs no key. Get one at
  https://aistudio.google.com/apikey.

---

## Step 1 — Build & load the Chrome extension (required for both routes)

The extension is never dockerized, so build it first.

```bash
cd extension
npm install
npm run build        # outputs extension/dist
```

Then in Chrome:

1. Open `chrome://extensions`.
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked** → select the `extension/dist` folder.
4. The InspectFlow icon (indigo square) appears in the toolbar.

> Whenever you rebuild the extension, click the **↺ refresh** icon on its
> `chrome://extensions` card, then fully close & reopen DevTools.

---

## Step 2 — Start the server + demo

Pick **one** route.

### Route A — Docker (one command)

```bash
cp .env.example .env        # optional: add GEMINI_API_KEY for the AI button
docker compose up --build
```

This starts:
- the MCP server on **http://localhost:4399** (sandboxed to `./demo`)
- the demo app on **http://localhost:3000**

### Route B — Local (Node, two terminals)

```bash
# Terminal 1 — MCP server (pointed at the demo)
cd server
npm install
cp .env.example .env                       # optional: add GEMINI_API_KEY
echo "PROJECT_ROOT=$(pwd)/../demo" >> .env  # the project it may edit
npm run build && npm start                 # http://localhost:4399

# Terminal 2 — demo app
cd demo
npm install
npm run dev                                # http://localhost:3000
```

Verify the server is up:

```bash
curl http://localhost:4399/health
# { "status": "ok", "projectRoot": ".../demo", "geminiConfigured": true|false, ... }
```

---

## Step 3 — Connect the extension

1. Click the **InspectFlow toolbar icon**.
2. Confirm the server URL is `http://127.0.0.1:4399`, click **Test** →
   you should see **Connected** (green = Gemini ready, amber = no key, which is
   fine — the local Analyze still works).

---

## Step 4 — The edit loop

1. Open **http://localhost:3000** in Chrome.
2. Open **DevTools** (`F12` / `⌘⌥I`) → click the **InspectFlow** tab.
3. Click **Start Capture** (button turns red).
4. In the **Elements** panel, **click an element** (e.g. a card or heading).
5. In the **Styles** panel, change a value — e.g. `padding: 16px` → `32px` —
   and press **Enter**.
6. Within ~½ second a **change card** appears in the InspectFlow panel
   (`✓ Sent to server`).
7. Click **Analyze** — the server finds the source file by the element's
   className and maps the change to a Tailwind class swap **instantly** (no API).
   - For anything the deterministic mapper can't handle (e.g. `box-shadow`),
     click **Analyze with AI** instead (needs a Gemini key + quota).
8. A **contextual diff** appears, e.g.:

   ```diff
   src/components/CardShowcase.tsx:3 · local
   - <div className="... p-6 ...">
   + <div className="... p-8 ...">
   ```

9. Click **Apply** → the file is written via Babel AST.
10. Your dev server hot-reloads → the page updates → **refresh confirms it persists.**

---

## Using InspectFlow on your own project

Nothing to add to your app — no annotations, no SDK. The server discovers the
right file by searching your project for the element's `className`.

**Docker:** edit `docker-compose.yml`, point the `server` volume at your project,
and run only the server:

```yaml
services:
  server:
    volumes:
      - /abs/path/to/your/project:/project
```
```bash
docker compose up server          # then run your own dev server on the host
```

**Local:** set `PROJECT_ROOT` to your project's absolute path in `server/.env`
and restart the server. Run your project's dev server as usual.

Supported: React, Next.js (App Router), Tailwind CSS, plain CSS/CSS Modules.

---

## How "Analyze" works (local vs AI)

| Button | Engine | Speed | Needs key | Handles |
| --- | --- | --- | --- | --- |
| **Analyze** | Deterministic Tailwind map | Instant | No | padding, margin, gap, width/height, font-size, font-weight, border-radius, colors (incl. off-scale → `p-[17px]`, rgb → `text-[#0000ff]`) |
| **Analyze with AI** | Gemini | ~2–10 s | Yes | Anything else / ambiguous cases |

The free Gemini tier is ~20 requests/day — if you hit a quota error, just use the
deterministic **Analyze** button, which covers the common edits with no API at all.

---

## MCP tools (for AI clients like Claude)

Point an MCP client at `http://127.0.0.1:4399/mcp`:

| Tool | Purpose |
| --- | --- |
| `list_recent_changes` | Recent captured DevTools changes |
| `analyze_style_change` | Map a CSS change → source edit (local map, or Gemini) |
| `preview_change` | Unified diff for a proposed edit |
| `apply_change` | Write an approved edit via Babel AST |

```jsonc
// .claude/settings.json
{ "mcpServers": { "inspectflow": { "type": "http", "url": "http://127.0.0.1:4399/mcp" } } }
```

---

## Environment variables (server)

| Variable | Default | Notes |
| --- | --- | --- |
| `GEMINI_API_KEY` | — | Only for "Analyze with AI". |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Any model your key can access. |
| `PORT` | `4399` | HTTP port. |
| `HOST` | `127.0.0.1` | Use `0.0.0.0` in Docker (compose sets this). |
| `PROJECT_ROOT` | `cwd` | Absolute path; all reads/writes are sandboxed here. |
| `LOG_LEVEL` | `info` | `trace`…`error`. |
| `LOG_PRETTY` | `true` | `false` for JSON logs. |
| `CORS_ORIGINS` | `*` | Comma-separated or `*`. |

---

## Tests

```bash
cd e2e
npm install
npx playwright install chromium
npx playwright test               # detection core + full server pipeline
```

The suite auto-starts the server (against the demo) and the demo app, exercises
preview/apply + hot reload, then restores the demo file.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Nothing appears on a style change | Make sure you **selected an element** first and pressed **Enter** to commit the edit. Capture follows the selected element (`$0`). |
| "Server unreachable" in the panel | Server not running, or wrong URL in the popup. Check `curl localhost:4399/health`. |
| "No deterministic mapping" | Click **Analyze with AI**, or the property isn't a simple Tailwind utility. |
| "Gemini quota exceeded" | Use the deterministic **Analyze** button, or wait for the daily quota to reset. |
| "No source file found" | The element's `className` must be a **static string** in source (not built with `cn()`/`clsx()` runtime concatenation). |
| "Extension context invalidated" | You reloaded the extension while DevTools was open — fully close and reopen DevTools. |
| Page doesn't hot-reload after Apply | Confirm your dev server is running and watching the same files (`WATCHPACK_POLLING=true` is set for the dockerized demo). |

---

## Project structure

```
InspectFlow/
├── docker-compose.yml      server + demo for a one-command tryout
├── .env.example            GEMINI_API_KEY for compose
├── server/                 MCP server (Node + TS + Express)  [+ Dockerfile]
│   └── src/{config,logger,validation,store,routes,services,analyzers,writers,tools,server}
├── extension/              Chrome MV3 extension (TS + esbuild)
│   └── src/{background,devtools,panel,popup,shared}
├── demo/                   Next.js 15 + Tailwind 4 test app  [+ Dockerfile]
└── e2e/                    Playwright tests (detection + pipeline)
```
