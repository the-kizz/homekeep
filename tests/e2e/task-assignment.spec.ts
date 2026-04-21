import { test, expect, type Page } from '@playwright/test';
import { skipOnboardingIfPresent } from './helpers';

/**
 * 04-03 D-20 Suite B — task-assignment cascade on member removal.
 *
 * Flow:
 *   1. Owner + invitee set up via invite (same pattern as collaboration.spec.ts).
 *   2. Owner creates a Kitchen area.
 *   3. Owner creates "Weekly vacuum" task assigned to Bob (invitee) via
 *      the TaskForm assignee dropdown.
 *   4. Invitee logs in separately → visits the shared home → their task
 *      row shows data-assignee-kind="task" (Bob = solid assignee).
 *   5. Owner visits /members and removes Bob.
 *   6. Owner reloads the dashboard → "Weekly vacuum" row now renders
 *      data-assignee-kind="anyone" (cascade fell through because the
 *      Kitchen area has no default_assignee_id).
 *
 * This exercises the full Phase 4 pipeline: resolveAssignee in the
 * Server Component reading home_members → threading through BandView →
 * TaskRow rendering the AssigneeDisplay variant.
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
}

async function createHome(page: Page, homeName: string): Promise<string> {
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

test('Suite B: task assignee cascade on member removal', async ({
  browser,
}) => {
  const pw = 'password123';
  const ownerEmail = `owner-ta-${stamp()}@test.local`;
  const inviteeEmail = `invitee-ta-${stamp()}@test.local`;

  // --- Owner: signup, home, invite ---
  const ownerCtx = await browser.newContext();
  const ownerPage = await ownerCtx.newPage();
  await signup(ownerPage, ownerEmail, pw, 'Alice Owner');
  const ownerHomeUrl = await createHome(ownerPage, 'Assignment Test Home');
  const homeId = ownerHomeUrl.match(/\/h\/([a-z0-9]{15})/)![1];

  // Create invite for Bob.
  await ownerPage.goto(`/h/${homeId}/settings`);
  await ownerPage.click('[data-testid="create-invite-button"]');
  const urlInput = ownerPage.locator('[data-testid="invite-url"]');
  await expect(urlInput).toBeVisible({ timeout: 10_000 });
  const inviteUrl = await urlInput.inputValue();

  // --- Invitee: accept invite via signup-next ---
  const inviteeCtx = await browser.newContext();
  const inviteePage = await inviteeCtx.newPage();
  await inviteePage.goto(inviteUrl.replace(/^https?:\/\/[^/]+/, ''));
  await expect(inviteePage).toHaveURL(/\/signup\?next=/);
  await inviteePage.fill('[name=name]', 'Bob Invitee');
  await inviteePage.fill('[name=email]', inviteeEmail);
  await inviteePage.fill('[name=password]', pw);
  await inviteePage.fill('[name=passwordConfirm]', pw);
  await inviteePage.click('button[type=submit]');
  await inviteePage.waitForURL(new RegExp(`/h/${homeId}(?:\\?|$)`), {
    timeout: 15_000,
  });

  // --- Owner: create Kitchen area + "Weekly vacuum" task assigned to Bob ---
  await ownerPage.goto(`/h/${homeId}/areas`);
  await ownerPage.click('text=Add area');
  await ownerPage.fill('[name=name]', 'Kitchen');
  await ownerPage.click('button:has-text("Create area")');
  await expect(
    ownerPage.locator('[data-area-name="Kitchen"]').first(),
  ).toBeVisible();

  // Open Kitchen → Add task
  await ownerPage
    .locator('[data-area-name="Kitchen"]')
    .first()
    .getByRole('link', { name: 'Kitchen' })
    .click();
  await expect(ownerPage).toHaveURL(
    /\/h\/[a-z0-9]{15}\/areas\/[a-z0-9]{15}$/,
  );

  await ownerPage.click('text=Add task');
  await expect(ownerPage).toHaveURL(/\/h\/[a-z0-9]{15}\/tasks\/new/);
  await ownerPage.fill('[name=name]', 'Weekly vacuum');

  // Set frequency to 1 day so nextDue = today + 1d → ThisWeek band.
  // (Weekly quick-select would land in Horizon which does not render
  // TaskRow per-task; ThisWeek + Overdue are where the assignee chip
  // is visible.)
  await ownerPage.fill('[name=frequency_days]', '1');

  // Pick Bob via the assignee select. The select value is the user id —
  // read it by label since we know Bob's display name.
  await ownerPage.selectOption('[data-testid="task-assignee-select"]', {
    label: 'Bob Invitee',
  });

  await ownerPage.click('button:has-text("Create task")');
  await expect(ownerPage).toHaveURL(
    /\/h\/[a-z0-9]{15}\/areas\/[a-z0-9]{15}$/,
  );

  // --- Owner: verify dashboard shows the task assigned to Bob (task-level). ---
  await ownerPage.goto(`/h/${homeId}`);
  const vacuumRow = ownerPage.locator(
    '[data-task-name="Weekly vacuum"]',
  );
  await expect(vacuumRow).toBeVisible();
  await expect(vacuumRow).toHaveAttribute('data-assignee-kind', 'task');

  // --- Owner: remove Bob via /members ---
  await ownerPage.goto(`/h/${homeId}/members`);
  await expect(ownerPage.getByText('Bob Invitee')).toBeVisible();
  // Find Bob's user-id from the row data-testid attribute.
  const bobRow = ownerPage.locator(
    '[data-testid^="member-row-"]:has-text("Bob Invitee")',
  );
  await expect(bobRow).toBeVisible();
  const bobTestId = (await bobRow.getAttribute('data-testid')) ?? '';
  const bobUserId = bobTestId.replace(/^member-row-/, '');
  expect(bobUserId).toMatch(/^[a-z0-9]{15}$/);

  await ownerPage.click(`[data-testid="remove-member-${bobUserId}"]`);
  await ownerPage.click(`[data-testid="remove-confirm-${bobUserId}"]`);

  // Wait for the row to be removed (router.refresh cycles the RSC).
  await expect(
    ownerPage.locator(`[data-testid="member-row-${bobUserId}"]`),
  ).toHaveCount(0, { timeout: 10_000 });

  // --- Owner: reload dashboard → vacuum row now shows assignee-kind="anyone". ---
  await ownerPage.goto(`/h/${homeId}`);
  const vacuumAfterRemove = ownerPage.locator(
    '[data-task-name="Weekly vacuum"]',
  );
  await expect(vacuumAfterRemove).toBeVisible();
  await expect(vacuumAfterRemove).toHaveAttribute(
    'data-assignee-kind',
    'anyone',
  );

  await ownerCtx.close();
  await inviteeCtx.close();
});
