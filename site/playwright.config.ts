import { defineConfig } from '@playwright/test';

// The deck's e2e: real scroll gestures against the production build. `*.e2e.ts` keeps vitest's
// `*.test.ts` glob off these files.
const PORT = 4329;

export default defineConfig({
  testDir: './e2e',
  testMatch: '*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Full Chromium in its new headless mode, not the headless shell: the same compositor and input
    // pipeline as the browser people use.
    channel: 'chromium',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `pnpm build && node e2e/serve.ts ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
});
