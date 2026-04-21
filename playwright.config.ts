import { defineConfig } from '@playwright/test';

/**
 * Playwright config — boots BOTH PocketBase and Next.js in parallel for
 * local / CI E2E runs. When E2E_BASE_URL is set (container-integration
 * mode), we assume both are already running and skip the webServer array.
 *
 * PB is booted via scripts/dev-pb.js so tests exercise the same migrations
 * + hooks as local dev (updated in 02-01 with --hooksDir).
 *
 * Next is built + started (not `next dev`) to run against the real
 * standalone output — this catches proxy.ts compilation issues that only
 * surface in `next build`.
 *
 * 04-03: globalSetup provisions a PB superuser so acceptInvite's admin-
 * client auth works. E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD are injected
 * into the Next.js process env so `createAdminClient` reads matching
 * creds. The constants are duplicated with tests/e2e/global-setup.ts —
 * keep them in sync if either changes.
 */
const E2E_ADMIN_EMAIL = 'e2e-admin@test.local';
const E2E_ADMIN_PASSWORD = 'e2e-admin-password-12345';
const SITE_URL = 'http://localhost:3001';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  globalSetup: process.env.E2E_BASE_URL
    ? undefined
    : require.resolve('./tests/e2e/global-setup.ts'),
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3001',
    trace: 'on-first-retry',
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: 'node scripts/dev-pb.js',
          url: 'http://127.0.0.1:8090/api/health',
          timeout: 60_000,
          reuseExistingServer: !process.env.CI,
        },
        {
          command: 'npm run build && npm run start',
          url: 'http://localhost:3001',
          timeout: 120_000,
          reuseExistingServer: !process.env.CI,
          env: {
            PB_ADMIN_EMAIL: E2E_ADMIN_EMAIL,
            PB_ADMIN_PASSWORD: E2E_ADMIN_PASSWORD,
            SITE_URL,
            // 06-02 D-09: silence the in-process cron in E2E runs. The
            // server-action synchronous ntfy hooks still fire — but every
            // E2E user has an empty ntfy_topic by default, so sendNtfy
            // never POSTs. This just prevents the hourly cron from logging
            // `[scheduler] started` noise into the E2E server output.
            DISABLE_SCHEDULER: 'true',
          },
        },
      ],
});
