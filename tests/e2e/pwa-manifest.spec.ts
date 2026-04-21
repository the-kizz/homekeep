import { test, expect } from '@playwright/test';

/**
 * 07-01 Task 2 — PWA manifest + HTTP banner E2E.
 *
 * Case A: public/manifest.webmanifest is served 200 by the Next.js
 * dev/prod server as a static file with JSON content (Next 16 infers
 * content-type from the .webmanifest extension, which may be
 * `application/manifest+json` OR a JSON fallback depending on server
 * — we accept either as long as the body parses and has name=HomeKeep).
 *
 * Case B: banner visible + dismiss persistence. Playwright's baseURL
 * is http://localhost:3001 (HTTP), so on a fresh signup + home create
 * the authed home layout renders <InsecureContextBanner>. Clicking
 * Dismiss writes localStorage and hides the banner; reload confirms
 * persistence across page loads (D-07).
 */

test('GET /manifest.webmanifest returns 200 and parses with name=HomeKeep', async ({
  request,
}) => {
  const resp = await request.get('/manifest.webmanifest');
  expect(resp.status()).toBe(200);
  const ct = resp.headers()['content-type'] ?? '';
  // Accept any JSON-ish manifest mime: application/manifest+json, application/json,
  // or text/plain with JSON body (Next 16 static-file serving varies).
  expect(ct).toMatch(/manifest|json|text/);
  const text = await resp.text();
  const json = JSON.parse(text);
  expect(json.name).toBe('HomeKeep');
  expect(json.display).toBe('standalone');
  expect(json.theme_color).toBe('#D4A574');
  expect(json.background_color).toBe('#F5EEE0');
  expect(json.icons).toHaveLength(3);
});

test('InsecureContextBanner renders on HTTP authed layout and persists dismissal', async ({
  page,
}) => {
  // Browsers treat http://localhost as a secure context per the W3C
  // Secure Contexts spec (localhost is on the allowlist even without
  // TLS). Playwright's baseURL is http://localhost:3001 so the real
  // `window.isSecureContext` is TRUE in this environment, which would
  // correctly hide the banner. For this test we simulate an HTTP
  // non-localhost deployment by stubbing window.isSecureContext to
  // false via an init script (runs before any page script, including
  // the banner's useSyncExternalStore getClientSnapshot).
  await page.addInitScript(() => {
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      get: () => false,
    });
  });

  // Signup + create home to reach the authed /h/[homeId] layout where
  // the banner is mounted (05-01 NavShell segment + 07-01 banner).
  const uniqueEmail = `pwa-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.com`;
  const pw = 'password123';

  await page.goto('/signup');
  await page.fill('[name=name]', 'PWA Test');
  await page.fill('[name=email]', uniqueEmail);
  await page.fill('[name=password]', pw);
  await page.fill('[name=passwordConfirm]', pw);
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/h$/);

  // Create a home
  await page.goto('/h/new');
  await page.fill('[name=name]', 'PWA Home');
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}/);

  // If redirected to onboarding, skip it.
  if (/\/onboarding(?:\?|$)/.test(page.url())) {
    await page.click('[data-skip-all]');
    await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}$/);
  }

  // Case B.1: banner visible on HTTP
  const banner = page.getByTestId('insecure-context-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(/You're on HTTP/);

  // Case B.2: click dismiss
  await banner.getByRole('button', { name: /dismiss/i }).click();
  await expect(banner).toHaveCount(0);

  // Case B.3: reload preserves dismissal (localStorage)
  await page.reload();
  await expect(page.getByTestId('insecure-context-banner')).toHaveCount(0);
});
