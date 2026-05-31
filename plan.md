# DevTools Sync MCP (MVP)

## Goal

Build a local MCP server and Chrome Extension that allows a developer to:

1. Open a React / Next.js application.
2. Modify styles using Chrome DevTools Inspect Element.
3. Detect the CSS change.
4. Send the change to a local MCP server.
5. Use Gemini API to determine how source code should change.
6. Show a diff preview.
7. Ask the user for approval.
8. Apply the change to local source code.
9. Trigger hot reload.

The system must NEVER modify source code without user approval.

---

# Success Criteria

The following workflow must work:

## Example

Source:

```tsx
<div className="p-4 rounded-lg bg-white">
```

Developer changes in Chrome DevTools:

```css
padding: 32px;
```

System detects:

```json
{
  "property": "padding",
  "value": "32px"
}
```

Gemini suggests:

```diff
- p-4
+ p-8
```

User sees:

```text
Apply change?

File:
src/components/Card.tsx

Diff:

- p-4
+ p-8
```

User clicks:

```text
Apply
```

File updates.

Next.js hot reload reflects the change.

Refreshing browser should preserve the change.

---

# Scope

Supported

* React
* Next.js App Router
* Tailwind CSS
* Plain CSS

Not Supported

* Styled Components
* Emotion
* SCSS
* Vue
* Angular

---

# Architecture

```text
Chrome DevTools
       ↓
Chrome Extension
       ↓
Local MCP Server
       ↓
Gemini API
       ↓
Diff Generator
       ↓
Approval Dialog
       ↓
File Writer
```

---

# Tech Stack

## MCP Server

* Node.js
* TypeScript
* @modelcontextprotocol/sdk
* Express

## Browser Extension

* Manifest V3
* TypeScript

## AST

* Babel Parser
* Recast
* PostCSS

## AI

Gemini 2.5 Flash

Environment Variable:

```env
GEMINI_API_KEY=
```

---

# Project Structure

```text
devtools-sync-mcp/

├── extension/
│
│   ├── manifest.json
│   ├── background.ts
│   ├── devtools.ts
│   ├── popup.html
│   └── popup.ts
│
├── server/
│
│   ├── src/
│   │
│   ├── tools/
│   ├── routes/
│   ├── services/
│   ├── analyzers/
│   ├── writers/
│   │
│   └── index.ts
│
└── README.md
```

---

# Required Features

## Feature 1

Capture CSS changes from DevTools.

Use Chrome Debugger Protocol.

Enable:

```js
CSS.enable
```

Listen for:

```js
CSS.styleSheetChanged
```

Extract:

```json
{
  "selector": ".card",
  "property": "padding",
  "value": "32px"
}
```

Send to MCP server.

---

# Feature 2

Local MCP Server

Endpoint:

```http
POST /style-change
```

Payload:

```json
{
  "selector": ".card",
  "property": "padding",
  "value": "32px"
}
```

Store incoming change.

Return success.

---

# Feature 3

Source Mapping

Create a lightweight React helper.

Example:

```tsx
<div
  data-source-file="src/components/Card.tsx"
>
```

Extension must read:

```html
data-source-file
```

and include it in payload.

Payload:

```json
{
  "file":"src/components/Card.tsx",
  "property":"padding",
  "value":"32px"
}
```

This is required for MVP.

Do NOT attempt React Fiber inspection.

Do NOT attempt source maps.

Use data-source-file.

---

# Feature 4

Gemini Analysis

Gemini receives:

```json
{
  "file":"Card.tsx",
  "current":"p-4 rounded-lg",
  "change":"padding:32px"
}
```

Gemini returns:

```json
{
  "replace":"p-4",
  "with":"p-8"
}
```

Create strongly typed service.

Handle failures gracefully.

---

# Feature 5

Diff Preview

Before writing file:

Generate diff.

Example:

```diff
- p-4
+ p-8
```

Display in popup.

Buttons:

```text
Apply
Reject
```

Default:

Reject.

Never auto-apply.

---

# Feature 6

File Writer

After approval:

Update source file.

Use Babel AST.

Do not use regex.

Preserve formatting.

Save file.

---

# Feature 7

MCP Tools

Expose:

## analyze_style_change

Input:

```json
{
  "file":"Card.tsx",
  "property":"padding",
  "value":"32px"
}
```

Output:

```json
{
  "replace":"p-4",
  "with":"p-8"
}
```

---

## preview_change

Input:

```json
{
  "replace":"p-4",
  "with":"p-8"
}
```

Output:

```diff
- p-4
+ p-8
```

---

## apply_change

Input:

```json
{
  "file":"Card.tsx",
  "replace":"p-4",
  "with":"p-8"
}
```

Output:

```json
{
  "success":true
}
```

---

# Security Rules

Never modify files without approval.

Never execute shell commands from Gemini output.

Never allow arbitrary path traversal.

Restrict writes to project root.

Validate all paths.

---

# Development Order

Phase 1

Create MCP Server.

Phase 2

Create Chrome Extension.

Phase 3

Capture CSS changes.

Phase 4

Send changes to server.

Phase 5

Gemini integration.

Phase 6

Diff preview.

Phase 7

Apply file updates.

Phase 8

End-to-end testing.

---

# Deliverables

Claude must create:

1. Complete TypeScript code.
2. MCP server.
3. Chrome Extension.
4. Gemini integration.
5. Diff preview UI.
6. Documentation.
7. Installation instructions.
8. Local development scripts.
9. Example Next.js demo project.

Project is complete only when a Next.js application can be modified through Chrome DevTools and changes persist after page refresh.
