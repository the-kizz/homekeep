import { test, expect, type Page } from '@playwright/test';
import { skipOnboardingIfPresent } from './helpers';

/**
 * 04-03 D-20 Phase 4 collaboration E2E — three suites:
 *
 *   Suite A: invite roundtrip
 *     owner signs up + creates home → creates invite in /settings →
 *     invitee signs up via /invite/TOKEN (signup-next thread) →
 *     invitee lands in shared /h/[homeId] → both users appear in
 *     /members.
 *
 *   Suite B: assignment cascade (task-assignment.spec.ts sibling)
 *     Covered in tests/e2e/task-assignment.spec.ts — this file keeps
 *     the invite roundtrip + owner-gating concerns, and the cascade
 *     flow lives there.
 *
 *   Suite C: owner-only gating
 *     non-owner member attempting /h/[homeId]/settings or /members is
 *     redirected away from the owner-only page.
 *
 * Flake mitigations:
 *   - Unique emails per stamp() call.
 *   - Two isolated browser contexts per multi-user scenario so each
 *     user has its own cookie jar.
 *   - URL regex uses {15} for PB ids to avoid /h/new ambiguity.
 */

const stamp = () => `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

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
}

async function createHome(page: Page, homeName: string): Promise<string> {
  // Post-signup user lands on /h. Click Create your first home.
  await expect(page).toHaveURL(/\/h$/);
  await page.click('text=Create your first home');
  await expect(page).toHaveURL(/\/h\/new$/);
  await page.fill('[name=name]', homeName);
  await page.click('button[type=submit]');
  // 05-03: new-home redirect to /onboarding — skip to land on dashboard.
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}\/onboarding$/);
  await skipOnboardingIfPresent(page);
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}$/);
  return page.url();
}

function extractHomeId(homeUrl: string): string {
  const m = homeUrl.match(/\/h\/([a-z0-9]{15})/);
  if (!m) throw new Error(`bad home url: ${homeUrl}`);
  return m[1];
}

test.describe.serial('Phase 4 collaboration (D-20)', () => {
  const ownerEmail = `owner-${stamp()}@test.local`;
  const inviteeEmail = `invitee-${stamp()}@test.local`;
  const pw = 'password123';
  let sharedHomeId = '';

  test('Suite A: owner creates invite → invitee signs up via link → both see each other in /members', async ({
    browser,
  }) => {
    // --- Owner context ---
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();

    await signup(ownerPage, ownerEmail, pw, 'Alice Owner');
    const ownerHomeUrl = await createHome(ownerPage, 'Shared Home');
    const homeId = extractHomeId(ownerHomeUrl);
    sharedHomeId = homeId;

    // Navigate to settings, create invite.
    await ownerPage.goto(`/h/${homeId}/settings`);
    await expect(ownerPage).toHaveURL(new RegExp(`/h/${homeId}/settings`));

    await ownerPage.click('[data-testid="create-invite-button"]');
    const urlInput = ownerPage.locator('[data-testid="invite-url"]');
    await expect(urlInput).toBeVisible({ timeout: 10_000 });
    const inviteUrl = await urlInput.inputValue();
    expect(inviteUrl).toMatch(/\/invite\/[A-Za-z0-9_-]{20,64}$/);

    // --- Invitee context (fresh cookie jar) ---
    const inviteeCtx = await browser.newContext();
    const inviteePage = await inviteeCtx.newPage();

    // Strip host so baseURL is honoured (invite URL is absolute when SITE_URL is set).
    const invitePath = inviteUrl.replace(/^https?:\/\/[^/]+/, '');
    await inviteePage.goto(invitePath);

    // Unauthed: redirected to signup?next=/invite/TOKEN
    await expect(inviteePage).toHaveURL(/\/signup\?next=%2Finvite%2F[A-Za-z0-9_-]+|\/signup\?next=\/invite\/[A-Za-z0-9_-]+/);
    await inviteePage.fill('[name=name]', 'Bob Invitee');
    await inviteePage.fill('[name=email]', inviteeEmail);
    await inviteePage.fill('[name=password]', pw);
    await inviteePage.fill('[name=passwordConfirm]', pw);
    await inviteePage.click('button[type=submit]');

    // After signup the action redirects to next (/invite/TOKEN), which runs
    // acceptInvite, which redirects to /h/{homeId}. URL should land on the home.
    await inviteePage.waitForURL(new RegExp(`/h/${homeId}(?:\\?|$)`), {
      timeout: 15_000,
    });

    // --- Owner: verify both members appear in /members ---
    await ownerPage.goto(`/h/${homeId}/members`);
    await expect(ownerPage).toHaveURL(new RegExp(`/h/${homeId}/members`));
    await expect(ownerPage.getByText('Alice Owner')).toBeVisible();
    await expect(ownerPage.getByText('Bob Invitee')).toBeVisible();

    await ownerCtx.close();
    await inviteeCtx.close();
  });

  test('Suite C: non-owner cannot access /settings or /members', async ({
    browser,
  }) => {
    // Reuses Suite A's invitee, now a member (not owner) of sharedHomeId.
    // Fresh login for this test to be context-isolated.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto('/login');
    await page.fill('[name=email]', inviteeEmail);
    await page.fill('[name=password]', pw);
    await page.click('button[type=submit]');
    await expect(page).toHaveURL(new RegExp(`/h/${sharedHomeId}|/h$`), {
      timeout: 10_000,
    });

    // Try /settings — should redirect to /h/[homeId] (dashboard).
    await page.goto(`/h/${sharedHomeId}/settings`);
    await expect(page).toHaveURL(new RegExp(`/h/${sharedHomeId}$`));

    // Try /members — same redirect.
    await page.goto(`/h/${sharedHomeId}/members`);
    await expect(page).toHaveURL(new RegExp(`/h/${sharedHomeId}$`));

    await ctx.close();
  });
});
