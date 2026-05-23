---
title: Home
layout: home
nav_order: 1
description: "Delegate 1 — single-session, multi-channel AI assistant."
permalink: /
---

# Delegate 1
{: .fs-9 }

A single-session, multi-channel AI assistant. One conversation thread across text chat, browser voice, phone calls, SMS, and email.
{: .fs-6 .fw-300 }

[Get started now](getting-started/){: .btn .btn-primary .fs-5 .mb-4 .mb-md-0 .mr-2 }
[View on GitHub](https://github.com/adamd9/delegate1){: .btn .fs-5 .mb-4 .mb-md-0 }

---

## What is Delegate 1?

Delegate 1 maintains **one unified conversation thread** across every channel you connect to it. Pick up a phone call where a text chat left off; switch to browser voice without losing context. It's built around a single mutable session object on the backend, an OpenAI Responses API-driven two-tier agent (base + supervisor), and a pluggable tool registry that includes Model Context Protocol (MCP) servers.

## Where to go next

| Section | What's there |
|---|---|
| [Getting Started](getting-started/) | Prerequisites, install, configuration, first run |
| [Features](features/) | One page per capability — chat, voice, phone, SMS, email, memory, notes, MCP, tools, agents, browser agent, thoughtflow, adaptations |
| [Operations](operations/) | Deployment, runtime data, testing, logging |
| [Reference](reference/) | Env vars, HTTP/WS endpoints, architecture, model calling flows |

## Architecture in 30 seconds

- **Single backend process** (Node + TypeScript, Express + WebSocket) serves both the API and the static frontend in `client/`.
- **One session singleton** owned by the backend — all channels (text, voice, phone, SMS, email) read and write it.
- **Two-tier agents**: a fast *base* agent handles simple turns; it escalates harder turns to a *supervisor* that loops over tools (web search, MCP, local handlers).
- **SQLite** for conversation events and thoughtflow; **runtime-data/** directory for everything else (notes, MCP config, policies, voice presets).

{: .note }
> Setting up GitHub Pages? After merging this docs folder, enable Pages: **Settings → Pages → Source: Deploy from a branch → `main` / `/docs`**.
