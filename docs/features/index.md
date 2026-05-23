---
title: Features
nav_order: 3
has_children: true
permalink: /features/
---

# Features

Delegate 1 is built around a single conversation thread that surfaces through many channels and capabilities. Each page below is a self-contained guide to one feature: what it does, how to enable it, where its code lives, and how to verify it's working.

## Channels

- **[Text chat](text-chat/)** — the default `/chat` WebSocket and browser console
- **[Voice](voice/)** — browser voice (PCM16 24 kHz) with barge-in
- **[Phone (Twilio)](phone/)** — inbound and outbound phone calls
- **[SMS](sms/)** — Twilio SMS in and out
- **[Email](email/)** — IMAP receiver + nodemailer sender

## Memory & data

- **[Memory](memory/)** — adaptive local memory
- **[Notes](notes/)** — persistent notes the agent can read and write

## Agents, tools, and integrations

- **[Agents & policies](agents-and-policies/)** — base + supervisor + per-agent allowlists
- **[Tools](tools/)** — registry, providers, handlers
- **[MCP servers](mcp-servers/)** — Model Context Protocol integration
- **[Browser agent](browser-agent/)** — Copilot CLI + Playwright sandbox

## Observability & customization

- **[Thoughtflow](thoughtflow/)** — D2 diagrams of agent runs
- **[Adaptations](adaptations/)** — live "edits" to agent behavior without redeploy
