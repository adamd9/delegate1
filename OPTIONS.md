# OPTIONS

## 1) Inline emitter + JSONL persistence (recommended)
- Add `tfEmitter` with in-memory session, write each step to `<session_id>.jsonl` under `websocket-server/thoughtflow/`.
- Pros: Simple, append-only, robust to crashes. Easy post-processing.
- Cons: One-file-per-session management, need rotation/cleanup.

## 2) In-memory store + periodic snapshot to `.json`
- Keep full TF in memory; flush on session end to single JSON file.
- Pros: One artifact per session, mirrors schema exactly.
- Cons: Data loss on crash; bigger memory footprint for long sessions.

## 3) Pluggable adapter (file now, SQLite later)
- Interface `ITFStore` with file adapter v1; future DB adapter.
- Pros: Future-proof.
- Cons: Slightly higher complexity now.
