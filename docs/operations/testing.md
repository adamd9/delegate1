---
title: Testing
parent: Operations
nav_order: 3
---

# Testing

Three test surfaces, no test framework — everything uses plain Node `assert` or Playwright.

## E2E (Playwright)

```bash
npm run test:e2e                  # headless
npm run test:e2e:headed           # see the browser
```

Requirements:

- The dev server must be running (`npm run dev`)
- A valid `OPENAI_API_KEY`
- A single Playwright worker is enforced (`workers: 1` in `playwright.config.ts`) because the backend has one global session

Each test resets the session via `POST /session/reset` before running.

### Single file / single test

```bash
npx @playwright/test@1.55.0 test tests/e2e/chat.spec.ts
npx @playwright/test@1.55.0 test -g "web_search"
```

## Unit tests

```bash
npm run test:unit                 # memory deduplicator
npm run test:copilot              # copilot-cli dispatch
```

These are plain `ts-node` scripts — they exit non-zero on assertion failure.

## Voice pipeline

```bash
npm run test:voice
```

Runs `src/voice/voicePipeline.test.ts`.

## No linter

There is no ESLint/Prettier config in the repo. Type-checking happens via `npm run build`.
