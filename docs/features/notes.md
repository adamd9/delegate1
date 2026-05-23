---
title: Notes
parent: Features
nav_order: 7
---

# Notes

Notes are your delegate's notebook — a place to store anything worth keeping. Unlike [memory](../memory/), which is about learning who *you* are, notes are about storing *content*: a research summary, a to-do list, a draft, a recipe, a set of instructions, or anything else that deserves its own document.

![Notes list](../assets/screenshots/notes-list.png)

## What notes are for

Your delegate can write notes, read them back, and share them with you. Some examples of how this works in practice:

- **You ask it to capture something** — *"Take a note: call the plumber tomorrow"* — and it writes a note you can find later.
- **You ask it to recall something** — *"What notes do you have on the project?"* — and it reads back what it has stored.
- **It uses a note as a canvas** — when a response is too long or rich for a chat message (a research report, a structured plan, a full recipe), your delegate writes it to a note and points you there instead.

## Browsing your notes

Open **`/notes-list.html`** in your browser to see all notes. From there you can:

- Search by keyword
- Open any note to read the full content
- Copy a direct link to a note to share or bookmark it
- Delete notes you no longer need

## Notes vs memory

| | Memory | Notes |
|---|---|---|
| Stores… | Facts about *you* | Content and documents |
| Written by… | Delegate automatically | Delegate on request (or automatically when producing long output) |
| Example | "User prefers concise answers" | "Research summary: renewable energy trends" |

These two stores complement each other — memory shapes how your delegate talks to you; notes hold what it's working on with you.

## Technical details

- Notes are stored as JSON in `runtime-data/notes.json` (override path with `$RUNTIME_DATA_DIR`).
- Implementation: `src/noteStore.ts`.
- Single-note view: `/notes/:id` (HTML page).
- REST API:

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/notes` | List all notes |
| GET | `/api/notes/:id` | Get one note |
| POST | `/api/notes` | Create a note |
| PUT | `/api/notes/:id` | Update a note |
| DELETE | `/api/notes/:id` | Delete a note |

- Note tools are registered via the local tool provider so the delegate can read and write notes directly during a conversation.
