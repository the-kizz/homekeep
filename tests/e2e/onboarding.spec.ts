import { test, expect, type Page } from '@playwright/test';
import { SEED_LIBRARY } from '../../lib/seed-library';

/**
 * 05-03 D-19 Phase 5 onboarding E2E — Suite A.
 *
 *   Scenario 1: Happy path
 *     new user → signup → create home → redirected to /onboarding →
 *     skip 3 seeds + edit 1 seed (change freq to 14) + click
 *     "Add N tasks" → land on dashboard → N-3 tasks visible across
 *     bands → re-visit /onboarding → redirects back to dashboard
 *     (onboarded=true).
 *
 *   Scenario 2: Skip all
 *     new user → signup → create home → /onboarding → "Skip all" →
 *     /h/[id] with 0 tasks (empty state CTA) → re-visit /onboarding
 *     redirects to /h/[id].
 *
 * Flake mitigations:
 *   - Unique email per scenario via Date.now() + random suffix
 *   - URL regex uses {15} for PB id length to avoid /h/new ambiguity
 *   - Submit actions use waitForURL to await server-redirect completion
 *   - Importing SEED_LIBRARY lets us hit real seed_ids rather than
 *     hard-coding strings (refactor-proof)
 */

const stamp = () =>
  `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

async function signup(
  page: Page,
  email: string,
  pw: string,
  name: string,
) {
  await page.goto('/signup');
  await page.fill('[name=name]', name);
  await page.fill('[name=email]', email);
  await page.fill('[name=password]', pw);
  await page.fill('[name=passwordConfirm]', pw);
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/h$/);
}

async function createHomeExpectOnboarding(
  page: Page,
  homeName: string,
): Promise<string> {
  await page.click('text=Create your first home');
  await expect(page).toHaveURL(/\/h\/new$/);
  await page.fill('[name=name]', homeName);
  await page.click('button[type=submit]');
  // After createHome → redirect to /h/[id] → dashboard redirects to
  // /onboarding (onboarded=false path). Wait for the final URL.
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}\/onboarding$/, {
    timeout: 10_000,
  });
  const url = page.url();
  const m = url.match(/\/h\/([a-z0-9]{15})\/onboarding/);
  if (!m) throw new Error(`bad onboarding url: ${url}`);
  return m[1];
}

test.describe.serial('Phase 5 Onboarding (D-19) — Suite A', () => {
  test('Scenario 1: happy path — wizard → skip 3 + edit 1 + submit → dashboard → revisit redirects away', async ({
    page,
  }) => {
    const pw = 'password123';
    const email = `onboarding-a1-${stamp()}@test.local`;
    await signup(page, email, pw, 'Olivia Onboarding');

    const homeId = await createHomeExpectOnboarding(
      page,
      'Phase 5 Onboarding E2E',
    );

    // Wizard visible.
    await expect(page.locator('[data-onboarding-wizard]')).toBeVisible();

    // Assert ~30 seed cards rendered. Library currently has 30 entries,
    // but a small drift window is left for future tuning.
    const seedCards = page.locator('[data-seed-id]');
    const count = await seedCards.count();
    expect(count).toBeGreaterThanOrEqual(25);
    expect(count).toBeLessThanOrEqual(40);
    expect(count).toBe(SEED_LIBRARY.length);

    // Default state: every card has data-seed-action="add".
    const addedCount = await page
      .locator('[data-seed-action="add"]')
      .count();
    expect(addedCount).toBe(count);

    // Pick 3 deterministic seed ids (first 3 from the library) and click
    // their Skip buttons.
    const skipSeedIds = SEED_LIBRARY.slice(0, 3).map((s) => s.id);
    for (const seedId of skipSeedIds) {
      const card = page.locator(`[data-seed-id="${seedId}"]`);
      await expect(card).toHaveAttribute('data-seed-action', 'add');
      await card.locator('[data-seed-skip]').click();
      await expect(card).toHaveAttribute('data-seed-action', 'skip');
    }

    // Edit the 4th seed (first non-skipped): change freq to 14.
    const editSeedId = SEED_LIBRARY[3].id;
    const editCard = page.locator(`[data-seed-id="${editSeedId}"]`);
    await editCard.locator('[data-seed-edit]').click();
    // Inline form appears — set freq input to 14 then Save.
    const freqInput = editCard.locator('input[name="frequency_days"]');
    await freqInput.fill('14');
    await editCard.locator('[data-seed-save]').click();
    // The card's data-frequency-days attr should now be 14.
    await expect(editCard).toHaveAttribute('data-frequency-days', '14');

    // CTA text reflects the remaining count (N - 3 = library - 3).
    const expectedAddCount = SEED_LIBRARY.length - 3;
    const wizard = page.locator('[data-onboarding-wizard]');
    await expect(wizard).toHaveAttribute(
      'data-selected-count',
      String(expectedAddCount),
    );

    // Submit.
    await page.click('[data-submit-seeds]');

    // Expect redirect to /h/[id] (NOT /onboarding).
    await page.waitForURL(new RegExp(`/h/${homeId}$`), { timeout: 15_000 });

    // Dashboard renders with the BandView.
    await expect(page.locator('[data-band-view]')).toBeVisible();

    // Some tasks present — at least one band populated (most seeds are
    // multi-day frequency and land in Horizon; short-freq seeds like
    // wipe-benches (3d) land in This Week). Don't assert exact counts —
    // the seed library can grow between phases.
    const visibleTaskRows = page.locator('[data-task-name]');
    const taskRowCount = await visibleTaskRows.count();
    expect(taskRowCount).toBeGreaterThan(0);

    // Re-visit /onboarding directly → dashboard redirect fires because
    // onboarded=true now.
    await page.goto(`/h/${homeId}/onboarding`);
    await expect(page).toHaveURL(new RegExp(`/h/${homeId}$`));
  });

  test('Scenario 2: skip all → dashboard empty state → revisit redirects away', async ({
    page,
  }) => {
    const pw = 'password123';
    const email = `onboarding-a2-${stamp()}@test.local`;
    await signup(page, email, pw, 'Sam Skipper');

    const homeId = await createHomeExpectOnboarding(page, 'Skip All E2E');

    await expect(page.locator('[data-onboarding-wizard]')).toBeVisible();

    // Click Skip all.
    await page.click('[data-skip-all]');

    // Redirects to /h/[id].
    await page.waitForURL(new RegExp(`/h/${homeId}$`), { timeout: 15_000 });

    // Dashboard present (empty state — no tasks).
    await expect(page.locator('[data-band-view]')).toBeVisible();
    // No task rows rendered.
    await expect(page.locator('[data-task-name]')).toHaveCount(0);

    // Re-visit /onboarding → redirect to /h/[id] (onboarded=true).
    await page.goto(`/h/${homeId}/onboarding`);
    await expect(page).toHaveURL(new RegExp(`/h/${homeId}$`));
  });
});
