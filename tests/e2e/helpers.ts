import { expect, type Page, type Locator } from '@playwright/test';

/**
 * E2E helpers — shared across Playwright specs.
 *
 * v1.3 TESTFIX-04 (2026-04-24): added `signup`, `waitForServerAction`,
 * and `waitForRHFConditional` as flake-resistant primitives. New specs
 * SHOULD prefer these over inline equivalents so future framework
 * timing changes (React 19 concurrent rendering, Next.js RSC streaming,
 * PB auth-refresh races) land in one place.
 *
 * Existing inline `signup()` copies across the 10 per-spec files are
 * NOT force-migrated — they still work because the fix behind the
 * historical flake lives at
 * `lib/pocketbase-server.ts::createServerClientWithRefresh` (Phase 36).
 * Migration is opportunistic: touch when you're in a file for other
 * reasons.
 */

/**
 * PocketBase REST base URL for direct API calls from specs. Defaults to
 * the dev PocketBase; against a container set E2E_PB_URL (normally equal
 * to E2E_BASE_URL, since the app's Caddy proxies /api/* to PocketBase).
 */
export const PB_URL = process.env.E2E_PB_URL ?? 'http://127.0.0.1:8090';

// ─── Generic shared primitives ─────────────────────────────────────

/**
 * Submit a form / click a button that triggers a Next.js Server Action
 * and wait for the POST response AND optionally the expected URL settle.
 *
 * Use this instead of `await page.click(...); await expect(...).toHaveURL(...)`
 * when the action mutates data that's then re-queried — the naive
 * pattern can fire the next `goto` / assertion before the Server
 * Action's POST finishes committing.
 */
export async function waitForServerAction(
  page: Page,
  opts: {
    trigger: () => Promise<void>;
    urlPattern?: RegExp;
    timeout?: number;
  },
): Promise<void> {
  const timeout = opts.timeout ?? 15_000;
  const posted = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' && r.status() >= 200 && r.status() < 400,
    { timeout },
  );
  await opts.trigger();
  await posted;
  if (opts.urlPattern) {
    await page.waitForURL(opts.urlPattern, { timeout });
  }
}

/**
 * Wait for an RHF-controlled conditional-reveal to finish rendering.
 *
 * Pattern: clicking `triggerLocator` flips a form-state value that
 * conditionally renders `revealLocator`. React 19 commits the
 * conditional render on a subsequent tick; under headless Chromium
 * the assertion can fire too early. This helper confirms the trigger
 * state first, then waits for the reveal with a generous timeout.
 *
 * Use for: checkboxes that reveal dependent fields, radio groups
 * that toggle conditional blocks, any "flip A → wait for B" pattern.
 */
export async function waitForRHFConditional(
  triggerLocator: Locator,
  revealLocator: Locator,
  opts: {
    triggerState?: 'checked' | 'unchecked';
    revealTimeout?: number;
  } = {},
): Promise<void> {
  const state = opts.triggerState ?? 'checked';
  const revealTimeout = opts.revealTimeout ?? 10_000;
  if (state === 'checked') {
    await expect(triggerLocator).toBeChecked({ timeout: 5_000 });
  } else {
    await expect(triggerLocator).not.toBeChecked({ timeout: 5_000 });
  }
  await expect(revealLocator).toBeVisible({ timeout: revealTimeout });
}

// ─── Canonical signup (flake-resistant) ────────────────────────────

/**
 * Signup a fresh user and wait until /h (or a sub-route) is reached.
 *
 * Behind the scenes `signupAction` (lib/actions/auth.ts) creates a PB
 * user, issues an auth token, sets the pb_auth cookie, and redirects
 * to `/h`. The (app) layout calls `createServerClientWithRefresh`
 * which re-validates the token. Phase 36 TESTFIX-03 added a retry
 * inside that refresh to tolerate transient PB load, so this helper
 * needs only a generous `waitForURL` to absorb the retry window.
 *
 * Prefer this over inline `page.click(...) + toHaveURL` in new specs.
 */
export async function signup(
  page: Page,
  email: string,
  password: string,
  name: string = 'Test User',
): Promise<void> {
  await page.goto('/signup');
  await page.fill('[name=name]', name);
  await page.fill('[name=email]', email);
  await page.fill('[name=password]', password);
  await page.fill('[name=passwordConfirm]', password);
  await page.click('button[type=submit]');
  // Generous timeout catches the one-retry window inside
  // createServerClientWithRefresh. Flake budget: zero.
  await page.waitForURL(/\/h(\/|$)/, { timeout: 15_000 });
}

// ─── Onboarding-wizard helper (pre-existing) ───────────────────────

/**
 * `skipOnboardingIfPresent(page)` handles the Phase 5 regression:
 * createHome now sets `homes.onboarded=false` so the first visit to
 * /h/[homeId] redirects to /h/[homeId]/onboarding. Existing E2E
 * suites pre-dating Phase 5 assumed signup → createHome → lands on
 * /h/[homeId] dashboard. Rather than bolt-on onboarding assertions
 * across 7 specs, this helper centralizes the skip-or-continue
 * logic:
 *
 *   1. If the current URL ends with `/onboarding`, click the Skip
 *      all button and wait for the redirect back to /h/[homeId].
 *   2. Otherwise, no-op.
 *
 * Returns the home URL (no `/onboarding` suffix).
 */
export async function skipOnboardingIfPresent(page: Page): Promise<string> {
  const url = page.url();
  const onOnboarding = /\/h\/[a-z0-9]{15}\/onboarding(?:\?|$)/.test(url);
  if (!onOnboarding) {
    return url;
  }

  // Click "Skip all" — the wizard wires it via data-skip-all.
  await page.click('[data-skip-all]');
  // After skipOnboarding + router.push, URL should land on /h/[homeId].
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}$/);
  return page.url();
}
