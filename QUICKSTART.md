# InspectFlow — Quick Start

**Resources**
- Chrome extension: [github.com/AryanBansal-launch/InspectFlow/releases/latest](https://github.com/AryanBansal-launch/InspectFlow/releases/latest)
- npm package: [npmjs.com/package/inspectflow-server](https://www.npmjs.com/package/inspectflow-server)

---

## Step 1 — Install the Chrome extension (one-time)

1. Download `extension-dist.zip` from the [latest release](https://github.com/AryanBansal-launch/InspectFlow/releases/latest) and unzip it.
2. Open `chrome://extensions` → toggle **Developer mode** on → click **Load unpacked** → select the unzipped folder.
3. The InspectFlow icon appears in the Chrome toolbar.

---

## Step 2 — Start the server in your project

```bash
cd your-project
npx inspectflow-server@latest
```

Server starts on `http://localhost:4399`. Uses the current directory as the project root — no config needed.

Want Gemini AI analysis too?

```bash
GEMINI_API_KEY=your_key npx inspectflow-server@latest
```

---

## Step 3 — Connect your AI client

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

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "inspectflow": {
      "command": "npx",
      "args": ["-y", "inspectflow-server@latest"],
      "env": {
        "PROJECT_ROOT": "/absolute/path/to/your-project"
      }
    }
  }
}
```

---

## Step 4 — Edit styles

1. Open your app in Chrome → open DevTools (`F12`) → click the **InspectFlow** tab.
2. Click **Test** → confirm **Connected** → click **Start Capture**.
3. In the **Elements** panel, click any element. In **Styles**, change a value and press **Enter**.
4. A change card appears → click **Analyze** → review the diff → click **Apply**.
5. Your source file is updated and the dev server hot-reloads.

---

For full documentation see [README.md](README.md).
