---
title: Adaptations
parent: Features
nav_order: 13
---

# Adaptations

Adaptations let you tune how your delegate thinks and responds — without touching any code or restarting anything. Think of them as personality and behaviour tweaks that you set intentionally: a tone, a default assumption, a style rule.

![Adaptations UI](../assets/screenshots/adaptations.png)

## What you can do with adaptations

You can tell your delegate things like:

- "Always be concise — no padding, no filler."
- "My name is Adam, refer to me by name."
- "When scheduling anything, default to AEST timezone."
- "Avoid suggesting paid tools unless I ask."
- "When summarising, always use bullet points."

Any instruction you'd give a human assistant to shape how they work with you belongs here.

## How to add or edit an adaptation

1. Click **Adaptations** in the sidebar menu.
2. Add a new entry or edit an existing one.
3. Save — that's it.

Changes take effect immediately. The delegate picks up your adaptations on the very next conversation turn; no restart required.

## Adaptations vs. memory

These are two different things:

- **Memory** is what the delegate *learns* about you over time — facts, preferences, and context it picks up from your conversations.
- **Adaptations** are explicit instructions *you set on purpose* — rules and behaviours you want applied consistently.

If you want something to always happen, use an adaptation. If you just want the delegate to remember a fact, let memory handle it.

---

## Technical details

Adaptations are stored in `runtime-data/adaptations.edits.json`. The backend loads them at startup and re-reads them on each conversation turn, so edits made via the UI apply immediately without a redeploy.

### API endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/adaptations` | List all adaptations |
| GET | `/api/adaptations/:id` | Get a single adaptation |
| POST | `/api/adaptations/:id` | Create or update an adaptation |
| POST | `/api/adaptations.reload` | Force reload from disk (useful after direct file edits) |

The agent configs in `src/agentConfigs/` consult the adaptations lookup when building their instructions each turn. For changes you want to make permanent in the codebase, fold them back into `src/agentConfigs/` directly.
