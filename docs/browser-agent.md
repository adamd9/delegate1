# Browser Agent (Copilot CLI + Playwright)

A headed-browser capability that lets the assistant browse the web, fill forms, extract data, and perform multi-step browser automation — all dispatched through a single tool call.

- __Files__: `src/browser/index.ts`, `src/tools/handlers/copilotCli.ts`, `src/tools/providers/copilotCli.ts`
- __Docker__: `Dockerfile.browser`, `docker-compose.browser.yml`

## Overview

The browser agent wraps GitHub Copilot CLI as an MCP tool provider. When a user asks for something that requires web interaction (research, form filling, scraping), the base agent calls `copilot_dispatch` with a natural-language task description. Copilot CLI runs in a subprocess with the `playwright-cli` tool enabled, driving a real Chromium instance.

This design keeps browser complexity out of the main assistant loop: the assistant describes _what_ it wants, and Copilot CLI figures out _how_ to drive the browser.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Docker container (Dockerfile.browser)                  │
│  Base: mcr.microsoft.com/playwright:v1.52.0-noble       │
│                                                         │
│  ┌──────────┐   tool call    ┌──────────────────┐       │
│  │ Express  │ ──────────────▶│ copilot_dispatch │       │
│  │ server   │                │ (handler)        │       │
│  │ :8081    │ ◀──────────────│                  │       │
│  └──────────┘   result       └────────┬─────────┘       │
│                                       │ spawn           │
│                               ┌───────▼─────────┐       │
│                               │  Copilot CLI    │       │
│                               │  + playwright   │       │
│                               └───────┬─────────┘       │
│                                       │ CDP             │
│  ┌───────────┐  :99          ┌───────▼─────────┐       │
│  │   Xvfb    │◀─────────────│   Chromium       │       │
│  │ (virtual  │  DISPLAY      │ (persistent      │       │
│  │  display) │               │  profile)        │       │
│  └─────┬─────┘               └─────────────────┘       │
│        │                                                │
│  ┌─────▼─────┐  ┌───────────┐                           │
│  │  fluxbox  │  │  x11vnc   │ :5900 ◀── VNC client     │
│  │  (WM)     │  │  (VNC)    │                           │
│  └───────────┘  └───────────┘                           │
└─────────────────────────────────────────────────────────┘
```

**Component roles:**

- **Express server** — the main Delegate 1 backend; receives tool calls from the model
- **copilot_dispatch handler** — spawns Copilot CLI as a child process with the task prompt
- **Copilot CLI** — GitHub's CLI agent; uses `playwright-cli` to drive Chromium
- **Xvfb** — virtual X11 framebuffer (display `:99`, 1280×1024×24) so Chromium has a screen
- **fluxbox** — lightweight window manager (required for some browser interactions)
- **x11vnc** — VNC server exposing display `:99` on port 5900 for debugging
- **Chromium** — Playwright's bundled browser, using a persistent profile for cookies/sessions

## Quick Start

### Docker (recommended)

The compose file reads from the project's root `.env` file — the same one used for local dev.
Add the browser-specific vars to your `.env`:

```bash
# In .env (alongside OPENAI_API_KEY, Twilio creds, etc.)
BROWSER_ENABLED=true
COPILOT_GITHUB_TOKEN=ghp_your_token_here
# COPILOT_TIMEOUT_MS=120000   # optional, default 2 min
```

Then build and run:

```bash
docker compose -f docker-compose.browser.yml up --build
```

The container starts Xvfb, fluxbox, and x11vnc automatically, then boots the Express server.

### Local development

Add the vars to your `.env` (commented out by default):

```bash
# In .env — uncomment to enable
BROWSER_ENABLED=true
COPILOT_GITHUB_TOKEN=ghp_your_token_here
```

Then start the dev server normally:

```bash
npm run dev
```

In local mode, no display processes are started. Copilot CLI uses your local browser directly.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `BROWSER_ENABLED` | `false` | Master toggle. Must be `true` to register and execute `copilot_dispatch`. |
| `DOCKER` | — | Set to `true` (or presence of `/.dockerenv`) to enable Xvfb/fluxbox/x11vnc startup. |
| `COPILOT_TIMEOUT_MS` | `300000` | Max milliseconds for a single `copilot_dispatch` invocation. Process is killed with SIGTERM on timeout. |
| `COPILOT_GITHUB_TOKEN` | — | GitHub PAT (classic or fine-grained) — see **PAT permissions** below. Required for Copilot CLI auth and workspace repo management. |
| `COPILOT_REMOTE_REPO` | — | Git remote URL for the copilot working directory (e.g. `https://github.com/user/copilot-outputs.git`). If omitted and a token is set, a private repo `delegate1-copilot-workspace` is auto-created under the authenticated user. Session outputs are committed and pushed after each task. |
| `OPENAI_API_KEY` | — | Required for the main assistant model. |
| `PUBLIC_URL` | — | External URL for webhooks/callbacks. |
| `RUNTIME_DATA_DIR` | `./runtime-data` | Base directory for persistent app data (notes, SQLite, browser profile, etc.). |
| `SESSION_HISTORY_LIMIT` | — | Max conversation turns retained in session. |
| `PORT` | `8081` | Express server listen port. |

### PAT Permissions

`COPILOT_GITHUB_TOKEN` must be a **fine-grained** Personal Access Token (`github_pat_...`). Classic PATs (`ghp_...`) are **not supported** by Copilot CLI.

Create one at https://github.com/settings/personal-access-tokens/new with:

**Account permissions:**
- **Administration** → Read and Write *(only needed to auto-create the workspace repo; skip if using `COPILOT_REMOTE_REPO` with an existing repo)*

**Repository permissions** (grant to "All repositories" or the specific workspace repo):
- **Copilot Requests** → Read *(required — Copilot CLI auth)*
- **Contents** → Read and Write *(clone and push to workspace repo)*
- **Metadata** → Read *(always required, enabled by default)*

> **Note:** The classic PAT `copilot` scope is for org-level Copilot seat management — it is NOT used for CLI authentication. Copilot CLI only accepts fine-grained PATs or OAuth tokens.

The workspace repo (`delegate1-copilot-workspace`) is created as **private** by default.

## Tool Reference

### `copilot_dispatch`

Dispatches a task to GitHub Copilot CLI. The agent can browse the web via Playwright, read/write files, run commands, and perform multi-step browser automation.

**Schema:**

```json
{
  "name": "copilot_dispatch",
  "type": "function",
  "parameters": {
    "type": "object",
    "properties": {
      "task": {
        "type": "string",
        "description": "Natural language description of the task to perform."
      }
    },
    "required": ["task"]
  }
}
```

**Underlying command:**

```bash
copilot -p "<task>" -s --no-ask-user --allow-tool=playwright-cli
```

| Flag | Purpose |
|------|---------|
| `-p` | Prompt — the task description |
| `-s` | Streaming mode |
| `--no-ask-user` | Non-interactive; never prompts for confirmation |
| `--allow-tool=playwright-cli` | Enables the Playwright browser tool |

**Environment passed to child process:**

- All inherited env vars from the server process
- `COPILOT_PLAYWRIGHT_PERSISTENT=true` — uses a persistent browser context (retains cookies/sessions)
- `DISPLAY` — forwarded when set (`:99` in Docker)

**Response format:**

```json
{
  "status": "completed | error | timeout",
  "output": "stdout from Copilot CLI",
  "error": "stderr (if any)"
}
```

**Example — web research:**

```json
{
  "task": "Go to news.ycombinator.com, find the top 5 stories, and return their titles and URLs"
}
```

**Example — form interaction:**

```json
{
  "task": "Navigate to https://example.com/contact, fill in name='Test User' and email='test@example.com', then submit the form"
}
```

**Registration:** The tool is only registered when `BROWSER_ENABLED=true`. It appears in the tool registry with tags `['copilot-cli', 'base-default']`, making it available to the base agent by default.

## Volume Persistence

Three named volumes keep state across container restarts:

| Volume | Container path | Local path | Purpose |
|--------|---------------|------------|---------|
| `browser-profile` | `/data/browser-profile` | `runtime-data/browser-profile` | Playwright persistent browser context — cookies, localStorage, session data. Survives restarts so the browser stays logged in. |
| `copilot-workdir` | `/data/copilot-workdir` | `runtime-data/copilot-workdir` | Working directory for Copilot CLI. Files created/downloaded during tasks persist here. |
| `runtime-data` | `/app/runtime-data` | `runtime-data/` | Core app data — SQLite database, notes, adaptations, MCP config. |

Directories are created automatically on startup via `ensureDirectories()` in `src/browser/index.ts`.

## VNC Debugging

In Docker mode, x11vnc exposes the virtual display on port 5900. Connect with any VNC client to watch the browser in real time.

```bash
# macOS built-in Screen Sharing
open vnc://localhost:5900

# Or any VNC client
# Host: localhost, Port: 5900, No password
```

**What you'll see:** A 1280×1024 desktop with fluxbox window manager. When `copilot_dispatch` runs, Chromium windows will appear and you can observe Playwright navigating, clicking, and typing.

**Tips:**

- VNC is unauthenticated (`-nopw` flag) — only expose port 5900 on trusted networks
- The display resolution (1280×1024) is set in the Xvfb startup args in `src/browser/index.ts`
- If the display appears frozen, the browser may be idle between tasks — it's normal

## Local Development

When running without Docker (`DOCKER` not set, no `/.dockerenv`):

- **No display processes** — Xvfb, fluxbox, and x11vnc are skipped entirely
- **No VNC** — there's nothing to connect to on port 5900
- **Copilot CLI uses your local browser** — Playwright opens a visible Chromium window on your desktop
- **Profile directory** — `runtime-data/browser-profile` (relative to project root, or `$RUNTIME_DATA_DIR/browser-profile`)
- **Working directory** — `runtime-data/copilot-workdir`

To enable:

```bash
export BROWSER_ENABLED=true
export COPILOT_GITHUB_TOKEN=ghp_your_token   # see PAT permissions in docs
npm run dev
```

Ensure `copilot` CLI is installed and authenticated:

```bash
gh extension install github/gh-copilot
gh auth login
```

## Limitations & Future Work

- **Synchronous execution** — `copilot_dispatch` blocks the tool-call loop until the browser task completes (or times out). The assistant cannot do other work while waiting. A future async callback mechanism would allow the agent to dispatch a browser task and continue the conversation.
- **Single task at a time** — only one `copilot_dispatch` can run concurrently. Overlapping calls will compete for the same browser profile.
- **Timeout ceiling** — complex multi-page workflows may exceed the default 2-minute timeout. Increase `COPILOT_TIMEOUT_MS` for longer tasks, but be aware the user is waiting.
- **No streaming feedback** — the user sees nothing until the task completes. Intermediate progress reporting would improve UX for long-running tasks.
- **VNC security** — x11vnc runs without authentication. Do not expose port 5900 to the public internet.
- **GitHub CLI auth** — the container needs a valid `GH_TOKEN` at runtime. Token refresh and expiry are not currently handled.
