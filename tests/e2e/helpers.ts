import { expect, type Page } from '@playwright/test';

/**
 * E2E helpers — shared across Phase 2-5 Playwright specs (05-03 Task 3).
 *
 * `skipOnboardingIfPresent(page)` handles the Phase 5 regression: createHome
 * now sets `homes.onboarded=false` so the first visit to /h/[homeId]
 * redirects to /h/[homeId]/onboarding. Existing E2E suites pre-dating
 * Phase 5 assumed signup → createHome → lands on /h/[homeId] dashboard.
 * Rather than bolt-on onboarding assertions across 7 specs, this helper
 * centralizes the skip-or-continue logic:
 *
 *   1. If the current URL ends with `/onboarding`, click the Skip all
 *      button and wait for the redirect back to /h/[homeId].
 *   2. Otherwise, no-op (e.g. existing homes backfilled onboarded=true
 *      by migration 1714953604 won't be here — they hit the dashboard
 *      directly).
 *
 * The helper returns the home URL (no `/onboarding` suffix) so callers
 * can continue with their existing flow.
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
