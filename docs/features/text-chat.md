---
title: Text chat
parent: Features
nav_order: 1
---

# Text chat

The default Delegate 1 channel: a WebSocket-backed chat console served at `/`.

![Chat console](../assets/screenshots/home.png)

## What it does

- Streams base agent responses token-by-token via the OpenAI Responses API.
- Shares the same session, memory, and tools as every other channel.
- Surfaces tool calls and supervisor escalations in the conversation pane.

## Endpoint

| Path | Type | Purpose |
|---|---|---|
| `/chat` | WebSocket | Client sends `{ type: 'chat.message', content }`, server responds with `{ type: 'chat.response', content, conversation_id }` plus interim deltas |

The server-side handler is `src/session/chat.ts`. The frontend is plain HTML/JS in `client/index.html`.

## Protocol

**Client → server**

```json
{ "type": "chat.message", "content": "Hello!" }
```

**Server → client (streaming)**

```json
{ "type": "chat.response.delta", "content": "Hel" }
{ "type": "chat.response.delta", "content": "lo!" }
{ "type": "chat.response", "content": "Hello!", "conversation_id": "..." }
```

Tool calls and supervisor escalations emit additional event types — see the source for the full list.

## Multiple connections

Unlike voice/phone (single active connection), the chat WebSocket allows multiple clients to be connected simultaneously, all observing the same conversation thread.

## Reset

`POST /session/reset` clears the in-memory session — useful in tests and during development.

See also: [Agents & policies](../agents-and-policies/), [Tools](../tools/).
