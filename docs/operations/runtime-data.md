---
title: Runtime data
parent: Operations
nav_order: 2
---

# Runtime data

All persistent non-database state lives under `runtime-data/`. Override the location with the `RUNTIME_DATA_DIR` env var (used in production to point at a mounted volume).

## Layout

```
runtime-data/
├── db/
│   └── assistant.sqlite           # sessions, conversations, events, thoughtflow artifacts
├── notes.json                     # note store
├── mcp-servers.json               # MCP server list
├── agent-policies.json            # per-agent tool allowlists
├── adaptations.edits.json         # live agent prompt/config edits
├── memory-config.json             # memory subsystem config
├── voice-presets/                 # named voice configurations
├── thoughtflow/                   # D2 run artifacts
├── browser-profile/               # Playwright profile for browser agent
├── copilot-home/                  # Copilot CLI home dir
└── copilot-workdir/               # Copilot CLI working dir
```

## Resolution pattern

Every module that touches runtime-data resolves its path the same way:

```ts
const dir = process.env.RUNTIME_DATA_DIR
  ? path.join(process.env.RUNTIME_DATA_DIR, 'subdir')
  : path.join(__dirname, '...', 'runtime-data', 'subdir');
```

## Resetting

For local dev you can wipe `runtime-data/` and re-run install. Don't do this in production — you'll lose memories, notes, MCP config, and conversation history.

## Backups

Everything in this directory is plain JSON or SQLite. Stop the app before taking a filesystem-level tarball so the SQLite database and JSON files are captured consistently. For a live system, use SQLite's backup API or a storage snapshot rather than copying only `assistant.sqlite` while writes are active.

## SQLite journal mode

Local development defaults to WAL for concurrency. When `RUNTIME_DATA_DIR` is set, Delegate 1 assumes the runtime may be a mounted volume and defaults to rollback `DELETE` mode with `busy_timeout = 5000`.

Do not use WAL for the production database on Azure Files or another SMB-backed mount. WAL depends on shared-memory and locking semantics that SMB does not reliably provide and can corrupt the database. Keep `SQLITE_JOURNAL_MODE=DELETE` for those deployments and verify backups with:

```sql
PRAGMA journal_mode;
PRAGMA quick_check;
```

A healthy mounted production database should report `delete` and `ok`, with no persistent `assistant.sqlite-wal` or `assistant.sqlite-shm` files.
