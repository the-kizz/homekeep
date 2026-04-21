import { test, expect, type Page } from '@playwright/test';
import { skipOnboardingIfPresent } from './helpers';

/**
 * Homes + Areas happy-path E2E (02-04 Plan Task 3).
 *
 * Covers:
 *   - signup (new user) → /h empty state
 *   - "Create your first home" → form → redirect to /h/[homeId]
 *   - Whole Home auto-created by PB hook is visible on the Areas page
 *   - Add a new area (Kitchen)
 *   - Edit the Kitchen area (rename)
 *   - Whole Home row has NO delete affordance (AREA-02 UI guard)
 *
 * + a second spec for multi-home + HOME-03 last-viewed persistence.
 *
 * NOTE: drag-reorder is deliberately NOT in the E2E suite this plan
 * (flaky without raw mouse events / @dnd-kit/test-utils). The component
 * carries stable IDs (Pitfall 8) and the unit schema tests cover the
 * reorder server action surface. Manual VALIDATION.md will assert drag.
 * TODO(02-04): add drag-reorder E2E — requires @dnd-kit/test-utils or
 * raw mouse events.
 */

async function signup(page: Page, email: string, pw: string) {
  await page.goto('/signup');
  await page.fill('[name=name]', 'Home Test');
  await page.fill('[name=email]', email);
  await page.fill('[name=password]', pw);
  await page.fill('[name=passwordConfirm]', pw);
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/h$/);
}

test('create home → Whole Home auto-created → add Kitchen → edit → delete guard', async ({
  page,
}) => {
  const email = `homes-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.com`;
  await signup(page, email, 'password123');

  // Empty state CTA
  await page.click('text=Create your first home');
  await expect(page).toHaveURL(/\/h\/new/);

  // Fill and submit the home form (timezone defaults to Australia/Perth)
  await page.fill('[name=name]', 'Playwright House');
  await page.click('button[type=submit]');

  // 05-03: new home redirects to /onboarding; skip to land on dashboard.
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}\/onboarding$/);
  await skipOnboardingIfPresent(page);
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}$/);

  // Navigate to the Areas management page — Whole Home should be there.
  // (Phase 3 replaced the "Manage areas" home-dashboard link with the
  // BandView; the /areas route is retained from Phase 2.)
  const homeUrl = page.url();
  await page.goto(homeUrl + '/areas');
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}\/areas$/);
  await expect(page.locator('text=Whole Home')).toBeVisible();

  // Whole Home row MUST NOT expose a Delete affordance (AREA-02 UI guard)
  const wholeHomeRow = page.locator('[data-area-name="Whole Home"]').first();
  await expect(wholeHomeRow).toBeVisible();
  await expect(wholeHomeRow.locator('[aria-label=Delete]')).toHaveCount(0);
  await expect(
    wholeHomeRow.locator('[aria-label="Cannot delete Whole Home"]'),
  ).toHaveCount(1);

  // Add a new area via the "+ Add area" dialog
  await page.click('text=Add area');
  await page.fill('[name=name]', 'Kitchen');
  // Icon + color defaults (AREA_ICONS[0]/AREA_COLORS[0]) survive the submit
  // via the hidden inputs RHF's Controller renders.
  await page.click('button:has-text("Create area")');

  // New Kitchen row appears with a Delete affordance (non-system)
  const kitchenRow = page.locator('[data-area-name="Kitchen"]').first();
  await expect(kitchenRow).toBeVisible();
  await expect(kitchenRow.locator('[aria-label=Delete]')).toHaveCount(1);

  // Edit the Kitchen area — click its row link to land on the edit page
  await kitchenRow.getByRole('link', { name: 'Kitchen' }).click();
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}\/areas\/[a-z0-9]{15}$/);

  await page.fill('[name=name]', 'Kitchen & Dining');
  await page.click('button:has-text("Save changes")');

  // Return to /areas and verify the rename stuck
  await page.goto(page.url().replace(/\/[a-z0-9]+$/, ''));
  await expect(
    page.locator('[data-area-name="Kitchen & Dining"]').first(),
  ).toBeVisible();
});

test('multiple homes + last-viewed persistence (HOME-03 / HOME-04)', async ({
  page,
}) => {
  const email = `multi-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.com`;
  const pw = 'password123';
  await signup(page, email, pw);

  // Phase 3 replaced the home-page heading with the BandView — the home
  // name now surfaces via the HomeSwitcher button in the banner. Use that
  // as the visibility probe for "currently on this home".
  const header = page.getByRole('banner');
  const switcherFor = (name: RegExp) =>
    header.getByRole('button', { name });

  // First home
  await page.click('text=Create your first home');
  await page.fill('[name=name]', 'House A');
  await page.click('button[type=submit]');
  // 05-03: skip onboarding wizard to land on the dashboard.
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}\/onboarding$/);
  await skipOnboardingIfPresent(page);
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}$/);
  await expect(switcherFor(/House A/)).toBeVisible();

  // Switcher in the header now shows "House A" (once fresh user record is
  // re-fetched post-redirect). Open it via the banner's switcher button.
  await switcherFor(/House A/).click();
  await page.getByRole('menuitem', { name: /Create another home/ }).click();
  await expect(page).toHaveURL(/\/h\/new/);
  await page.fill('[name=name]', 'House B');
  await page.click('button[type=submit]');
  // 05-03: skip onboarding wizard on House B too.
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}\/onboarding$/);
  await skipOnboardingIfPresent(page);
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}$/);
  await expect(switcherFor(/House B/)).toBeVisible();

  // Switch back to House A via the HomeSwitcher dropdown. 04-03 added
  // an "Owner" badge inside the menuitem so the accessible name is now
  // "House A Owner"; use a prefix match instead of an exact-equality
  // regex.
  await switcherFor(/House B/).click();
  await page.getByRole('menuitem', { name: /^House A(?:\s+Owner)?$/ }).click();
  await expect(switcherFor(/House A/)).toBeVisible();

  // Log out and log back in — should land on House A (last-viewed).
  await page.click('[aria-label=Account]');
  await page.click('text=Log out');
  await expect(page).toHaveURL(/\/login/);

  await page.fill('[name=email]', email);
  await page.fill('[name=password]', pw);
  await page.click('button[type=submit]');

  // HOME-03: /h redirects to /h/[lastViewedId] which is House A.
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}$/);
  await expect(switcherFor(/House A/)).toBeVisible();
});
