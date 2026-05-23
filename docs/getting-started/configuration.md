---
title: Configuration
parent: Getting Started
nav_order: 3
---

# Configuration

Delegate 1 keeps two layers of configuration:

1. **`.env`** — a small handful of bootstrap variables read directly from the process environment.
2. **In-app config store** (`runtime-data/config.*`) — most settings (API keys, Twilio creds, email creds, feature toggles) are stored encrypted via the in-app `configService` and edited through the **Settings** UI or the install flow.

The `configService` reads from the in-app store **first** and falls back to `process.env` if the key isn't set. That means you can put any of the keys below in `.env` for dev, or set them via the UI later.

## 1. Create your `.env`

```bash
cp .env.example .env
```

The starter `.env.example` is intentionally tiny:

```bash
# Notification endpoint for startup script (optional)
CALL_MY_PHONE_ENDPOINT=https://your-notify-endpoint.example.com/notify
CALL_MY_PHONE_SECRET=your-secret-api-key-here

# Browser agent (Copilot CLI + Playwright) — optional
# BROWSER_ENABLED=true
# COPILOT_GITHUB_TOKEN=your-github-pat-here
# VNC_PASSWORD=delegate

FRONTEND_URL=http://localhost:8081
STARTUP_NOTIFY_MESSAGE="Servers started successfully"
```

Add at minimum your OpenAI key:

```bash
OPENAI_API_KEY=sk-...
```

You can also set the admin password here to skip the install flow:

```bash
ADMIN_PASSWORD=changeme
```

## 2. First-launch install flow

The first time you start the server, the **Install** page at `/install` runs through a guided setup that writes most config into the encrypted in-app store:

![Install / sign-in page](../assets/screenshots/login.png)

The install flow sets the admin password (used for the login page above) and lets you paste in API keys without putting them in `.env`.

## 3. Edit settings any time

Once installed and logged in, **Settings** (`/settings.html`) lets you edit every config key:

![Settings page](../assets/screenshots/settings.png)

See the full table in **[Reference → Env Vars](../../reference/env-vars/)**.

## Bootstrap vs in-app config

| Setting | Where to set | Reason |
|---|---|---|
| `PORT` | `.env` only | Read once on startup |
| `RUNTIME_DATA_DIR` | `.env` only | Determines where the in-app store lives |
| `ADMIN_PASSWORD` | `.env` *or* install flow | Either works |
| `OPENAI_API_KEY`, `TWILIO_*`, `EMAIL_*`, `MEM0_*`, `DEEPGRAM_API_KEY`, `PUBLIC_URL`, `BROWSER_ENABLED`, `COPILOT_GITHUB_TOKEN`, etc. | Settings UI *or* `.env` | UI is preferred for prod (encrypted at rest) |

Next: [First run](../first-run/).
