---
title: Task delivery recovery
parent: Release Notes
nav_order: 2
---

# Task delivery recovery

- **Status:** Draft for review

## What changed

Copilot task pages now show whether the result is queued, being delivered, delivered, or failed. Failed delivery shows the channel, attempt count, next automatic retry and error. It does not display the destination address or phone number.

When automatic delivery cannot recover, **retry delivery** starts a fresh delivery attempt for the same completed task turn. It does not rerun the Copilot task or create a second result. Delivered results cannot be retried accidentally.

Coding tasks now link to the exact pushed GitHub commit. The task records the commit SHA and branch during its existing git-sync step, then shows **view commit** in the header. Git credentials are stripped from remote URLs before anything is stored or sent to the browser.

## Recovery coverage

Delivery tests now cover exhausted attempts, manual reset, invalid retries and restart resumption. Manual context compaction tests now cover an upstream API failure, an empty compaction result and a capsule-refresh failure.

The failure rules remain conservative: a failed compaction keeps the previous Responses chain, while a successful compaction remains usable even if its separate continuity-capsule refresh fails.