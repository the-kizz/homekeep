import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3001',
    trace: 'on-first-retry',
  },
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: 'npm run build && npm run start',
    url: 'http://localhost:3001',
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
