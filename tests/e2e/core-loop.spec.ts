import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { skipOnboardingIfPresent } from './helpers';

/**
 * D-21 Phase 3 core-loop E2E (03-03 Plan Task 3).
 *
 * Two scenarios cover the entire tap-to-complete flow end-to-end:
 *
 * Scenario 1 — early-completion guard fires when a recent completion exists
 *   Flow: signup -> home -> Kitchen -> Weekly (7d cycle) "Wipe benches".
 *   Seed a completion dated ONE day ago (via the PB REST API as the newly-
 *   signed-up user). The task's nextDue is now (yesterday + 7d) = ~6 days
 *   from now, placing it in the This Week band. Because elapsed since
 *   that completion is 1d < 0.25 * 7d = 1.75d, the early-completion guard
 *   fires when the user taps the row. Accepting ("Mark done anyway")
 *   records a fresh completion, the toast appears, and the task leaves
 *   This Week (nextDue shifts ~7d into the future).
 *
 *   NOTE on why we don't rely on task.created alone: PB's `created` field
 *   is an AutodateField (onCreate: true) which the server always stamps
 *   at insert time and is not client-settable. A brand-new Weekly task
 *   therefore has nextDue = now + 7d, which lands in Horizon, not This
 *   Week — the band classification boundary is strict (<= 7d of local
 *   midnight). Seeding a back-dated completion is the path the guard
 *   was designed to handle (see lib/early-completion-guard.ts: the
 *   reference is always the LATEST completion when one exists).
 *
 * Scenario 2 — stale task in Overdue, no guard fires
 *   Same signup/home/task scaffolding, but seed a completion dated
 *   TEN days ago. nextDue = 10d ago + 7d = 3d ago → Overdue band.
 *   Tapping the row: elapsed 10d >> 1.75d threshold → guard does NOT
 *   fire. A completion is recorded immediately and the toast appears.
 *   The task moves out of Overdue (its new nextDue is ~7d from now,
 *   which under Perth/UTC+8 lands in Horizon, not This Week).
 *
 * Flake mitigations:
 *   - Unique email per scenario via Date.now() + random suffix.
 *   - URL regex uses {15} for PB id length — prevents the ambiguous
 *     `/h/new` match that would otherwise let `expect(toHaveURL)` return
 *     before the home-create redirect completes.
 *   - Sonner toast assertion has a 5s timeout (default render window).
 *   - Final assertions reload via page.goto(homeUrl) to force a fresh
 *     Server Component render, not a router-cache replay.
 */

const PB_URL = 'http://127.0.0.1:8090';

async function signup(page: Page, email: string, pw: string, name = 'Core Loop Test') {
  await page.goto('/signup');
  await page.fill('[name=name]', name);
  await page.fill('[name=email]', email);
  await page.fill('[name=password]', pw);
  await page.fill('[name=passwordConfirm]', pw);
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/h$/);
}

async function createHomeAndKitchen(page: Page, homeName: string): Promise<string> {
  await page.click('text=Create your first home');
  await expect(page).toHaveURL(/\/h\/new$/);
  await page.fill('[name=name]', homeName);
  await page.click('button[type=submit]');
  // 05-03: new-home redirect to /onboarding — skip to land on dashboard.
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}\/onboarding$/);
  await skipOnboardingIfPresent(page);
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}$/);
  const homeUrl = page.url();

  // Phase 3 removed the "Manage areas" dashboard link — navigate directly.
  await page.goto(homeUrl + '/areas');
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}\/areas$/);
  await page.click('text=Add area');
  await page.fill('[name=name]', 'Kitchen');
  await page.click('button:has-text("Create area")');
  await expect(page.locator('[data-area-name="Kitchen"]').first()).toBeVisible();
  return homeUrl;
}

async function createWeeklyTaskInKitchen(page: Page, homeUrl: string, taskName: string) {
  // Navigate into the Kitchen area (hub for the "Add task" link).
  await page.goto(homeUrl + '/areas');
  const kitchenRow = page.locator('[data-area-name="Kitchen"]').first();
  await kitchenRow.getByRole('link', { name: 'Kitchen' }).click();
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}\/areas\/[a-z0-9]{15}$/);

  await page.click('text=Add task');
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}\/tasks\/new/);
  await page.fill('[name=name]', taskName);
  await page.click('button:has-text("Weekly")');
  await page.click('button:has-text("Create task")');
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}\/areas\/[a-z0-9]{15}$/);
}

/**
 * Authenticates against PB directly (port 8090) with the user's email/pw
 * and returns { token, userId }. The Next pb_auth cookie is HttpOnly and
 * same-origin to :3001, so we roundtrip through PB's own auth endpoint
 * to get a token usable on cross-origin requests from the Playwright
 * APIRequestContext.
 */
async function authPB(
  request: APIRequestContext,
  email: string,
  pw: string,
): Promise<{ token: string; userId: string }> {
  const res = await request.post(
    `${PB_URL}/api/collections/users/auth-with-password`,
    { data: { identity: email, password: pw } },
  );
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  const token = body?.token as string;
  const userId = body?.record?.id as string;
  expect(token).toBeTruthy();
  expect(userId).toBeTruthy();
  return { token, userId };
}

/**
 * Looks up the user's only task in the given home (they only create one
 * per scenario) and returns its id.
 */
async function findTaskId(
  request: APIRequestContext,
  token: string,
  homeId: string,
  taskName: string,
): Promise<string> {
  const res = await request.get(
    `${PB_URL}/api/collections/tasks/records?filter=${encodeURIComponent(`home_id = "${homeId}" && name = "${taskName}"`)}`,
    { headers: { Authorization: token } },
  );
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  const items = (body?.items ?? []) as Array<{ id: string }>;
  expect(items.length).toBeGreaterThan(0);
  return items[0].id;
}

/**
 * Seeds a completion whose completed_at is `daysAgo` days before now.
 * PB's completions.createRule requires `completed_by_id = @request.auth.id`,
 * so we send userId in the body.
 */
async function seedCompletion(
  request: APIRequestContext,
  token: string,
  userId: string,
  taskId: string,
  daysAgo: number,
) {
  const completedAt = new Date(Date.now() - daysAgo * 86400000).toISOString();
  const res = await request.post(
    `${PB_URL}/api/collections/completions/records`,
    {
      headers: { Authorization: token },
      data: {
        task_id: taskId,
        completed_by_id: userId,
        completed_at: completedAt,
        via: 'manual-date',
        notes: '',
      },
    },
  );
  expect(res.ok()).toBeTruthy();
}

function extractHomeId(homeUrl: string): string {
  const m = homeUrl.match(/\/h\/([a-z0-9]{15})$/);
  if (!m) throw new Error(`Could not extract home id from ${homeUrl}`);
  return m[1];
}

test.describe('Phase 3 Core Loop (D-21)', () => {
  test('Scenario 1 — early-completion guard fires -> accept -> moves out of This Week', async ({
    page,
    request,
  }) => {
    const email = `core-s1-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.com`;
    const pw = 'password123';
    await signup(page, email, pw);

    const homeUrl = await createHomeAndKitchen(page, 'TestHouseS1');
    await createWeeklyTaskInKitchen(page, homeUrl, 'Wipe benches');

    // Back-date a completion to 1 day ago so nextDue = -1d + 7d = +6d
    // (lands in This Week band) and elapsed 1d < 0.25*7 = 1.75d → guard fires.
    const homeId = extractHomeId(homeUrl);
    const { token, userId } = await authPB(request, email, pw);
    const taskId = await findTaskId(request, token, homeId, 'Wipe benches');
    await seedCompletion(request, token, userId, taskId, 1);

    // Navigate to the home dashboard (BandView).
    await page.goto(homeUrl);
    await expect(page.locator('[data-band-view]')).toBeVisible();

    // Task lives in the This Week band (nextDue ~6d from now).
    const taskInThisWeek = page.locator(
      '[data-band="thisWeek"] [data-task-name="Wipe benches"]',
    );
    await expect(taskInThisWeek).toBeVisible();

    // Coverage ring renders.
    await expect(page.locator('[role="img"][aria-label^="Coverage"]')).toBeVisible();

    // Tap the row -> early-completion guard fires.
    await taskInThisWeek.click();

    const dialog = page.locator('[data-testid="early-completion-dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/Mark done anyway/);

    // Confirm.
    await page.click('[data-testid="guard-confirm"]');

    // Sonner success toast appears.
    await expect(
      page.getByText(/Done — next due/),
    ).toBeVisible({ timeout: 5000 });

    // Task moves out of This Week (new nextDue shifts ~7d forward).
    await expect(
      page.locator('[data-band="thisWeek"] [data-task-name="Wipe benches"]'),
    ).toHaveCount(0);

    // Reload (fresh Server Component render) — state persists.
    await page.goto(homeUrl);
    await expect(page.locator('[data-band-view]')).toBeVisible();
    await expect(
      page.locator('[data-band="thisWeek"] [data-task-name="Wipe benches"]'),
    ).toHaveCount(0);
  });

  test('Scenario 2 — stale task in Overdue -> tap -> no guard -> moves out of Overdue', async ({
    page,
    request,
  }) => {
    const email = `core-s2-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.com`;
    const pw = 'password123';
    await signup(page, email, pw);

    const homeUrl = await createHomeAndKitchen(page, 'TestHouseS2');
    await createWeeklyTaskInKitchen(page, homeUrl, 'Clean filter');

    // Back-date a completion 10 days ago → nextDue = 10d ago + 7d = -3d → Overdue.
    const homeId = extractHomeId(homeUrl);
    const { token, userId } = await authPB(request, email, pw);
    const taskId = await findTaskId(request, token, homeId, 'Clean filter');
    await seedCompletion(request, token, userId, taskId, 10);

    // Navigate to dashboard; task is in Overdue band.
    await page.goto(homeUrl);
    await expect(page.locator('[data-band-view]')).toBeVisible();
    const overdueRow = page.locator(
      '[data-band="overdue"] [data-task-name="Clean filter"]',
    );
    await expect(overdueRow).toBeVisible();

    // Tap -> no guard dialog (elapsed 10d > 0.25 * 7d = 1.75d).
    await overdueRow.click();

    // Guard dialog MUST NOT open.
    await expect(
      page.locator('[data-testid="early-completion-dialog"]'),
    ).toHaveCount(0);

    // Toast fires.
    await expect(
      page.getByText(/Done — next due/),
    ).toBeVisible({ timeout: 5000 });

    // Task moves out of Overdue.
    await expect(
      page.locator('[data-band="overdue"] [data-task-name="Clean filter"]'),
    ).toHaveCount(0);

    // Reload — state persisted.
    await page.goto(homeUrl);
    await expect(page.locator('[data-band-view]')).toBeVisible();
    await expect(
      page.locator('[data-band="overdue"] [data-task-name="Clean filter"]'),
    ).toHaveCount(0);
  });
});
