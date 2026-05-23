---
title: Installation
parent: Getting Started
nav_order: 2
---

# Installation

Delegate 1 is a **single Node package**. Clone, install, and run.

{: .note }
> Older docs referenced a `webapp/` + `websocket-server/` + `voice-client/` split. That structure no longer exists. The whole project is now one package at the repo root, with the frontend served as static files from `client/`.

## 1. Clone the repo

```bash
git clone https://github.com/adamd9/delegate1.git
cd delegate1
```

## 2. Install dependencies

```bash
npm install
```

This installs everything for both the backend (TypeScript/Express) and the static frontend it serves.

## 3. Verify the build works

```bash
npm run build
```

This compiles TypeScript to `dist/` and copies non-TS assets (`twiml.xml`, `src/config/*`, `src/copilot-agent/*`).

If the build succeeds, you're ready to configure.

## Layout you'll see

```
delegate1/
├── src/                # backend TS sources
│   ├── server.ts       # entry point
│   ├── agentConfigs/   # base + supervisor agents
│   ├── tools/          # tool registry + handlers
│   ├── memory/         # adaptive memory
│   ├── voice/          # voice pipeline
│   ├── session/        # /chat /call /browser-call WS handlers
│   └── ...
├── client/             # static HTML/JS frontend (served by Express)
├── runtime-data/       # persisted state (notes, MCP config, voice presets, db/)
├── scripts/            # helper scripts (twilio, debug, port-killing)
├── tests/              # Playwright e2e + unit tests
└── docs/               # this documentation site
```

Next: [Configuration](../configuration/).
