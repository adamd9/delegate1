---
title: Reference
nav_order: 5
has_children: true
permalink: /reference/
---

# Reference

Technical lookup tables and protocol details.

## [Environment variables](env-vars/)

Every configuration key the app reads, where it's read from (`.env` vs the in-app encrypted store), whether it's required or optional, and what it does. If you're wondering what to put in your `.env` or what a setting in the UI maps to in code, this is the page.

## [HTTP endpoints](api-endpoints/)

The REST API surface: session reset, configuration, logs, notes, MCP management, and the install/auth endpoints. Useful if you're scripting against the server or building an integration.

## [WebSocket endpoints](websocket-endpoints/)

Protocol details for the three WebSocket connections: `/chat` (text), `/call` (Twilio phone, G.711 µ-law audio), and `/browser-call` (browser voice, PCM16 24 kHz). Covers message shapes, connection lifecycle, and audio format specs.

## [Model calling flows](model-calling-flows/)

Sequence diagrams showing the exact chain of API calls for each type of turn: a simple text message, a `web_search` tool call, a voice barge-in, and a phone call. Useful when you need to understand latency, token usage, or where something in the pipeline is failing.

## [Architecture](architecture/)

The single-session singleton design, the single base agent, the tool registry, and the WebSocket routing. The right page to read before making significant changes to the codebase.
