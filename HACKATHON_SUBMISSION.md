# PixelPaws — Hackathon Submission Draft

## Category

Developer Tools

## Short description

PixelPaws is a pixel-art Windows desktop companion that turns natural-language requests into safe, reviewable developer workflows. It combines screen-aware chat, a visible one-tab Playwright browser agent, reusable automation plans, local screen observation, skills, and scheduled coding tasks in one small Electron app.

## Full description

Most automation tools hide the browser, repeat actions when a page changes, or fail without explaining what happened. PixelPaws makes the workflow observable and recoverable. The user writes a task, reviews the AI plan, and presses Play. GPT-5.6 proposes structured semantic actions; a local Playwright runner validates and executes them in a visible browser. The app stops safely on duplicate actions, failures, or CAPTCHA/human-verification challenges, then explains the issue in Automation chat instead of pretending the task succeeded.

The same companion can inspect a manually captured screen, optionally show a local live observation frame, remember reusable skills, and schedule safe daily developer tasks such as generating a file, opening VS Code, and running an allow-listed project command. Without an API key it stays in Demo mode, so judges can install and explore the interface without hidden credentials.

## Technical implementation

- Electron main process for the Windows desktop lifecycle and secure settings.
- React/Vite renderer with separate Chat, Automation, Skills, and Schedule components.
- Local Express API on port 4387.
- OpenAI official Node SDK with a configurable `OPENAI_MODEL`.
- Playwright Chromium in headed/visible mode.
- Structured action validation with Zod.
- JSON/SQLite-backed local history and libraries.
- Server-sent events for chat responses.

## Safety and scope

The demo is intentionally read-only and bounded. It does not bypass CAPTCHA, solve human-verification challenges, submit applications, send messages, make purchases, or use passwords. Scheduled commands are allow-listed and should only be used with a test project. The user must review and explicitly start an automation.

## Required links

- Public code repository: `TODO`
- Public YouTube demo, less than three minutes: `TODO`
- Codex `/feedback` Session ID: `TODO`

Candidate video link supplied during development: `https://youtu.be/gSn8OUulEyM` — verify that it is public, has clear audio, demonstrates the final build, and is shorter than three minutes before submitting.

## Prior work disclosure

The original project was a Screen Companion prototype. Work to document as submission-period extension includes the reusable automation library, semantic browser action loop, single-tab/duplicate protection, Automation chat, local live observation, reusable skills, daily scheduler, secure model settings, Demo mode, UI polish, and reliability fixes. Provide dated Codex logs or commits as evidence rather than relying on this statement alone.
