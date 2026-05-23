---
title: HTTP endpoints
parent: Reference
nav_order: 2
---

# HTTP endpoints

Selected REST surface. Most paths require an authenticated session; the **public paths** below are explicitly excluded from auth (see `src/server/middleware/auth.ts`).

## Public (no auth)

| Path | Purpose |
|---|---|
| `GET /install`, `GET /install.html`, `POST /api/install` | First-launch install flow |
| `GET /auth/status` | Auth/configured state |
| `GET /health`, `GET /ready` | Health checks |
| `GET /build-info.json` | Build metadata |
| `GET /public-url` | Echoes the configured `PUBLIC_URL` |
| `GET/POST /twiml` | Twilio voice webhook |
| `POST /sms` | Twilio SMS webhook |
| `POST /api/copilot/callback` | Copilot CLI callback |

## Auth

| Method | Path | Purpose |
|---|---|---|
| POST | `/login` | Sign in |
| POST | `/logout` | Sign out |
| POST | `/api/auth/password` | Change admin password |

## Adaptations

| Method | Path |
|---|---|
| GET | `/api/adaptations` |
| GET | `/api/adaptations/:id` |
| POST | `/api/adaptations/:id` |
| POST | `/api/adaptations.reload` |

## Config

| Method | Path |
|---|---|
| GET | `/api/config` |
| PUT | `/api/config` |
| DELETE | `/api/config/:key` |

## Conversations / events

| Method | Path |
|---|---|
| GET | `/api/conversations` |
| GET | `/api/conversations/:id` |
| GET | `/api/conversations/:id/events` |

## Tools & agents

| Method | Path |
|---|---|
| GET | `/tools`, `/catalog/tools` |
| GET | `/agents` |
| GET | `/agents/:id/tools` |

## MCP

| Method | Path |
|---|---|
| GET | `/api/mcp/config` |
| POST | `/api/mcp/config` |

## Memory

| Method | Path |
|---|---|
| GET | `/api/memories` |
| DELETE | `/api/memories/:id` |
| GET | `/memory-config` |
| PUT | `/memory-config` |

## Notes

| Method | Path |
|---|---|
| GET | `/api/notes`, `/notes/:id` |
| GET | `/api/notes/:id` |
| POST | `/api/notes` |
| PUT | `/api/notes/:id` |
| DELETE | `/api/notes/:id` |

## Logs

| Method | Path |
|---|---|
| GET | `/api/logs` |

## Thoughtflow

| Method | Path |
|---|---|
| GET | `/thoughtflow/viewer` |
| GET | `/thoughtflow/viewer/:id` |
| GET | `/thoughtflow/raw/:id.d2` |
| GET | `/thoughtflow/:id.:ext` |

## Dev

| Method | Path |
|---|---|
| POST/GET/DELETE | `/_dev/walkie/logs` |
| GET | `/_dev/walkie/logs/stream` |
| POST | `/_dev/walkie/voice` |
| POST | `/deepgram/token` |

For WebSocket endpoints see [WebSocket endpoints](../websocket-endpoints/).
