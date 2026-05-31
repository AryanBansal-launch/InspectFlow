# InspectFlow MCP Server

Local server that captures CSS changes made in Chrome DevTools and (in later
phases) translates them into approval-gated edits to your React/Next.js source.

It exposes **two interfaces over one HTTP port**:

- A **JSON API** for the Chrome extension (`/health`, `/style-change`).
- An **MCP endpoint** (`/mcp`) implementing the Model Context Protocol over a
  stateless StreamableHTTP transport, so MCP clients (e.g. Claude) can drive the
  analyze → preview → apply workflow.

## Requirements

- Node.js >= 20

## Setup

```bash
cd server
npm install
cp .env.example .env   # then edit .env (set GEMINI_API_KEY for analysis features)
```

## Scripts

| Command            | Description                                  |
| ------------------ | -------------------------------------------- |
| `npm run dev`      | Run with hot reload (tsx watch).             |
| `npm run build`    | Type-check and compile to `dist/`.           |
| `npm start`        | Run the compiled server from `dist/`.        |
| `npm run typecheck`| Type-check only, no emit.                    |

## Configuration

All configuration is via environment variables (see `.env.example`):

| Variable         | Default            | Purpose                                            |
| ---------------- | ------------------ | -------------------------------------------------- |
| `GEMINI_API_KEY` | _(unset)_          | Enables AI analysis. Server boots without it.      |
| `GEMINI_MODEL`   | `gemini-2.5-flash` | Model used for analysis.                           |
| `PORT`           | `4399`             | HTTP port.                                         |
| `HOST`           | `127.0.0.1`        | Bind address (local-only by default).              |
| `PROJECT_ROOT`   | `cwd`              | Sandbox root — all file writes are confined here.  |
| `LOG_LEVEL`      | `info`             | Pino log level.                                    |
| `LOG_PRETTY`     | `true`             | Pretty logs (dev) vs JSON (prod).                  |
| `CORS_ORIGINS`   | `*`                | Allowed CORS origins (comma-separated, or `*`).    |

Invalid configuration fails fast at startup with a descriptive message.

## HTTP API

### `GET /health`

Liveness probe + configuration summary.

### `POST /style-change`

Records a CSS change captured by the extension.

```jsonc
// Request
{ "file": "src/components/Card.tsx", "selector": ".card", "property": "padding", "value": "32px" }
// 201 Response
{ "success": true, "change": { "id": "…", "receivedAt": "…", ... } }
```

Paths are validated: absolute paths, `..` segments, and null bytes are rejected.

### `GET /style-change?limit=50`

Lists recently captured changes (newest first).

## MCP endpoint — `POST /mcp`

Speaks JSON-RPC 2.0 over StreamableHTTP. Quick manual check:

```bash
curl -s -X POST http://127.0.0.1:4399/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

### Tools

| Tool                  | Phase | Description                                  |
| --------------------- | ----- | -------------------------------------------- |
| `list_recent_changes` | 1     | Read-only view of captured DevTools changes. |
| `analyze_style_change`| 5     | Ask Gemini how source should change.         |
| `preview_change`      | 6     | Produce a unified diff for a proposed edit.  |
| `apply_change`        | 7     | Apply an approved edit via Babel AST.        |

## Project structure

```
server/src/
├── index.ts            # Entry point: startup, graceful shutdown
├── config/env.ts       # Env loading + validation (zod)
├── logger/index.ts     # Pino logger
├── validation/         # Shared zod schemas + safe validation helper
├── store/              # In-memory captured-change store
├── routes/             # HTTP API (health, style-change)
├── server/             # Express app factory + MCP server factory
├── services/           # Gemini client (Phase 5)
├── analyzers/          # Diff generation (Phase 6)
├── writers/            # Babel AST file writer (Phase 7)
└── tools/              # MCP tool registrations (Phase 5+)
```
