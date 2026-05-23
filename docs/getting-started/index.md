---
title: Getting Started
nav_order: 2
has_children: true
permalink: /getting-started/
---

# Getting Started

Delegate 1 is designed to run **in the cloud, 24/7** — so your delegate is always reachable whether you call it, text it, or email it. You deploy it once on a small cloud server, point your phone number and email address at it, and it's yours.

{: .note }
> You don't need to be a developer, but you do need to be comfortable with a terminal, a cloud server (any VPS will do), and a few API keys. The setup takes around 30–45 minutes end to end.

---

## What you'll need

| Requirement | Notes |
|---|---|
| **A cloud server** | Any VPS with Docker installed — DigitalOcean, Hetzner, AWS Lightsail, etc. 1 vCPU / 1 GB RAM is enough to start. |
| **A domain name** (or subdomain) | So your delegate has a real URL — e.g. `delegate.yourdomain.com` |
| **OpenAI API key** | Powers the AI model, voice, and memory. [Get one here.](https://platform.openai.com/api-keys) |
| **Git** | To clone the repo to your server |

Phone and email are optional extras you can add after the base setup is working.

---

## Deploy with Docker (the standard path)

### 1. Clone the repo on your server

SSH into your server, then:

```bash
git clone https://github.com/adamd9/delegate1.git
cd delegate1
```

### 2. Create your `.env`

```bash
cp .env.example .env
nano .env   # or vim, your choice
```

At minimum, add:

```bash
OPENAI_API_KEY=sk-...
FRONTEND_URL=https://delegate.yourdomain.com
```

Set `ADMIN_PASSWORD` here or you'll be prompted to create one on first login.

### 3. Start the container

```bash
docker compose -f docker-compose.browser.yml up -d
```

This builds the image (first run takes a few minutes), starts the server on port 8081, and mounts a persistent volume at `./local-volumes/runtime-data` for all your data.

### 4. Expose it to the internet

Put a reverse proxy (nginx, Caddy, Traefik) in front of port 8081, terminate SSL, and point your domain at the server. Caddy with automatic HTTPS is the easiest option:

```
delegate.yourdomain.com {
    reverse_proxy localhost:8081
}
```

### 5. Sign in and complete setup

Open `https://delegate.yourdomain.com` in your browser. You'll be walked through a short setup screen to confirm your admin password and paste in any API keys you want to add (Twilio for phone/SMS, email credentials, etc.).

![Sign-in / setup page](../assets/screenshots/login.png)

Once you're in, your delegate is live.

![Chat console](../assets/screenshots/home.png)

---

## What's next

With your delegate running in the cloud, the features that make it most useful are the real-world channels:

- **[Phone & SMS](../features/phone/)** — give your delegate a real phone number via Twilio
- **[Email](../features/email/)** — connect an email address so you can email it like a colleague
- **[Memory](../features/memory/)** — your delegate remembers you across every conversation automatically
- **[MCP servers](../features/mcp-servers/)** — connect tools like calendars and task managers

---

## Running locally (developer mode)

If you're a developer and want to run Delegate 1 on your own machine for testing or customisation, see:

- [Prerequisites](prerequisites/) — what you need installed
- [Installation](installation/) — clone and build steps
- [Configuration](configuration/) — `.env` and settings UI
- [First run & UI tour](first-run/) — walkthrough of the app

{: .warning }
> Running locally means your delegate is only reachable when your computer is on. Phone and email channels require a public URL (use ngrok or similar for local testing).
