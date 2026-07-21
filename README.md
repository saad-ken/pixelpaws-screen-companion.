# PixelPaws — Screen Companion

PixelPaws is a Windows Electron companion for turning natural-language requests into useful, reviewable work. Tuxi, the pixel-art cat, stays nearby while the user chats, inspects a screen, runs a safe browser automation, or schedules a local developer task.

## Hackathon track

**Developer Tools** — an AI-assisted browser and desktop workflow tool for developers and knowledge workers.

## What it does

- **Screen chat:** ask questions about the current screen with a manually captured screenshot.
- **Live observation:** enable a separate local preview in the Automation view. Frames stay local until the user explicitly asks AI to inspect one.
- **Browser automation:** describe a task, review the generated plan, then run it in one visible Playwright Chromium page.
- **Semantic actions:** the model chooses `navigate`, `search`, `click`, `type`, `scroll`, or `done`; execution prefers roles, labels, placeholders, and visible text instead of arbitrary XPath.
- **Safe recovery:** one browser tab, duplicate-action protection, pause/stop controls, page summaries, and explicit human-verification handling.
- **Automation library:** save, edit, play, delete, and discuss reusable automations in an in-app chat.
- **Skills:** save reusable instructions that are included when the automation planner chooses its next action.
- **Scheduled developer tasks:** create daily local tasks that can write code/files, open VS Code, and optionally run an allow-listed command.
- **Demo mode:** the app remains usable without an API key and clearly labels AI features that need configuration.
- **Secure settings:** the OpenAI key is saved through Electron's Windows secure storage and can be deleted from Settings.

## Architecture

```text
React/Vite renderer
  ├─ chat, screen capture, automation, skills, scheduler UI
  └─ fetch/SSE calls to the local API

Electron main process
  ├─ secure OpenAI settings and preload bridge
  ├─ local Express API
  ├─ OpenAI planning, summaries, and chat
  ├─ visible Playwright browser runner
  └─ local daily scheduler
```

The model proposes structured actions. The local runner validates the action, observes the page, applies safety checks, executes one step, and repeats until `done`, failure, or human verification. CAPTCHA and “verify you are human” pages are never bypassed or clicked automatically.

## Supported platform

- Windows 10/11 desktop
- Node.js 18+ recommended
- Chromium installed by Playwright
- OpenAI API key optional; without one, the app runs in Demo mode

## Install and run

```powershell
npm install
npx playwright install chromium
npm run dev
```

For a production-style local build:

```powershell
npm run build
npm start
```

Copy `.env.example` to `.env` only if you want environment-based configuration. Never commit `.env` or an API key.

```dotenv
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-5.6-sol
PORT=4387
```

The app also provides an OpenAI Settings modal. For a low-cost development run, choose the project's lower-cost model setting there; for the hackathon demonstration, use the GPT-5.6 configuration above. The runtime keeps the model configurable rather than hardcoding a secret or model choice.

## Judge walkthrough

1. Run `npm install`, `npx playwright install chromium`, and `npm run dev`.
2. Open the PixelPaws window and use **New chat** to test normal chat or manual screen capture.
3. Select **Automate**, enter a safe public task such as `Search GitHub for three React UI libraries and summarize the first result`, and press **Create automation**.
4. Review the plan, press **Play**, and watch the single visible browser page and running status.
5. Use **AI observe screen** only when the page is visually unclear, then ask the Automation chat to explain the current frame.
6. Select **Schedule** to generate a daily local developer task, review the generated file/command, save it, and use **Run now**.

Do not use real credentials, purchases, account changes, form submissions, or CAPTCHA-protected sites during judging. The visible browser is intentionally designed to stop and explain when a human-verification challenge appears.

## OpenAI and Codex collaboration

Codex was used throughout the project to inspect the existing Electron/React code, repair renderer and IPC regressions, add isolated components, improve the Playwright action loop, debug model output validation, and verify each change with builds and syntax checks.

GPT-5.6 is used as the configurable planning and explanation model for the submission configuration. It produces:

- a reusable automation plan;
- one validated semantic browser action at a time;
- page-result summaries with optional screenshot context;
- explanations and recovery suggestions in Automation chat;
- generated code/content for scheduled developer tasks.

Key engineering decisions remained deliberate and human-reviewed: keep automation visible, use one tab, require Play before running, preserve semantic locators, keep screenshots opt-in, never bypass CAPTCHA, allow Demo mode, and constrain scheduled commands.

### Existing work and new work

This project began as a Screen Companion prototype. The submission-period extension is the integrated Phase Two/Three workflow: reusable Playwright automations, semantic action validation, recovery/status UI, automation chat, local screen observation, reusable skills, scheduled developer tasks, secure model settings, Demo mode, and the submission documentation.

For the final submission, attach timestamped Codex session logs or dated commits that show this extension work. Do not claim that earlier prototype work was created during the submission period.

## Validation

```powershell
npm run test
npm run build
```

The test command checks the Electron entry points and the Vite build verifies the renderer bundle.

## Third-party software

This project uses Electron, React, Vite, Express, OpenAI's official Node SDK, Playwright, Zod, better-sqlite3, concurrently, and wait-on. Review each dependency's license and terms before publishing the repository. The project does not include copyrighted music or third-party brand assets in its submission materials.

## Submission links to fill in

- Repository: **TODO — publish this repository and paste the URL here**
- Demo video: **TODO — upload a public YouTube video under three minutes**
- Codex `/feedback` Session ID: **TODO — run `/feedback` in the Codex project thread and paste the ID here**

