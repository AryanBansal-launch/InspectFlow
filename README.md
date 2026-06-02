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

---

## Quick start

**Prerequisites:** Google Chrome · Node.js ≥ 20

### Step 1 — Load the Chrome extension

1. Download `extension-dist.zip` from the [latest release](../../releases/latest) and unzip it.
2. Open `chrome://extensions` → toggle **Developer mode** on → **Load unpacked** → select the unzipped folder.
3. The InspectFlow icon (indigo square) appears in the toolbar.

### Step 2 — Start the MCP server

Run this inside your project's root directory:

```bash
npx inspectflow-server@latest
```

The server starts on **http://localhost:4399** and uses the current directory as the project root (the directory it searches and writes files in).

Optional — for Gemini AI analysis:

```bash
GEMINI_API_KEY=your_key npx inspectflow-server@latest
```

### Step 3 — Add to your AI client

**Claude Code** — add to `.claude/settings.json` in your project:

```json
{
  "mcpServers": {
    "inspectflow": {
      "type": "http",
      "url": "http://127.0.0.1:4399/mcp"
    }
  }
}
```

**Claude Desktop** — edit `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "inspectflow": {
      "command": "npx",
      "args": ["-y", "inspectflow-server@latest"],
      "env": {
        "PROJECT_ROOT": "/absolute/path/to/your/project"
      }
    }
  }
}
```

> Claude Desktop doesn't run the server from your project directory, so
> `PROJECT_ROOT` must be set explicitly.

### Step 4 — The edit loop

1. Open your app in Chrome, open **DevTools** (`F12` / `⌘⌥I`) → click the **InspectFlow** tab.
2. Confirm the server URL is `http://127.0.0.1:4399`, click **Test** → you should see **Connected**.
3. Click **Start Capture** (button turns red).
4. In **Elements**, click an element. In **Styles**, change a value (e.g. `padding: 16px → 32px`) and press **Enter**.
5. A change card appears in the InspectFlow panel within ~½ second.
6. Click **Analyze** — finds the source file by `className` and maps the CSS change to a Tailwind class swap instantly (no API needed).
   - For properties the local mapper can't handle (e.g. `box-shadow`), use **Analyze with AI** instead (requires a Gemini key).
7. Review the diff, click **Apply** → the file is written via Babel AST → dev server hot-reloads.

---

## Using InspectFlow on your own project

Nothing to add to your app — no annotations, no SDK. The server discovers the
right source file by searching for the element's `className`.

Run `npx inspectflow-server@latest` from your project root and start your dev
server as usual. Supported: React, Next.js (App Router), Tailwind CSS, plain CSS/CSS Modules.

---

## How "Analyze" works (local vs AI)

| Button | Engine | Speed | Needs key | Handles |
| --- | --- | --- | --- | --- |
| **Analyze** | Deterministic Tailwind map | Instant | No | padding, margin, gap, width/height, font-size, font-weight, border-radius, colors (incl. off-scale → `p-[17px]`, rgb → `text-[#0000ff]`) |
| **Analyze with AI** | Gemini | ~2–10 s | Yes | Anything else / ambiguous cases |

The free Gemini tier is ~20 requests/day. If you hit a quota error, fall back to
the deterministic **Analyze** button, which covers the common edits with no API at all.

---

## MCP tools (for AI clients like Claude)

| Tool | Purpose |
| --- | --- |
| `list_recent_changes` | Recent captured DevTools changes |
| `analyze_style_change` | Map a CSS change → source edit (local map, or Gemini) |
| `preview_change` | Unified diff for a proposed edit |
| `apply_change` | Write an approved edit via Babel AST |

---

## Environment variables

| Variable | Default | Notes |
| --- | --- | --- |
| `GEMINI_API_KEY` | — | Only for "Analyze with AI". |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Any model your key can access. |
| `PORT` | `4399` | HTTP port. |
| `HOST` | `127.0.0.1` | Use `0.0.0.0` in Docker. |
| `PROJECT_ROOT` | `cwd` | Absolute path; all reads/writes are sandboxed here. |
| `LOG_LEVEL` | `info` | `trace`…`error`. |
| `LOG_PRETTY` | auto | `true` in a TTY terminal, `false` otherwise (JSON). |
| `CORS_ORIGINS` | `*` | Comma-separated or `*`. |

---

## Self-hosted / Docker

For contributors or if you prefer to run from source.

**Prerequisites:** Docker, Node.js ≥ 20

```bash
git clone https://github.com/your-username/InspectFlow.git
cd InspectFlow
```

### Route A — Docker (server + demo in one command)

```bash
cp .env.example .env        # optional: add GEMINI_API_KEY
docker compose up --build
```

- MCP server → **http://localhost:4399**
- Demo app → **http://localhost:3000**

### Route B — Local (two terminals)

```bash
# Terminal 1 — MCP server pointed at the demo
cd server
npm install
cp .env.example .env
echo "PROJECT_ROOT=$(pwd)/../demo" >> .env
npm run build && npm start

# Terminal 2 — demo app
cd demo
npm install
npm run dev
```

Build the extension:

```bash
cd extension
npm install
npm run build        # outputs extension/dist — load this in chrome://extensions
```

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
| Nothing appears on a style change | Select an element first, then press **Enter** to commit the edit in the Styles panel. |
| "Server unreachable" in the panel | Server not running, or wrong URL in the popup. Check `curl localhost:4399/health`. |
| "No deterministic mapping" | Use **Analyze with AI**, or the property isn't a simple Tailwind utility. |
| "Gemini quota exceeded" | Use the deterministic **Analyze** button, or wait for the daily quota to reset. |
| "No source file found" | The element's `className` must be a static string in source — not built with `cn()`/`clsx()` at runtime. |
| "Extension context invalidated" | You reloaded the extension while DevTools was open — fully close and reopen DevTools. |
| Page doesn't hot-reload after Apply | Confirm your dev server is running and watching the same files. |

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
