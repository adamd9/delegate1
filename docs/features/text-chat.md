---
title: Text chat
parent: Features
nav_order: 1
---

# Text chat

Text chat is the quickest way to have a conversation with your delegate. Open the app and you're ready — just type a message and get a response.

![Chat console](../assets/screenshots/home.png)

## What you can do

Your delegate isn't just a chatbot — it can take action on your behalf from a single message. Examples of what you can ask:

- **Search the web** — "What's the latest news on…"
- **Take notes** — "Remember that my flight is on Friday at 9am"
- **Look things up** — "What did I tell you about the Henderson project?"
- **Check your calendar** — available when your calendar is connected via MCP (see [Tools](../tools/))
- **Answer complex questions** — for harder tasks, your delegate can bring in a more powerful reasoning process automatically, and will show you what it's doing while it works

## How to use it

1. Open the app at [http://localhost:8081](http://localhost:8081).
2. Type your message in the text box at the bottom of the screen.
3. Press **Enter** (or click **Send**).
4. Your delegate's reply appears in real time — you'll see the words arrive as it writes them, rather than waiting for the full response.

When your delegate uses a tool (such as searching the web or reading your notes), you'll see that activity appear inline in the conversation so you know what it's doing.

## Watching the same conversation from multiple tabs

You can open the app in several browser tabs at once — all tabs show the same conversation as it happens. This is handy if you want to monitor a long-running task from a second screen while continuing to chat in another tab.

## Starting fresh

If you want to wipe the conversation and start over, use the **Reset session** option. This clears all in-progress context. (During development, this can also be triggered via `POST /session/reset`.)

---

See also: [Agents & policies](../agents-and-policies/), [Tools](../tools/).

## Technical details

| Path | Type | Purpose |
|---|---|---|
| `/chat` | WebSocket | Real-time message channel between browser and server |

The browser opens a persistent WebSocket connection (a low-latency two-way pipe) to `/chat`. Messages are exchanged as JSON:

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

Responses are streamed token-by-token via the OpenAI Responses API. Tool calls and supervisor escalations emit additional event types. The chat channel shares the same session, memory, and tool registry as all other channels (voice, phone).

- Server handler: `src/session/chat.ts`
- Frontend: `client/index.html` (plain HTML/JS)
