# Build Prompt: Screen Companion AI

## Mission

Build a Windows desktop Electron application for OpenAI Build Week. The app is a small floating AI companion that answers questions about the user's screen.

The deadline is July 21. **Phase One is the release target.** Phase Two must not delay or destabilize Phase One.

> Treat this document as the product and delivery contract. If a detail is unspecified, choose the smallest reliable Windows-only solution and document the choice in code.

## Technology

- Desktop: Electron on Windows
- UI: React with functional components and hooks
- Local server: Node.js and Express
- AI: OpenAI GPT-5.6 with vision and structured output
- Browser automation: Playwright, Phase Two only
- Local history: SQLite
- Screen capture: Electron-approved desktop capture APIs

Keep the OpenAI key in the Node/Express process. Never send it to or store it in the Electron renderer.

## Phase One: required MVP

### Floating companion

Create two separate Electron windows:

1. A small, frameless, draggable, always-on-top floating button.
2. A chat panel that opens and closes when the button is clicked.

The button should remain above normal windows on the current Windows desktop. Do not promise behavior across virtual desktops unless verified. Restore its last safe position and never create duplicate windows.

### Chat panel

Include a message thread, text input, send button, a clearly labeled **Look at my screen** button, a Recent tab, and a disabled Automate tab labeled **Coming soon**. Include loading, streaming, empty, and error states.

Capture the screen only after the user explicitly presses the capture button. Ordinary text messages must not capture the screen automatically.

### Chat API contract

Implement `POST /api/chat` in Express.

Request body:

```json
{
  "sessionId": "optional-existing-session-id",
  "message": "What is shown on this screen?",
  "screenshotBase64": "optional-data-url-or-base64-string"
}
```

Rules:

- `message` is required and limited to 4,000 characters.
- The decoded screenshot is limited to 5 MB.
- Downscale screenshots before upload when possible; prefer JPEG or WebP.
- Reject malformed JSON and oversized requests with useful 4xx responses.
- Use a request timeout and return a friendly error if the AI call fails.
- Never log message contents, API keys, or screenshot data.

Use Server-Sent Events (`text/event-stream`) for streaming. Send assistant text chunks, then a final event containing the message ID. If streaming is unavailable in the selected SDK path, use a non-streaming fallback without changing the UI contract.

### Storage contract

Use local SQLite with this minimal schema:

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  has_screenshot INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
```

Do not store raw screenshots in SQLite for the MVP. Store only whether a screenshot was used. If files are added later, keep them in the app's local data directory and provide a deletion path.

### Phase One definition of done

- The app starts without duplicate windows or uncaught renderer errors.
- The floating button opens the chat panel quickly.
- Text-only chat works.
- Screen-aware chat works after explicit user capture.
- The response renders incrementally or through the documented fallback.
- Sessions and messages remain available after restart.
- API and capture failures appear as friendly in-app errors.
- No secret, screenshot, or message content appears in logs.

## Phase Two: optional only after Phase One passes

### Safe browser automation

Add `POST /api/automate` only after Phase One is stable. The backend must request structured output using this schema:

```json
{
  "steps": [
    { "action": "navigate", "url": "https://example.com" },
    { "action": "search", "query": "example" },
    { "action": "click", "selector": "button[type=submit]" },
    { "action": "type", "selector": "input[name=q]", "text": "example" },
    { "action": "submit", "selector": "form" }
  ]
}
```

Validate every response before execution. Allow only HTTPS and a small demo domain allowlist. Limit plans to 20 steps. Never execute arbitrary JavaScript or shell commands from model output. Run Playwright visibly. Require confirmation before irreversible actions such as sending, purchasing, deleting, or submitting. Stop on failure and show recovery options. Provide Play, Pause, Cancel, and Restart controls.

### Meeting privacy mode

Meeting detection is optional and lowest priority. Poll the active Windows foreground process/title at a documented interval using a hardcoded list for Zoom, Teams, and Meet-related browser titles. On a match, hide both windows and pause automation. Provide a shortcut such as `Alt+Shift+A`. Document that title matching can produce false positives and is not a security guarantee.

## Delivery order

1. Scaffold Electron and the two windows.
2. Add Express and test `/api/chat` independently.
3. Add SQLite persistence.
4. Add text-only chat.
5. Add explicit screenshot capture and vision chat.
6. Test the complete Phase One loop.
7. Only then consider automation and meeting privacy.

Keep implementation choices small, local, readable, and easy to explain in a live demo.