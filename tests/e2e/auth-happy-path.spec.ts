import { test, expect } from '@playwright/test';

/**
 * Auth happy-path E2E (02-03 Plan Task 3).
 *
 * Scope: authentication + session cookie only. Homes/areas/tasks flows
 * land in 02-04 / 02-05 and will extend this suite.
 *
 * Covers:
 *   - Signup -> auto-login -> redirect /h.
 *   - Session persists across reload.
 *   - pb_auth cookie is HttpOnly (T-02-03-04 mitigation verified).
 *   - Logout clears cookie -> /login.
 *   - Protected route /h redirects unauthed to /login?next=%2Fh.
 *   - Re-login lands on /h.
 *   - Guest-only /login redirects authed to /h.
 *
 * Plus two negative tests for validation + auth-error plumbing.
 *
 * NOTE: password reset (AUTH-04) is NOT exercised here — the flow requires
 * a real SMTP server and is documented as a manual smoke step in the
 * plan's user_setup section.
 */

test('signup -> logout -> login -> session persists across reload', async ({
  page,
  context,
}) => {
  const uniqueEmail = `auth-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.com`;
  const pw = 'password1234';

  // Signup
  await page.goto('/signup');
  await page.fill('[name=name]', 'Auth Test');
  await page.fill('[name=email]', uniqueEmail);
  await page.fill('[name=password]', pw);
  await page.fill('[name=passwordConfirm]', pw);
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/h$/);

  // Session persists across reload
  await page.reload();
  await expect(page).toHaveURL(/\/h$/);

  // Cookie is HttpOnly (T-02-03-04)
  const cookies = await context.cookies();
  const pbAuth = cookies.find((c) => c.name === 'pb_auth');
  expect(pbAuth).toBeDefined();
  expect(pbAuth?.httpOnly).toBe(true);

  // Logout via account menu
  await page.click('[aria-label=Account]');
  await page.click('text=Log out');
  await expect(page).toHaveURL(/\/login/);

  // Protected route redirects unauthed -> /login?next=%2Fh
  await page.goto('/h');
  await expect(page).toHaveURL(/\/login\?next=%2Fh/);

  // Re-login from the redirected /login page
  await page.fill('[name=email]', uniqueEmail);
  await page.fill('[name=password]', pw);
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/h$/);

  // Guest-only /login redirects when authed
  await page.goto('/login');
  await expect(page).toHaveURL(/\/h$/);
});

test('signup with invalid email shows field error', async ({ page }) => {
  await page.goto('/signup');
  await page.fill('[name=name]', 'Bad Email');
  await page.fill('[name=email]', 'not-an-email');
  await page.fill('[name=password]', 'password1234');
  await page.fill('[name=passwordConfirm]', 'password1234');
  await page.click('button[type=submit]');
  // Still on /signup with an email error visible
  await expect(page).toHaveURL(/\/signup/);
  await expect(page.locator('text=/valid email/i').first()).toBeVisible();
});

test('login with wrong password shows form error', async ({ page }) => {
  await page.goto('/login');
  await page.fill(
    '[name=email]',
    `nonexistent-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.com`,
  );
  await page.fill('[name=password]', 'wrongpass123');
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator('text=/Invalid email or password/i')).toBeVisible();
});
