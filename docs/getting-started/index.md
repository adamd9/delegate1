---
title: Getting Started
nav_order: 2
has_children: true
permalink: /getting-started/
---

# Getting Started

{: .note }
> Delegate 1 is a **personal AI assistant** you run yourself. This guide gets you from zero to a working text-chat session in about 15 minutes. Phone, SMS, and email channels take a few extra steps covered in the [Features](../features/) section.

## What you'll need

| Requirement | Notes |
|---|---|
| **Node.js 18+** | `node --version` to check |
| **OpenAI API key** | Used for the AI model, voice, and memory. [Get one here.](https://platform.openai.com/api-keys) |
| **Git** | To clone the repo |

That's the minimum for text chat. Phone and email need Twilio and a mail account respectively — you can add those later.

---

## Quick start (15 minutes)

### 1. Clone and install

```bash
git clone https://github.com/adamd9/delegate1.git
cd delegate1
npm install
```

### 2. Set your OpenAI key

```bash
echo "OPENAI_API_KEY=sk-..." > .env
```

Or copy the example file first:

```bash
cp .env.example .env
# then edit .env and add your key
```

### 3. Start the server

```bash
npm run dev
```

You should see:

```
Server running on http://localhost:8081
[startup] Tools registry initialized
```

### 4. Open the app and sign in

Open [http://localhost:8081](http://localhost:8081) in your browser.

On the very first launch you'll be guided through a short setup screen to set an admin password. After that, log in with that password.

### 5. Start chatting

The home screen is a chat console. Type a message and press Enter — your delegate will respond. That's it.

![Chat console](../assets/screenshots/home.png)

---

## What's next

Once text chat is working, explore the features that matter to you:

- **[Phone & SMS](../features/phone/)** — give your delegate a real phone number via Twilio
- **[Email](../features/email/)** — connect an email address so you can email it like a colleague
- **[Memory](../features/memory/)** — your delegate remembers you across conversations automatically
- **[MCP servers](../features/mcp-servers/)** — connect tools like calendars, task managers, and more
- **[ThoughtFlow](../features/thoughtflow/)** — see a visual map of how your delegate handled any conversation

---

## Detailed guides

- [Prerequisites](prerequisites/) — full requirements list
- [Installation](installation/) — repo layout and build steps
- [Configuration](configuration/) — `.env`, settings UI, and the install flow
- [First run & UI tour](first-run/) — a walkthrough of every page in the app
