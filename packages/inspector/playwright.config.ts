import { defineConfig, devices } from '@playwright/test';

// The e2e is one smoke test of the whole wire (CLI, server, page), and it starts its own CLI and
// builds the page in beforeAll, so there is no webServer here. `*.e2e.ts` keeps vitest's
// `*.test.ts` glob off these files.
export default defineConfig({
  testDir: './e2e',
  testMatch: '*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
