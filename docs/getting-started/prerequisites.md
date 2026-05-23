---
title: Prerequisites
parent: Getting Started
nav_order: 1
---

# Prerequisites

You need a small amount of tooling on your local machine and at least one OpenAI key. Twilio is optional and only required if you plan to wire up real phone calls or SMS.

## Required

| Tool | Version | Notes |
|---|---|---|
| **Node.js** | 18 or newer | Tested on Node 18 and 20. `node --version` |
| **npm** | comes with Node | The repo uses `package-lock.json` |
| **OpenAI API key** | — | Used for the Responses API, Realtime API, and embeddings |

## Optional

| Tool | When you need it |
|---|---|
| **Twilio account + number** | Inbound phone calls, SMS sending/receiving |
| **ngrok** (or any public tunnel) | Exposing your local server to Twilio webhooks |
| **Mem0 API key** | If you want hosted long-term memory instead of the local adaptive memory only |
| **Deepgram API key** | Used by the dev "walkie" voice route |
| **GitHub PAT** | Required to run the embedded browser agent (Copilot CLI) |

## Operating system

The backend is plain Node and runs anywhere Node runs. macOS and Linux are the primary development targets. Windows works fine via WSL2.

## What you don't need

- **No separate frontend build.** The vanilla HTML/JS frontend in `client/` is served by the same Express server as static files. There's no Next.js or React build step anymore.
- **No global database.** SQLite is used via `better-sqlite3` and lives in `runtime-data/db/assistant.sqlite`.
- **No Ruby/Bundler** — only needed if you want to preview the docs site locally (GitHub Pages builds it for you on push).

Next: [Installation](../installation/).
