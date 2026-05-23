---
title: First run
parent: Getting Started
nav_order: 4
---

# First run

## Start the server

```bash
npm run dev
```

The `dev` script first kills anything bound to port `8081`, then runs `nodemon` watching `src/**/*` and `.env`, executing `ts-node src/server.ts`. You should see something like:

```
[mcpClient] Initializing MCP client
Server running on http://localhost:8081
[mcpAdapter] MCP discovery complete. 5 tool(s) registered.
[startup] Tools registry initialized
```

For a production-style run, build first then start:

```bash
npm run build
npm start
```

## Sign in

Open <http://localhost:8081>. If this is the first launch, you'll be sent through `/install` to set an admin password. After that, every visit hits the sign-in page:

![Sign-in page](../assets/screenshots/login.png)

The password you set (or `ADMIN_PASSWORD` from `.env`) gets you in.

## The UI tour

### Chat (home)

The default landing page is a chat console wired to the `/chat` WebSocket. Send a message and it goes straight to the base agent.

![Chat console](../assets/screenshots/home.png)

### Voice

`/voice.html` is the browser voice channel — PCM16 24 kHz audio over the `/browser-call` WebSocket, with real-time streaming and barge-in.

![Voice page](../assets/screenshots/voice.png)

There's also `/voice-direct.html` for a more bare-bones direct test of the voice pipeline:

![Voice Direct page](../assets/screenshots/voice-direct.png)

### Settings

`/settings.html` edits every config key (API keys, Twilio, email, feature toggles). Values flagged `sensitive` are encrypted at rest and masked when read back.

![Settings](../assets/screenshots/settings.png)

### Logs

`/logs.html` streams the in-process log buffer — handy when you're debugging an agent turn or a tool call.

![Logs](../assets/screenshots/logs.png)

### MCP servers

`/mcp-servers.html` manages remote MCP servers. The list reflects `runtime-data/mcp-servers.json`, and the discovered tools show up in the registry.

![MCP servers](../assets/screenshots/mcp-servers.png)

### Notes

`/notes-list.html` is the simple note-store browser. Notes are also surfaced as tools to the agents.

![Notes](../assets/screenshots/notes-list.png)

### Thoughtflow

`/thoughtflow/viewer` renders D2 diagrams of recent agent runs (artifacts in `runtime-data/thoughtflow/`).

![Thoughtflow viewer](../assets/screenshots/thoughtflow.png)

### Adaptations

`/adaptations.html` exposes runtime "edits" you can apply to agent behavior without a redeploy. Edits are stored in `runtime-data/adaptations.edits.json`.

![Adaptations](../assets/screenshots/adaptations.png)

## What now?

Head to [Features](../../features/) for one-page-per-capability deep dives, or jump straight to:

- [Phone (Twilio) setup](../../features/phone/)
- [Email setup](../../features/email/)
- [MCP servers](../../features/mcp-servers/)
