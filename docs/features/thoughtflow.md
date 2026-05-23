---
title: Thoughtflow
parent: Features
nav_order: 12
---

# Thoughtflow

Thoughtflow is the observability layer for agent runs. Each run emits a D2 diagram artifact you can browse in a built-in viewer.

![Thoughtflow viewer](../assets/screenshots/thoughtflow.png)

## What gets recorded

- LLM calls (model, latency, prompt size)
- Tool invocations and results
- Memory reads/writes
- Supervisor escalations and loop iterations

Artifacts are written to `runtime-data/thoughtflow/` as `.d2` files plus rendered output.

## Endpoints

| Path | Purpose |
|---|---|
| `/thoughtflow/viewer` | Index of all runs |
| `/thoughtflow/viewer/:id` | View one run |
| `/thoughtflow/raw/:id.d2` | Raw D2 source |
| `/thoughtflow/:id.:ext` | Rendered artifact (e.g. `.svg`, `.png`) |

## Example runs

Reference diagrams (preserved with the repo, illustrating shapes you'll see):

- `detail-run1-llm.d2` — a basic LLM call
- `detail-run2-weathercall.d2` — a tool call sequence
- `detail-run3-memwrite.d2` — a memory write

## Debugging

Set `LEDGER_DEBUG=1` to get extra structured logging from the event ledger that backs thoughtflow.

See also: [Operations → Logging](../../operations/logging/).
