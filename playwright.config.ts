import { defineConfig } from '@playwright/test';

export default defineConfig({
  timeout: 60_000,
  expect: { timeout: 30_000 },
  // We don't need browsers for WS-only tests, but Playwright test runner is convenient
  // Run tests sequentially by default to avoid cross-talk through shared server state
  fullyParallel: false,
  reporter: [['list']],
});
