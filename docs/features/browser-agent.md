---
title: Browser agent
parent: Features
nav_order: 11
---

# Browser agent

An embedded browser-driving agent powered by **GitHub Copilot CLI** running against a real Chromium controlled by Playwright. It's disabled by default.

## Enable it

In `.env`:

```bash
BROWSER_ENABLED=true
COPILOT_GITHUB_TOKEN=ghp_...
VNC_PASSWORD=delegate          # password for the VNC viewer
```

Or set the same keys via Settings.

You'll know it's on when you see (instead of `BROWSER_ENABLED not set, skipping copilot tool registration`):

```
[copilot-cli] registering tool ...
```

## UI

- `/copilot.html` — chat with the browser agent
- `/vnc.html` — live VNC view of the controlled Chromium (password = `VNC_PASSWORD`)

![Copilot agent page](../assets/screenshots/copilot.png)

## Architecture

- The agent runs Copilot CLI inside a working directory (`runtime-data/copilot-workdir/`).
- Playwright is launched with a persistent profile under `runtime-data/browser-profile/`.
- A small dispatch layer (`src/copilot-agent/`) marshals tasks between the model and Copilot CLI.

## Running in Docker

The browser agent works best inside the dedicated `Dockerfile.browser` / `docker-compose.browser.yml` setup — that image includes Chromium and a VNC server.

## Tests

```bash
npm run test:copilot
```

## Caveats

- Requires a valid GitHub PAT with the right scopes.
- Network egress from the controlled browser is unrestricted — be cautious about what you ask it to do.
