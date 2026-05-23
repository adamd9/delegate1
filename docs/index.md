---
title: Home
layout: home
nav_order: 1
description: "Delegate 1 — an AI executive assistant you call, text, and email."
permalink: /
---

# Meet your Delegate
{: .fs-9 }

An AI executive assistant you interact with the same way you'd work with a human one — call it, text it, email it, and hand off tasks. It acts on your behalf so you don't have to.
{: .fs-6 .fw-300 }

[Get started](getting-started/){: .btn .btn-primary .fs-5 .mb-4 .mb-md-0 .mr-2 }
[View on GitHub](https://github.com/adamd9/delegate1){: .btn .fs-5 .mb-4 .mb-md-0 }

---

## Is this for me?

Delegate 1 is a **self-hosted personal AI assistant** — designed for an individual who wants their own AI that they can reach the way they'd reach a human assistant. It's a solo tool: one person, one conversation thread, one set of memories. If you're a developer who wants to run their own AI on their own infrastructure, and you want it woven into the channels you already use (your phone, your email), this is built for you.

{: .warning }
> **Single-user by design.** Delegate 1 holds one conversation at a time. There is no per-user isolation or multi-tenant support. It's intentionally built as a personal assistant for one person, not a shared service.

---

## The idea

Most AI assistants lock you into a chat window. Delegate 1 works the way a trusted human executive assistant does — over the channels you already use. It has a phone number you can call or text, an email address you can write to, and a browser voice interface for when you're at your desk. Wherever you reach it, it's the same conversation.

You *delegate* to it. It acts, reports back, and remembers.

---

## What makes it different

### Natural channels — call, text, email
Delegate 1 holds a real phone number (via Twilio) and an email address. You can call it, send it an SMS, or fire off an email the same way you'd contact a human assistant. It replies through the same channel, or whichever makes most sense for the task.

### One conversation, every channel
There are no separate sessions. A single conversational context persists across every mode — pick up the phone mid-email thread, switch to text, carry on. The thread is always the same thread.

### Voice-first, interface-free
The design favours conversation over clicking. Interactions are driven by natural language and prompting logic rather than UI flows. When richer output is needed, the delegate uses **notes** (a persistent store it can write to and share) rather than forcing you back to a screen.

### Memory as infrastructure
Memory isn't something you trigger — it runs continuously in the background. While the conversation unfolds, the memory system reviews the thread, performs semantic lookups, and silently injects relevant context into the agent's window. Memories strengthen over time through recurrence; similar memories consolidate rather than bloat. Less relevant fragments fade. The result is an assistant that *knows you* without you having to remind it.

### ThoughtFlow telemetry
Every agent run produces a **ThoughtFlow** — a visual D2 diagram that maps every input, model call, tool invocation, and output in that turn. When you want to understand *why* the delegate did what it did, ThoughtFlow shows you the full decision path.

### Higher-order processing modes
Not every task fits in a single real-time turn. When a request needs more reasoning, the delegate escalates to a more powerful supervisor model. When a task needs a browser — filling a form, logging into a service, scraping a page — it dispatches a **Copilot** agent that runs with full browser access. You can observe or take over the browser session at any time.

---

## Where to go next

| | |
|---|---|
| **[Getting Started](getting-started/)** | Prerequisites, install, configuration, first run |
| **[Features](features/)** | Deep dives — phone, email, voice, memory, notes, MCP, thoughtflow, adaptations, browser agent |
| **[Operations](operations/)** | Deployment, runtime data, testing, logging |
| **[Reference](reference/)** | Env vars, HTTP/WS endpoints, architecture |
