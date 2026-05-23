---
title: Getting Started
nav_order: 2
has_children: true
permalink: /getting-started/
---

# Getting Started

Delegate 1 is designed to run **in the cloud, 24/7** — so your delegate is always reachable whether you call it, text it, or email it. You deploy it once on a small cloud server, point your phone number and email address at it, and it's yours.

{: .note }
> You don't need to be a developer, but you do need to be comfortable with a terminal and a cloud server. The setup takes around 30–45 minutes end to end.

---

## What you'll need

| Requirement | Notes |
|---|---|
| **A cloud server** | Any Linux VPS with Docker installed — DigitalOcean, Hetzner, AWS Lightsail, etc. 1 vCPU / 1 GB RAM is enough to start. |
| **A domain name** (or subdomain) | So your delegate has a real URL — e.g. `delegate.yourdomain.com` |
| **OpenAI API key** | Powers the AI, voice, and memory. [Get one here.](https://platform.openai.com/api-keys) |

Phone and email are optional extras — you can add them after the base setup is working.

---

## Deploy (30 minutes)

### 1. Set up your server

Spin up a Linux VPS from any cloud provider. Once you have SSH access, install Docker:

```bash
curl -fsSL https://get.docker.com | sh
```

### 2. Create a project folder and `.env`

```bash
mkdir delegate1 && cd delegate1
curl -o .env https://raw.githubusercontent.com/adamd9/delegate1/main/.env.example
nano .env
```

Add your OpenAI key and your public URL:

```bash
OPENAI_API_KEY=sk-...
FRONTEND_URL=https://delegate.yourdomain.com
ADMIN_PASSWORD=choose-a-strong-password
```

### 3. Download the compose file and start

```bash
curl -o docker-compose.yml https://raw.githubusercontent.com/adamd9/delegate1/main/docker-compose.yml
docker compose up -d
```

Docker pulls the pre-built image from GitHub and starts the container. Your data is stored in `./data/runtime-data` — back that folder up to keep your notes and memories.

Verify it's running:

```bash
docker compose logs -f
# look for: Server running on http://localhost:8081
```

### 4. Point your domain at the server

In your DNS provider, add an **A record** pointing your subdomain to your server's IP address. Then set up a reverse proxy to terminate SSL and forward traffic to port 8081.

**Using Caddy (easiest — handles SSL automatically):**

```bash
apt install -y caddy
```

Edit `/etc/caddy/Caddyfile`:

```
delegate.yourdomain.com {
    reverse_proxy localhost:8081
}
```

```bash
systemctl reload caddy
```

Caddy automatically obtains and renews an HTTPS certificate. Done.

### 5. Sign in and complete setup

Open `https://delegate.yourdomain.com` in your browser. Log in with the `ADMIN_PASSWORD` you set, then use **Settings** to add any additional API keys (Twilio for phone/SMS, email credentials, etc.).

![Sign-in page](../assets/screenshots/login.png)

Your delegate is live.

![Chat console](../assets/screenshots/home.png)

---

## What's next

With your delegate running in the cloud, the features that make it most useful are the real-world channels:

- **[Phone & SMS](../features/phone/)** — give your delegate a real phone number via Twilio
- **[Email](../features/email/)** — connect an email address so you can email it like a colleague
- **[Memory](../features/memory/)** — your delegate remembers you across conversations automatically
- **[MCP servers](../features/mcp-servers/)** — connect tools like calendars and task managers

---

## Running locally (developers only)

If you want to run Delegate 1 on your own machine for development or testing:

```bash
git clone https://github.com/adamd9/delegate1.git
cd delegate1
npm install
cp .env.example .env  # add OPENAI_API_KEY
npm run dev           # starts on http://localhost:8081
```

See [Prerequisites](prerequisites/), [Installation](installation/), and [Configuration](configuration/) for the full detail.

{: .warning }
> Running locally means your delegate is only reachable when your computer is on. Phone and email channels require a public URL — use ngrok or similar for local testing.
