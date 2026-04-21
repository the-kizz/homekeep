import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { skipOnboardingIfPresent } from './helpers';

/**
 * 05-02 D-19 Phase 5 views E2E — three suites (B/C/D) covering the
 * /h/[homeId]/by-area, /person, and /history routes end-to-end.
 *
 *   Suite B: By Area
 *     signup → home → Kitchen + Bathroom areas → 3 tasks (1 per area +
 *     1 on Whole Home with freq=1d so they land in This Week) → bottom
 *     nav → /by-area renders correct cards with correct counts and
 *     Whole Home pinned first.
 *
 *   Suite C: Person
 *     signup → home → area → 2 tasks (one Anyone, one assigned to self)
 *     → complete the assigned task → /person shows the assigned task in
 *     "Your tasks", the completion in history (30d), and correct weekly
 *     + streak counts → Notifications section shows placeholder copy.
 *
 *   Suite D: History
 *     signup → home → 2 areas → 2 tasks → seed 2 completions (1 today,
 *     1 yesterday) via PB REST → /history shows both with sticky day
 *     headers → area filter narrows correctly → range=today shows only
 *     the today completion → range=all restores both.
 *
 * All three use fresh users (unique emails via Date.now() + random
 * suffix) and isolate via browser context where user separation matters;
 * Suite C + D are single-user (simpler, faster, still close out the
 * REQ-IDs they cover).
 *
 * PB REST is used where server-side back-dated completion seeding or
 * direct area/task creation saves significant test time (pattern lifted
 * from core-loop.spec.ts + collaboration.spec.ts — see those for the
 * authentication protocol rationale).
 */

const PB_URL = 'http://127.0.0.1:8090';

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

function extractHomeId(homeUrl: string): string {
  const m = homeUrl.match(/\/h\/([a-z0-9]{15})/);
  if (!m) throw new Error(`bad home url: ${homeUrl}`);
  return m[1];
}

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
  return { token: body.token as string, userId: body.record.id as string };
}

async function findAreaId(
  request: APIRequestContext,
  token: string,
  homeId: string,
  name: string,
): Promise<string> {
  const res = await request.get(
    `${PB_URL}/api/collections/areas/records?filter=${encodeURIComponent(
      `home_id = "${homeId}" && name = "${name}"`,
    )}`,
    { headers: { Authorization: token } },
  );
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  const items = (body?.items ?? []) as Array<{ id: string }>;
  expect(items.length).toBeGreaterThan(0);
  return items[0].id;
}

async function findTaskId(
  request: APIRequestContext,
  token: string,
  homeId: string,
  name: string,
): Promise<string> {
  const res = await request.get(
    `${PB_URL}/api/collections/tasks/records?filter=${encodeURIComponent(
      `home_id = "${homeId}" && name = "${name}"`,
    )}`,
    { headers: { Authorization: token } },
  );
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  const items = (body?.items ?? []) as Array<{ id: string }>;
  expect(items.length).toBeGreaterThan(0);
  return items[0].id;
}

async function createAreaViaUI(page: Page, homeId: string, name: string) {
  await page.goto(`/h/${homeId}/areas`);
  await page.click('text=Add area');
  await page.fill('[name=name]', name);
  await page.click('button:has-text("Create area")');
  await expect(
    page.locator(`[data-area-name="${name}"]`).first(),
  ).toBeVisible();
}

async function createTaskInArea(
  page: Page,
  homeId: string,
  areaId: string,
  name: string,
  frequencyDays: number,
  opts: { assignSelf?: boolean } = {},
) {
  await page.goto(`/h/${homeId}/tasks/new?areaId=${areaId}`);
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}\/tasks\/new/);
  await page.fill('[name=name]', name);
  await page.fill('[name=frequency_days]', String(frequencyDays));
  if (opts.assignSelf) {
    // First non-empty option is the authenticated user (only member).
    const select = page.locator('[data-testid="task-assignee-select"]');
    const firstOptValue = await select
      .locator('option:not([value=""])')
      .first()
      .getAttribute('value');
    if (firstOptValue) {
      await select.selectOption(firstOptValue);
    }
  }
  await page.click('button:has-text("Create task")');
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}\/areas\/[a-z0-9]{15}$/);
}

async function seedCompletion(
  request: APIRequestContext,
  token: string,
  userId: string,
  taskId: string,
  daysAgo: number,
) {
  const completedAt = new Date(
    Date.now() - daysAgo * 86400000,
  ).toISOString();
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

/* ======================================================================= */
/* Suite B — By Area view                                                  */
/* ======================================================================= */

test.describe.serial('Phase 5 Views (D-19) — Suite B: by-area', () => {
  test('by-area renders Whole Home pinned + Kitchen + Bathroom with correct counts; tap → /areas/[id]', async ({
    page,
    request,
  }) => {
    const pw = 'password123';
    const email = `views-b-${stamp()}@test.local`;
    await signup(page, email, pw, 'Alice Area');
    const homeUrl = await createHome(page, 'Phase 5 Area Test');
    const homeId = extractHomeId(homeUrl);

    // Create Kitchen + Bathroom via UI (Whole Home is auto-created by PB hook).
    await createAreaViaUI(page, homeId, 'Kitchen');
    await createAreaViaUI(page, homeId, 'Bathroom');

    // Look up area ids via PB REST for direct task creation.
    const { token } = await authPB(request, email, pw);
    const kitchenId = await findAreaId(request, token, homeId, 'Kitchen');
    const bathroomId = await findAreaId(request, token, homeId, 'Bathroom');
    const wholeHomeId = await findAreaId(request, token, homeId, 'Whole Home');

    // Create 1 task per area with frequency_days=1 so each lands in
    // "This Week" (nextDue = today + 1d).
    await createTaskInArea(page, homeId, kitchenId, 'Wipe benches', 1);
    await createTaskInArea(page, homeId, bathroomId, 'Clean toilet', 1);
    await createTaskInArea(page, homeId, wholeHomeId, 'Check smoke alarms', 1);

    // Navigate via bottom nav (mobile-sized by default — but the nav
    // itself is `md:hidden`, so on desktop viewport it's not visible).
    // Navigate by direct URL to avoid viewport-dependent flakiness.
    await page.goto(`/h/${homeId}/by-area`);
    await expect(page).toHaveURL(new RegExp(`/h/${homeId}/by-area$`));
    await expect(page.locator('[data-by-area-view]')).toBeVisible();

    // Whole Home card is positioned FIRST in the DOM (above Separator).
    const cards = page.locator('[data-area-card]');
    await expect(cards).toHaveCount(3);
    const firstCard = cards.nth(0);
    await expect(firstCard).toHaveAttribute('data-is-whole-home', 'true');
    await expect(firstCard).toHaveAttribute(
      'data-area-name',
      'Whole Home',
    );

    // Assert per-area counts. Each area has exactly one freq=1d task, so:
    //   overdue=0, thisWeek=1, upcoming=0, coverage=100% (on schedule).
    const wholeHomeCard = page.locator(
      '[data-area-card][data-area-name="Whole Home"]',
    );
    await expect(wholeHomeCard).toHaveAttribute('data-overdue-count', '0');
    await expect(wholeHomeCard).toHaveAttribute('data-this-week-count', '1');
    await expect(wholeHomeCard).toHaveAttribute('data-upcoming-count', '0');
    await expect(wholeHomeCard).toHaveAttribute('data-coverage', '100');

    const kitchenCard = page.locator(
      '[data-area-card][data-area-name="Kitchen"]',
    );
    await expect(kitchenCard).toHaveAttribute('data-this-week-count', '1');

    const bathroomCard = page.locator(
      '[data-area-card][data-area-name="Bathroom"]',
    );
    await expect(bathroomCard).toHaveAttribute('data-this-week-count', '1');

    // Tap Kitchen card → navigates to /h/{id}/areas/{areaId} → shows
    // "Tasks in Kitchen".
    await kitchenCard.click();
    await expect(page).toHaveURL(
      /\/h\/[a-z0-9]{15}\/areas\/[a-z0-9]{15}$/,
    );
    await expect(page.getByText('Tasks in Kitchen')).toBeVisible();
  });
});

/* ======================================================================= */
/* Suite C — Person view                                                   */
/* ======================================================================= */

test.describe.serial('Phase 5 Views (D-19) — Suite C: person', () => {
  test('person shows assigned task only + history entry + weekly + streak + notifications placeholder', async ({
    page,
    request,
  }) => {
    const pw = 'password123';
    const email = `views-c-${stamp()}@test.local`;
    await signup(page, email, pw, 'Carol Person');
    const homeUrl = await createHome(page, 'Phase 5 Person Test');
    const homeId = extractHomeId(homeUrl);

    // Create Kitchen area.
    await createAreaViaUI(page, homeId, 'Kitchen');

    const { token, userId } = await authPB(request, email, pw);
    const kitchenId = await findAreaId(request, token, homeId, 'Kitchen');

    // Create 1 freq=1d task WITHOUT assignee → falls to 'anyone'.
    await createTaskInArea(page, homeId, kitchenId, 'Wipe benches', 1);
    // Create 1 freq=1d task WITH assignee=self → 'task' kind to current user.
    await createTaskInArea(page, homeId, kitchenId, 'Clean filter', 1, {
      assignSelf: true,
    });

    // Seed one completion for the assigned task (completed today → counts
    // for weekly/monthly + starts the streak).
    const assignedTaskId = await findTaskId(
      request,
      token,
      homeId,
      'Clean filter',
    );
    await seedCompletion(request, token, userId, assignedTaskId, 0);

    // Visit person view.
    await page.goto(`/h/${homeId}/person`);
    await expect(page.locator('[data-person-view]')).toBeVisible();

    // Your tasks: exactly ONE assigned task (Clean filter). "Wipe benches"
    // (anyone) must NOT appear in this section.
    const yourTasksSection = page.locator('[data-section="your-tasks"]');
    await expect(yourTasksSection).toHaveAttribute(
      'data-your-tasks-count',
      '1',
    );
    await expect(
      yourTasksSection.locator('[data-task-name="Clean filter"]'),
    ).toBeVisible();
    await expect(
      yourTasksSection.locator('[data-task-name="Wipe benches"]'),
    ).toHaveCount(0);

    // Your history: exactly ONE entry (for the Clean filter completion).
    const yourHistorySection = page.locator(
      '[data-section="your-history"]',
    );
    await expect(yourHistorySection).toHaveAttribute(
      'data-your-history-count',
      '1',
    );
    await expect(
      yourHistorySection.locator('[data-your-history-entry]'),
    ).toHaveCount(1);

    // Your stats: weekly=1, streak=1.
    const weeklyCard = page.locator('[data-weekly-count]');
    await expect(weeklyCard).toHaveAttribute('data-weekly-count', '1');
    const streakCard = page.locator('[data-streak-count]');
    await expect(streakCard).toHaveAttribute('data-streak-count', '1');

    // Notifications placeholder present with Phase 6 copy.
    const prefs = page.locator('[data-notification-prefs-placeholder]');
    await expect(prefs).toBeVisible();
    await expect(prefs).toContainText(/coming in Phase 6/i);

    // Disabled form fields present.
    const disabledTopic = prefs.locator('input[name="ntfy_topic"]');
    await expect(disabledTopic).toBeDisabled();
    const disabledEmail = prefs.locator('input[name="email_summary"]');
    await expect(disabledEmail).toBeDisabled();
  });
});

/* ======================================================================= */
/* Suite D — History view                                                  */
/* ======================================================================= */

test.describe.serial('Phase 5 Views (D-19) — Suite D: history', () => {
  test('history timeline shows 2 entries (today + yesterday); area filter narrows; range=today filters; range=all restores', async ({
    page,
    request,
  }) => {
    const pw = 'password123';
    const email = `views-d-${stamp()}@test.local`;
    await signup(page, email, pw, 'Dave History');
    const homeUrl = await createHome(page, 'Phase 5 History Test');
    const homeId = extractHomeId(homeUrl);

    await createAreaViaUI(page, homeId, 'Kitchen');

    const { token, userId } = await authPB(request, email, pw);
    const kitchenId = await findAreaId(request, token, homeId, 'Kitchen');

    // Create 2 tasks in Kitchen (freq=7 so task creation doesn't matter
    // for the history view — only completions do).
    await createTaskInArea(page, homeId, kitchenId, 'Wipe benches', 7);
    await createTaskInArea(page, homeId, kitchenId, 'Mop floor', 7);

    const task1Id = await findTaskId(
      request,
      token,
      homeId,
      'Wipe benches',
    );
    const task2Id = await findTaskId(request, token, homeId, 'Mop floor');

    // Seed 2 completions: one today, one yesterday. Via manual-date so
    // the back-date survives PB's createRule (which does NOT stamp
    // completed_at — the client payload wins).
    await seedCompletion(request, token, userId, task1Id, 0);
    await seedCompletion(request, token, userId, task2Id, 1);

    // Visit /history.
    await page.goto(`/h/${homeId}/history`);
    await expect(page.locator('[data-history-view]')).toBeVisible();

    // Both entries visible.
    const entries = page.locator('[data-history-entry]');
    await expect(entries).toHaveCount(2);

    // Day headers include "Today" and "Yesterday".
    const todayHeader = page.locator(
      '[data-history-day-header]',
      { hasText: /^Today$/ },
    );
    await expect(todayHeader).toBeVisible();
    const yesterdayHeader = page.locator(
      '[data-history-day-header]',
      { hasText: /^Yesterday$/ },
    );
    await expect(yesterdayHeader).toBeVisible();

    // Apply Area filter = Kitchen → URL updates → both entries still
    // visible (both completions are Kitchen tasks).
    await page.selectOption('[data-filter-area]', kitchenId);
    await expect(page).toHaveURL(
      new RegExp(`\\?.*area=${kitchenId}`),
    );
    await expect(page.locator('[data-history-entry]')).toHaveCount(2);

    // Click "Today" range button → URL gets ?range=today → only the today
    // completion is visible.
    await page.click('[data-filter-range="today"]');
    await expect(page).toHaveURL(/\?.*range=today/);
    await expect(page.locator('[data-history-entry]')).toHaveCount(1);
    // "Today" header still present; "Yesterday" gone.
    await expect(
      page.locator('[data-history-day-header]', { hasText: /^Today$/ }),
    ).toBeVisible();
    await expect(
      page.locator('[data-history-day-header]', {
        hasText: /^Yesterday$/,
      }),
    ).toHaveCount(0);

    // Click "All" → range removed from URL → both entries restored.
    await page.click('[data-filter-range="all"]');
    await expect(page).toHaveURL(/\?.*range=all/);
    await expect(page.locator('[data-history-entry]')).toHaveCount(2);
  });
});
