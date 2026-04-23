import { test, expect, type Page } from '@playwright/test';
import { skipOnboardingIfPresent } from './helpers';

/**
 * D-21 full happy-path E2E (02-05 Plan Task 4) — the Phase 2 acceptance gate.
 *
 * Flow:
 *   1. Signup new user -> /h empty state.
 *   2. Create first home "TestHouse" -> redirect to /h/[homeId].
 *   3. Manage areas -> Whole Home auto-created by PB hook is visible.
 *   4. Add Kitchen area.
 *   5. Open Kitchen -> "+ Add task".
 *   6. Create a weekly CYCLE task "Wipe benches" using the Weekly
 *      quick-select. The quick-select button is type="button" so it
 *      MUST NOT submit the form prematurely.
 *   7. Assert next-due renders in MMM d, yyyy format (timezone-correct,
 *      via date-fns-tz).
 *   8. Create a quarterly ANCHORED task "Quarterly air-con" with
 *      anchor_date=today -> assert next-due displayed.
 *   9. Logout -> /login.
 *  10. Log back in -> land on TestHouse (last-viewed HOME-03).
 *  11. Navigate to Kitchen -> "Wipe benches" still present.
 *
 * Plus a second spec proving the archive flow removes the task from the
 * active list (TASK-06).
 *
 * Flakiness mitigations:
 *   - Dynamic email per test via Date.now() + random suffix.
 *   - Next-due assertion uses a MMM d, yyyy *pattern* rather than an
 *     exact date string — timezone + CI clock drift would make exact
 *     date equality brittle.
 *   - Uses role/accessibility selectors where possible for robustness.
 */

async function signup(page: Page, email: string, pw: string, name = 'Full Test') {
  await page.goto('/signup');
  await page.fill('[name=name]', name);
  await page.fill('[name=email]', email);
  await page.fill('[name=password]', pw);
  await page.fill('[name=passwordConfirm]', pw);
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/h$/);
}

test('D-21 full happy path: signup -> home -> area -> cycle task -> anchored task -> logout -> login -> last-viewed', async ({
  page,
}) => {
  const email = `tasks-full-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.com`;
  const pw = 'password123';
  await signup(page, email, pw);

  // Create first home
  await page.click('text=Create your first home');
  await expect(page).toHaveURL(/\/h\/new$/);
  await page.fill('[name=name]', 'TestHouse');
  await page.click('button[type=submit]');
  // 05-03: new home redirects to /onboarding — skip to dashboard.
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}\/onboarding$/);
  await skipOnboardingIfPresent(page);
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}$/);
  // Phase 9 hides the HomeSwitcher when the user has a single home; the
  // home name lives in the page h1 instead. Probe the h1 — URL match
  // alone doesn't confirm the dashboard hydrated.
  await expect(
    page.getByRole('heading', { level: 1, name: /TestHouse/ }),
  ).toBeVisible();

  // Manage areas -> Whole Home present, add Kitchen.
  // (Phase 3 replaced the home dashboard's "Manage areas" link with the
  // three-band BandView. Navigate directly to the areas route — retained
  // from Phase 2.)
  const homeUrlAfterCreate = page.url();
  await page.goto(homeUrlAfterCreate + '/areas');
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}\/areas$/);
  await expect(page.locator('[data-area-name="Whole Home"]').first()).toBeVisible();

  await page.click('text=Add area');
  await page.fill('[name=name]', 'Kitchen');
  await page.click('button:has-text("Create area")');
  await expect(page.locator('[data-area-name="Kitchen"]').first()).toBeVisible();

  // Open Kitchen
  const kitchenRow = page.locator('[data-area-name="Kitchen"]').first();
  await kitchenRow.getByRole('link', { name: 'Kitchen' }).click();
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}\/areas\/[a-z0-9]{15}$/);
  const kitchenUrl = page.url();

  // Create "Wipe benches" weekly cycle task
  await page.click('text=Add task');
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}\/tasks\/new/);
  await page.fill('[name=name]', 'Wipe benches');

  // Click the Weekly quick-select BEFORE anything else — this is the
  // type="button" guard check from plan verification. If it were
  // type="submit" it would submit the form here with an empty name
  // (well, "Wipe benches" is filled; but earlier without a name we'd get
  // a schema error). We at least verify clicking Weekly does NOT
  // navigate away.
  await page.click('button:has-text("Weekly")');
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}\/tasks\/new/); // still here

  await page.click('button:has-text("Create task")');

  // Redirected back to the Kitchen area page; task is visible
  await expect(page).toHaveURL(new RegExp(kitchenUrl.replace(/^https?:\/\/[^/]+/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'));
  await expect(page.locator('text=Wipe benches').first()).toBeVisible();

  // Next-due renders in MMM d, yyyy format — assert a pattern, not an
  // exact date, to survive CI clock + timezone drift.
  const firstNextDue = await page.locator('time').first().textContent();
  expect(firstNextDue).toMatch(/^[A-Z][a-z]{2} \d+, \d{4}$/);

  // Create a quarterly ANCHORED task with today as the anchor
  await page.click('text=Add task');
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}\/tasks\/new/);
  await page.fill('[name=name]', 'Quarterly air-con');
  await page.click('button:has-text("Quarterly")');

  // Switch to anchored mode
  await page.click('input[value="anchored"]');

  // The anchor-date field now renders conditionally; fill with today
  const today = new Date().toISOString().slice(0, 10); // yyyy-MM-dd
  await page.fill('[name=anchor_date]', today);

  await page.click('button:has-text("Create task")');

  // Both tasks visible in the Kitchen area now
  await expect(page.locator('text=Wipe benches').first()).toBeVisible();
  await expect(page.locator('text=Quarterly air-con').first()).toBeVisible();

  // Both time elements present
  await expect(page.locator('time')).toHaveCount(2);

  // Logout -> /login
  await page.click('[aria-label=Account]');
  await page.click('text=Log out');
  await expect(page).toHaveURL(/\/login/);

  // Log back in -> lands on TestHouse (last-viewed HOME-03).
  await page.fill('[name=email]', email);
  await page.fill('[name=password]', pw);
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}$/);
  // Phase 9 hides the HomeSwitcher for single-home users; h1 carries
  // the home name.
  await expect(
    page.getByRole('heading', { level: 1, name: /TestHouse/ }),
  ).toBeVisible();

  // Re-navigate to Kitchen; task still there (data persisted).
  const homeUrlAfterLogin = page.url();
  await page.goto(homeUrlAfterLogin + '/areas');
  await page
    .locator('[data-area-name="Kitchen"]')
    .first()
    .getByRole('link', { name: 'Kitchen' })
    .click();
  await expect(page.locator('text=Wipe benches').first()).toBeVisible();
});

test('archive task removes it from the area active list', async ({ page }) => {
  const email = `tasks-archive-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.com`;
  const pw = 'password123';
  await signup(page, email, pw, 'Archive Test');

  // Create home
  await page.click('text=Create your first home');
  await page.fill('[name=name]', 'ArchiveHouse');
  await page.click('button[type=submit]');
  // 05-03: new home redirects to /onboarding — skip to dashboard.
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}\/onboarding$/);
  await skipOnboardingIfPresent(page);
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}$/);

  // Create Laundry area — navigate directly to /areas (Phase 3 removed
  // the home-dashboard "Manage areas" link; the route is retained).
  const archiveHomeUrl = page.url();
  await page.goto(archiveHomeUrl + '/areas');
  await page.click('text=Add area');
  await page.fill('[name=name]', 'Laundry');
  await page.click('button:has-text("Create area")');
  await expect(page.locator('[data-area-name="Laundry"]').first()).toBeVisible();

  // Open Laundry, add a Monthly task
  await page
    .locator('[data-area-name="Laundry"]')
    .first()
    .getByRole('link', { name: 'Laundry' })
    .click();
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}\/areas\/[a-z0-9]{15}$/);
  const laundryUrl = page.url();

  await page.click('text=Add task');
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}\/tasks\/new/);
  await page.fill('[name=name]', 'Clean dryer lint');
  await page.click('button:has-text("Monthly")');
  await page.click('button:has-text("Create task")');

  // Redirected back to Laundry page; task is visible there.
  await expect(page).toHaveURL(
    new RegExp(
      laundryUrl.replace(/^https?:\/\/[^/]+/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$',
    ),
  );
  await expect(page.locator('text=Clean dryer lint').first()).toBeVisible();

  // Open the task detail page -> Archive
  await page.click('text=Clean dryer lint');
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}\/tasks\/[a-z0-9]{15}$/);
  await page.click('button:has-text("Archive task")');

  // After archive we redirect back to the Laundry area page.
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}\/areas\/[a-z0-9]{15}$/);

  // The archived task NO LONGER appears in the active list; empty-state
  // message is shown. Use getByText with exact to avoid matching the
  // CardDescription "No tasks yet. Add the first one." which is a
  // different element on the page.
  await expect(page.locator('text=Clean dryer lint')).toHaveCount(0);
  await expect(page.getByText('No tasks yet.', { exact: true })).toBeVisible();
});
