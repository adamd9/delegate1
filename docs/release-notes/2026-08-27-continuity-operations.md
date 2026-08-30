---
title: Continuity and operations
parent: Release Notes
nav_order: 1
---

# Continuity and operations

- **Status:** Draft for review
- **Deployed foundation:** `21f73ac`
- **Operational metrics:** not deployed yet

## What changed

Delegate 1 now treats text, voice, phone, SMS and email as one continuous relationship timeline. Switching channel no longer implies starting over, and older history loads in stable pages without rebuilding everything already on screen.

Model working context is bounded separately from that durable history. The chat shows how close the active Responses chain is to its automatic compaction threshold. **Compact now** performs official OpenAI compaction, keeps the returned replacement context until a later turn succeeds, and refreshes the durable continuity capsule. Voice continues to use Realtime retention-ratio truncation.

Late memory retrieval is quieter. Delayed results are deduplicated and filtered before they become visible, so repeated material does not appear merely because a background lookup finished late.

Copilot task results now return automatically to the destination chosen at dispatch. Delivery is tied to the exact task and exact terminal turn, survives restart, and retries up to three times without permanently suppressing a later completion from the same task.

History loading now uses a stable time-and-ID cursor. Older pages are prepended atomically and expand to include the start of an activity span when necessary, preventing half-rendered activity groups.

## Operational follow-up

This draft adds one authenticated operations endpoint rather than a separate monitoring database. It reports:

- Manual and automatic compaction outcomes.
- Copilot delivery successes, failed attempts and retries.
- Timeline page volume and span-driven page expansion.
- Surfaced and suppressed memory results.

Manual compaction attempts now leave durable started, completed or failed records. Timeline page counters and detailed memory deduplication counters are explicitly marked as since-restart figures.

## What this means

The visible timeline remains complete even when a model's shorter working context is compacted or truncated. Operators can now check whether compaction, delivery, paging and memory filtering are behaving as designed before deciding to add more architecture.

No second timeline, analytics database or client-side merge engine was introduced.

## Verification

The context policy, checkpoint/continuity, operations aggregation and TypeScript build checks pass locally. The deployed foundation was previously verified at commit `21f73ac`.

The authenticated production **Compact now** exercise passed on 30 August 2026. An idle text turn established an eligible Responses chain, manual compaction returned `200`, input usage dropped from 5,375 tokens to 123, `latestCompaction.source` became `manual`, and the continuity capsule refreshed from the compacted context. A follow-up turn correctly recalled the exact pre-compaction phrase and established a new eligible Responses chain, confirming that the replacement input was consumed successfully without losing continuity.