# InspectFlow

Edit styles in Chrome DevTools → AI maps the change to the right Tailwind class → review the diff → one click writes the file. Next.js hot reload picks it up instantly.

```
Chrome DevTools  →  Chrome Extension  →  MCP Server  →  Gemini API
                                               ↓
                               diff preview + approval UI
                                               ↓
                              Babel AST file writer + hot reload
```

---

## Quick start (3 terminals)

### 1 — MCP server

```bash
cd server
npm install
cp .env.example .env          # add your GEMINI_API_KEY
# Set PROJECT_ROOT to the demo directory (absolute path):
echo "PROJECT_ROOT=$(pwd)/../demo" >> .env
npm run dev
```

Server starts on **http://127.0.0.1:4399**. Check http://127.0.0.1:4399/health — `geminiConfigured` should be `true`.

### 2 — Demo app

```bash
cd demo
npm install
npm run dev                   # starts on http://localhost:3000
```

### 3 — Chrome extension

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select `extension/dist`
4. Click the InspectFlow toolbar icon
5. Verify the server URL is `http://127.0.0.1:4399` and click **Test** — you should see the green **Connected** status

---

## End-to-end walkthrough

1. Navigate to **http://localhost:3000** in Chrome.
2. Open Chrome DevTools (`F12` or `⌘⌥I`).
3. Switch to the **InspectFlow** tab in the DevTools panel.
4. Click **Start Capture** — the button turns red.
5. In the **Elements** panel, click any card, heading, or section.
6. In the **Styles** sub-panel (right side), edit a CSS property, e.g.:
   - Change `padding` from `16px` to `32px`
   - Change a color
   - Change a font size
7. The InspectFlow panel shows the captured change with `✓ Sent to server`.
8. Click **Analyze →** — Gemini reads the source file and suggests the Tailwind class swap.
9. A contextual diff appears, e.g.:

   ```diff
   @@ -10 @@
     <div
   -   className="p-4 rounded-2xl border border-gray-100 shadow-sm"
   +   className="p-8 rounded-2xl border border-gray-100 shadow-sm"
     >
   ```

10. Click **Apply** — the source file is updated via Babel AST.
11. Next.js hot reload reflects the change immediately. Refresh confirms it persists.

---

## How source files are discovered — zero app code required

The server greps your `PROJECT_ROOT` for files containing the element's `className` string. When you click an element in DevTools and edit a style, the extension reads `$0.className` and sends it to the server. The server walks your source tree, scores every file by how specifically it matches that class string, and uses the best hit.

**No annotations, no code changes, no wrappers.** Point `PROJECT_ROOT` at any React/Next.js project and it works immediately.

---

## Good targets to try editing

| Component | File | Suggested edit |
|---|---|---|
| Hero section | `Hero.tsx` | `py-24` → `py-32` |
| Feature card | `FeatureSection.tsx` | `p-8` → `p-6` |
| Navbar | `Navbar.tsx` | `py-4` → `py-6` |
| Profile card | `CardShowcase.tsx` | `p-6` → `p-8` |
| Pricing card | `CardShowcase.tsx` | `p-8` → `p-4` |
| Footer | `Footer.tsx` | `py-14` → `py-20` |
| Stats card | `CardShowcase.tsx` | `text-3xl` → `text-4xl` |
| CTA button | `Hero.tsx` | `px-6` → `px-8` |

---

## Project structure

```
InspectFlow/
├── server/          MCP server (Node + TypeScript + Express)
│   ├── src/
│   │   ├── config/        env validation (zod)
│   │   ├── logger/        pino logger
│   │   ├── validation/    shared zod schemas
│   │   ├── store/         in-memory captured-change ring buffer
│   │   ├── routes/        health · style-change · analyze · preview · apply
│   │   ├── services/      Gemini REST client · safe file reader
│   │   ├── analyzers/     context diff generator
│   │   ├── writers/       Babel AST + recast file writer
│   │   ├── tools/         MCP tools (list · analyze · preview · apply)
│   │   └── server/        Express app factory + MCP server factory
│   └── .env.example
│
├── extension/       Chrome MV3 extension (TypeScript + esbuild)
│   ├── src/
│   │   ├── shared/        types · settings · serverClient · cssParser
│   │   ├── background.ts  service worker + CSS debugger capture
│   │   ├── devtools.ts    registers the InspectFlow DevTools panel
│   │   ├── panel.ts       analyze → diff → apply/reject UI
│   │   └── popup.ts       server URL settings + connection test
│   └── manifest.json
│
├── demo/            Next.js 15 + Tailwind 4 test application
│   └── src/
│       ├── app/           layout + page
│       ├── components/    Navbar · Hero · FeatureSection · HowItWorks
│       │                  CardShowcase · Footer · DemoBanner
│       └── helpers/       SourceMapper (useSourceFile hook)
│
└── helpers/
    └── SourceMapper.tsx   Copy this into any React project to enable source mapping
```

---

## MCP tools (for AI clients)

Connect any MCP client (e.g. Claude Code) to `http://127.0.0.1:4399/mcp`:

| Tool | Input | Output |
|---|---|---|
| `list_recent_changes` | `limit?` | Array of captured CSS changes |
| `analyze_style_change` | `file, property, value, className?, selector?` | `{ replace, with, reason }` |
| `preview_change` | `replace, with, file?` | Unified diff string |
| `apply_change` | `file, replace, with` | `{ success, lineNumber }` |

Example Claude Code config (`.claude/settings.json`):

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

---

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `GEMINI_API_KEY` | — | Required for analysis. Get one at https://aistudio.google.com/apikey |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Any model from `GET /v1beta/models` |
| `PORT` | `4399` | HTTP port |
| `HOST` | `127.0.0.1` | Local only by default |
| `PROJECT_ROOT` | `cwd` | Absolute path — all file reads/writes sandboxed here |
| `LOG_LEVEL` | `info` | `trace` · `debug` · `info` · `warn` · `error` |
| `LOG_PRETTY` | `true` | `false` for JSON logs |
| `CORS_ORIGINS` | `*` | Comma-separated or `*` |

---

## Security

- All file reads and writes are sandboxed to `PROJECT_ROOT`. Path traversal (`../`) is blocked at validation.
- The extension only makes requests to `127.0.0.1` (configurable). No external network calls.
- Files are **never** modified without explicit user approval in the InspectFlow panel.
- The Gemini API key is stored in `.env` (gitignored) — never committed.
