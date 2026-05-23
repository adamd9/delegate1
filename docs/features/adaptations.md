---
title: Adaptations
parent: Features
nav_order: 13
---

# Adaptations

Adaptations are **live edits** to agent behavior that don't require a redeploy. Think of them as runtime overrides to prompts and small config values, stored in `runtime-data/adaptations.edits.json`.

![Adaptations UI](../assets/screenshots/adaptations.png)

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/adaptations` | List edits |
| GET | `/api/adaptations/:id` | Get one |
| POST | `/api/adaptations/:id` | Upsert |
| POST | `/api/adaptations.reload` | Force reload from disk |

UI: `/adaptations.html`.

## How they apply

`src/adaptations.ts` loads edits at startup and exposes a lookup that the agent configs consult when building their instructions. You'll see a version number logged:

```
[startup] Adaptations initialized (version: 2 )
```

Hot reload via `POST /api/adaptations.reload` after editing the JSON directly.

## When to use them

- Iterating on the base or supervisor prompt without rebuilding.
- A/B testing a small instruction change against production.
- Hot-patching a misbehavior live.

For permanent changes, fold the edit back into `src/agentConfigs/`.
