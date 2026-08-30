---
title: Operational metrics
parent: Operations
nav_order: 5
---

# Operational metrics

Delegate 1 reports a small set of operational signals from the records it already owns. It does not copy conversation history into a separate analytics store.

## Endpoint

`GET /api/session/operations` requires an authenticated session. It reports the last 24 hours by default. Use `?hours=N` to request between 1 hour and 30 days.

The response covers:

| Area | What is measured |
|---|---|
| Context | Current usage and capsule status, manual compaction attempts, successes and failures, and automatic compactions |
| Copilot delivery | Successful deliveries, failed attempts, attempts that were retries, and attempt success/retry rates |
| Timeline paging | Initial and older-page requests, events sent, span-boundary expansion and largest page since the current process started |
| Memory | Durable surfaced/suppressed counts, final late-result outcomes for the requested window, and detailed deduplication counters since process start |

Windowed figures come from SQLite. Metrics marked `process_runtime` reset when the server restarts. Rates are returned as values from `0` to `1`, or `null` when there are no observations.

## Manual compaction check

Run this against an idle conversation that has completed at least one Responses turn:

1. Sign in to the production chat.
2. Confirm `GET /api/session/context` returns `active: true` and `canCompact: true`.
3. Select **Compact now**, or send `POST /api/session/context/compact` with the authenticated browser session.
4. Confirm the response is `200` and `latestCompaction.source` is `manual`.
5. Send a follow-up message that depends on earlier context and confirm the answer remains continuous.
6. Check `GET /api/session/operations?hours=1` for one successful manual attempt with no new failure.

The compacted replacement input is retained until that follow-up turn succeeds. A failed follow-up does not discard it. Manual attempt lifecycle records are durable, so a failed compaction remains visible after restart.

## Reading the numbers

Use these metrics to decide whether further work is needed:

- Repeated compaction failures warrant checking OpenAI errors and active-turn conflicts.
- Delivery failures with eventual success indicate retries are working; final failed tasks need destination or credential investigation.
- Large `expandedEvents` or `maxPageEvents` values identify activity spans that force pages beyond the configured limit.
- High memory suppression with low surfaced counts usually means late retrieval is avoiding repeated material as intended.

These are operational signals, not user analytics. They contain counts and current status, not message text, memory contents or delivery targets.