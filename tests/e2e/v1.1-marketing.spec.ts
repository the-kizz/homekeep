import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import PocketBase from 'pocketbase';
import { skipOnboardingIfPresent } from './helpers';

/**
 * v1.1 marketing screenshot capture. Not an assertion suite — produces
 * the 9 PNGs the README header advertises (+ 1 mobile dashboard shot).
 *
 * Seeds a "pleasant" household with 13 natural-named chores spread
 * across 3 areas, a seasonal dormant, a shift-badge inducing
 * next_due_smoothed divergence, and an anchored control. See the
 * equivalent p16-visual spec for why the seeding mitigations exist
 * (PB 0.37 NumberField quirk, seasonal-wakeup Jan-bucket trap, etc.)
 * — they're reproduced here verbatim where still load-bearing.
 *
 * Output: docs/screenshots/v1.1/ (new) AND overwrites the top-level
 * docs/screenshots/0{1..8}-*.png files so the existing README markdown
 * keeps working. v1.0 originals are archived under
 * docs/screenshots/archive/v1.0/ via a bash step outside this spec.
 */

const PB_URL = 'http://127.0.0.1:8090';
const SHOT_DIR = 'docs/screenshots/v1.1';
const TOP_DIR = 'docs/screenshots';

const stamp = () =>
  `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function signup(page: Page, email: string, pw: string, name: string) {
  await page.goto('/signup');
  await page.fill('[name=name]', name);
  await page.fill('[name=email]', email);
  await page.fill('[name=password]', pw);
  await page.fill('[name=passwordConfirm]', pw);
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/h$/);
}

async function createHome(page: Page, homeName: string): Promise<string> {
  await page.click('text=Create your first home');
  await expect(page).toHaveURL(/\/h\/new$/);
  await page.fill('[name=name]', homeName);
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}\/onboarding$/);
  await skipOnboardingIfPresent(page);
  await expect(page).toHaveURL(/\/h\/[a-z0-9]{15}$/);
  return page.url();
}

function extractHomeId(homeUrl: string): string {
  const m = homeUrl.match(/\/h\/([a-z0-9]{15})/);
  if (!m) throw new Error(`Could not extract home id from ${homeUrl}`);
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

async function createAreaViaPB(
  pb: PocketBase,
  homeId: string,
  name: string,
  icon: string,
  color: string,
  sortOrder: number,
): Promise<string> {
  const created = await pb.collection('areas').create({
    home_id: homeId,
    name,
    icon,
    color,
    sort_order: sortOrder,
    scope: 'location',
    is_whole_home_system: false,
  });
  return created.id as string;
}

type SeedTask = {
  name: string;
  frequency_days: number | null;
  schedule_mode: 'cycle' | 'anchored';
  anchor_date?: string | null;
  due_date?: string | null;
  active_from_month?: number | null;
  active_to_month?: number | null;
  completionDaysAgo?: number;
  smoothedOffsetDays?: number;
  area?: 'whole' | 'kitchen' | 'outdoor' | 'bathroom';
};

async function createTaskViaPB(
  pb: PocketBase,
  homeId: string,
  areaId: string,
  seed: SeedTask,
): Promise<string> {
  const effectiveFrom = seed.active_from_month ?? 1;
  const effectiveTo = seed.active_to_month ?? 12;
  const body: Record<string, unknown> = {
    home_id: homeId,
    area_id: areaId,
    name: seed.name,
    schedule_mode: seed.schedule_mode,
    archived: false,
    icon: 'home',
    color: '#888888',
    notes: '',
    description: '',
    active_from_month: effectiveFrom,
    active_to_month: effectiveTo,
  };
  if (seed.frequency_days != null) body.frequency_days = seed.frequency_days;
  if (seed.anchor_date) body.anchor_date = seed.anchor_date;
  if (seed.due_date) body.due_date = seed.due_date;
  const created = await pb.collection('tasks').create(body);
  return created.id as string;
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

async function patchSmoothed(
  request: APIRequestContext,
  token: string,
  taskId: string,
  offsetDaysFromNow: number,
) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDaysFromNow);
  const iso = d.toISOString();
  const res = await request.patch(
    `${PB_URL}/api/collections/tasks/records/${taskId}`,
    {
      headers: { Authorization: token },
      data: { next_due_smoothed: iso },
    },
  );
  if (!res.ok()) {
    const errText = await res.text();
    throw new Error(
      `PB patch next_due_smoothed failed: ${res.status()} ${errText}`,
    );
  }
}

test.describe('v1.1 marketing — README screenshot capture', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'marketing shots are chromium-only',
  );

  test('seed pleasant household + capture all marketing screenshots', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);

    const pw = 'password123';
    const email = `v11-marketing-${stamp()}@test.local`;
    await signup(page, email, pw, 'Alex Kemp');
    const homeUrl = await createHome(page, 'The Kemp Residence');
    const homeId = extractHomeId(homeUrl);

    const { token, userId } = await authPB(request, email, pw);
    const pb = new PocketBase(PB_URL);
    pb.authStore.save(token, { id: userId });

    const wholeHomeAreaId = await findAreaId(
      request,
      token,
      homeId,
      'Whole Home',
    );

    // Extra named areas — gives the By-Area grid visual variety.
    // Icons + colors must be drawn from AREA_ICONS / AREA_COLORS enums
    // (lib/area-palette.ts); arbitrary strings fail the PB create hook.
    const kitchenId = await createAreaViaPB(
      pb,
      homeId,
      'Kitchen',
      'utensils-crossed',
      '#D4A574',
      1,
    );
    const outdoorId = await createAreaViaPB(
      pb,
      homeId,
      'Outdoor',
      'trees',
      '#BF8F4C',
      2,
    );
    const bathroomId = await createAreaViaPB(
      pb,
      homeId,
      'Bathroom',
      'bath',
      '#8F6B55',
      3,
    );

    const areaIdOf = (k: SeedTask['area']) =>
      k === 'kitchen'
        ? kitchenId
        : k === 'outdoor'
          ? outdoorId
          : k === 'bathroom'
            ? bathroomId
            : wholeHomeAreaId;

    const now = new Date();
    const inDays = (n: number): Date => {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() + n);
      return d;
    };

    // Density seeds — spread across horizon buckets so HorizonStrip has
    // visible low/mid/high tiers. Natural chore names, assigned across
    // the 4 areas so By-Area shows even coverage.
    const densitySeeds: SeedTask[] = [
      // month+1 (~30d): 1 → light tier
      { name: 'Replace air filter', frequency_days: 30, schedule_mode: 'cycle', area: 'whole' },
      // month+3 (~90d): 3 → mid tier
      { name: 'Deep clean oven', frequency_days: 90, schedule_mode: 'cycle', area: 'kitchen' },
      { name: 'Rotate car tyres', frequency_days: 92, schedule_mode: 'cycle', area: 'outdoor' },
      { name: 'Flush water heater', frequency_days: 95, schedule_mode: 'cycle', area: 'whole' },
      // month+6 (~180d): 6 → high tier
      { name: 'Service HVAC', frequency_days: 180, schedule_mode: 'cycle', area: 'whole' },
      { name: 'Clean gutters', frequency_days: 182, schedule_mode: 'cycle', area: 'outdoor' },
      { name: 'Test smoke alarms', frequency_days: 183, schedule_mode: 'cycle', area: 'whole' },
      { name: 'Re-caulk bathtub', frequency_days: 185, schedule_mode: 'cycle', area: 'bathroom' },
      { name: 'Polish timber floors', frequency_days: 186, schedule_mode: 'cycle', area: 'whole' },
      { name: 'Wash exterior windows', frequency_days: 188, schedule_mode: 'cycle', area: 'outdoor' },
      // month+9 (~270d): 2 → light tier
      { name: 'Sharpen lawnmower blades', frequency_days: 270, schedule_mode: 'cycle', area: 'outdoor' },
      { name: 'Descale kettle', frequency_days: 275, schedule_mode: 'cycle', area: 'kitchen' },
    ];

    // This Week shifted rows — freq=7, completed 5d ago, smoothed +5/+6
    // so ideal vs scheduled diverges ≥3d and ShiftBadge renders.
    const shiftedSeeds: SeedTask[] = [
      {
        name: 'Vacuum living room',
        frequency_days: 7,
        schedule_mode: 'cycle',
        completionDaysAgo: 5,
        smoothedOffsetDays: 5,
        area: 'whole',
      },
      {
        name: 'Wipe kitchen benches',
        frequency_days: 7,
        schedule_mode: 'cycle',
        completionDaysAgo: 5,
        smoothedOffsetDays: 6,
        area: 'kitchen',
      },
      {
        name: 'Mow lawn',
        frequency_days: 10,
        schedule_mode: 'cycle',
        completionDaysAgo: 7,
        area: 'outdoor',
      },
    ];

    // Anchored control — visible in Horizon, shows "no badge" invariant.
    const anchoredSeed: SeedTask = {
      name: 'Pay quarterly insurance',
      frequency_days: 30,
      schedule_mode: 'anchored',
      anchor_date: isoDate(inDays(14)),
      area: 'whole',
    };

    // Seasonal dormant — Winterize outdoor taps, active Oct..Mar.
    // In April (runtime today), dormant.
    const dormantSeed: SeedTask = {
      name: 'Winterize outdoor taps',
      frequency_days: 365,
      schedule_mode: 'cycle',
      active_from_month: 10,
      active_to_month: 3,
      area: 'outdoor',
    };

    // Create density + seed a 0-days-ago completion to route through
    // cycle branch (seasonal-wakeup trap mitigation — see p16 spec).
    for (const seed of densitySeeds) {
      const id = await createTaskViaPB(pb, homeId, areaIdOf(seed.area), seed);
      await seedCompletion(request, token, userId, id, 0);
    }
    for (const seed of shiftedSeeds) {
      const id = await createTaskViaPB(pb, homeId, areaIdOf(seed.area), seed);
      if (seed.completionDaysAgo != null) {
        await seedCompletion(request, token, userId, id, seed.completionDaysAgo);
      }
      if (seed.smoothedOffsetDays != null) {
        await patchSmoothed(request, token, id, seed.smoothedOffsetDays);
      }
    }
    const anchoredId = await createTaskViaPB(
      pb,
      homeId,
      areaIdOf(anchoredSeed.area),
      anchoredSeed,
    );
    await seedCompletion(request, token, userId, anchoredId, 0);
    await createTaskViaPB(pb, homeId, areaIdOf(dormantSeed.area), dormantSeed);

    // ─── Desktop viewport ────────────────────────────────────────────
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(homeUrl);
    await expect(page.locator('[data-band-view]')).toBeVisible();
    await page.waitForTimeout(600);

    // 01 — dashboard hero
    await page.screenshot({
      path: `${SHOT_DIR}/01-dashboard-hero.png`,
      fullPage: true,
    });
    await page.screenshot({
      path: `${TOP_DIR}/01-landing.png`,
      fullPage: true,
    });
    // Also overwrite 03-dashboard-three-band.png (v1.0 name) with the
    // hero so README callers using that filename still work.
    await page.screenshot({
      path: `${TOP_DIR}/03-dashboard-three-band.png`,
      fullPage: true,
    });

    // 02 — Reschedule action sheet. Trigger: right-click a shifted row
    // → task detail → click Reschedule button. Reschedule sheet renders.
    const shiftedRow = page.locator('[data-task-name="Vacuum living room"]');
    await expect(shiftedRow).toBeVisible();
    await shiftedRow.click({ button: 'right' });
    const detailSheet = page.locator('[data-testid="task-detail-sheet"]');
    await expect(detailSheet).toBeVisible();
    await page.waitForTimeout(300);
    // Click Reschedule (closes detail, opens reschedule)
    await page.locator('[data-testid="detail-reschedule"]').click();
    const rescheduleSheet = page.locator('[data-testid="reschedule-sheet"]');
    await expect(rescheduleSheet).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: `${SHOT_DIR}/02-reschedule-action-sheet.png`,
      fullPage: false,
    });
    await page.screenshot({
      path: `${TOP_DIR}/02-signup.png`,
      fullPage: false,
    });
    await page.locator('[data-testid="reschedule-cancel"]').click();
    await expect(rescheduleSheet).toBeHidden();

    // 03 — horizon detail drawer. Click heaviest-tint cell.
    const horizon = page.locator('[data-band="horizon"]');
    await expect(horizon).toBeVisible();
    const populated = horizon.locator(
      'button[data-month-count]:not([disabled])',
    );
    const heavy = populated.filter({
      has: page.locator('[data-tint="bg-primary/50"]'),
    });
    const cellTarget = (await heavy.count())
      ? heavy.first()
      : populated.first();
    await cellTarget.click();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: `${SHOT_DIR}/03-horizon-detail-drawer.png`,
      fullPage: false,
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // 04 — By-Area grid + dormant Sleeping section
    await page.goto(`${homeUrl}/by-area`);
    await expect(page.locator('[data-by-area-view]')).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({
      path: `${SHOT_DIR}/04-by-area.png`,
      fullPage: true,
    });
    await page.screenshot({
      path: `${TOP_DIR}/04-by-area.png`,
      fullPage: true,
    });

    // 05 — task form with Advanced collapsible OPEN + Active months filled
    await page.goto(`${homeUrl}/tasks/new`);
    await expect(page.locator('#task-name')).toBeVisible();
    // Fill some fields so the screenshot looks realistic
    await page.fill('#task-name', 'Rake autumn leaves');
    await page.fill('#task-freq', '60');
    // Click the Advanced trigger (collapsible)
    const advancedTrigger = page.getByRole('button', { name: /advanced/i });
    await advancedTrigger.click();
    await page.waitForTimeout(200);
    // Fill "Last done"
    await page.fill('#task-last-done', isoDate(inDays(-14)));
    // Active months: Oct -> Mar
    await page.locator('#task-active-from').selectOption('10');
    await page.locator('#task-active-to').selectOption('3');
    await page.waitForTimeout(300);
    await page.screenshot({
      path: `${SHOT_DIR}/05-task-form-advanced.png`,
      fullPage: true,
    });
    await page.screenshot({
      path: `${TOP_DIR}/05-person.png`,
      fullPage: true,
    });

    // 06 — Settings → Scheduling → Rebalance preview dialog
    await page.goto(`${homeUrl}/settings/scheduling`);
    await expect(page.locator('[data-testid="rebalance-trigger"]')).toBeVisible();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="rebalance-trigger"]').click();
    const rebalanceDialog = page.locator('[data-testid="rebalance-dialog"]');
    await expect(rebalanceDialog).toBeVisible();
    // Wait for preview counts OR empty-state to populate
    const countsOrEmpty = page
      .locator('[data-testid="rebalance-counts"], [data-testid="rebalance-empty"]')
      .first();
    await countsOrEmpty.waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForTimeout(400);
    await page.screenshot({
      path: `${SHOT_DIR}/06-settings-scheduling-rebalance.png`,
      fullPage: false,
    });
    await page.screenshot({
      path: `${TOP_DIR}/06-history.png`,
      fullPage: false,
    });
    await page.locator('[data-testid="rebalance-cancel"]').click();
    await expect(rebalanceDialog).toBeHidden();

    // 07 — One-off toggle: go to new task page, flip Recurring → One-off
    await page.goto(`${homeUrl}/tasks/new`);
    await expect(page.locator('#task-name')).toBeVisible();
    await page.fill('#task-name', 'Book boiler service');
    // Flip radio to one-off
    await page.locator('input[name="task_type_ui"][value="one-off"]').check();
    await page.waitForTimeout(250);
    // Set a do-by date
    await page.fill('#task-due-date', isoDate(inDays(21)));
    await page.waitForTimeout(200);
    await page.screenshot({
      path: `${SHOT_DIR}/07-one-off-toggle.png`,
      fullPage: true,
    });
    await page.screenshot({
      path: `${TOP_DIR}/07-settings.png`,
      fullPage: true,
    });

    // 09 — TaskDetailSheet on a shifted task showing Schedule section
    await page.goto(homeUrl);
    await expect(page.locator('[data-band-view]')).toBeVisible();
    await page.waitForTimeout(400);
    const shiftedRow2 = page.locator('[data-task-name="Vacuum living room"]');
    await expect(shiftedRow2).toBeVisible();
    await shiftedRow2.click({ button: 'right' });
    await expect(page.locator('[data-testid="task-detail-sheet"]')).toBeVisible();
    // Ensure the detail-schedule section rendered (proves displaced)
    const schedSection = page.locator('[data-testid="detail-schedule"]');
    if (await schedSection.count()) {
      await expect(schedSection).toBeVisible();
    }
    await page.waitForTimeout(400);
    await page.screenshot({
      path: `${SHOT_DIR}/09-task-detail-schedule-shift.png`,
      fullPage: false,
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // ─── Mobile viewport ─────────────────────────────────────────────
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(homeUrl);
    await expect(page.locator('[data-band-view]')).toBeVisible();
    await page.waitForTimeout(600);

    // 08 — mobile dashboard
    await page.screenshot({
      path: `${SHOT_DIR}/08-mobile-dashboard.png`,
      fullPage: true,
    });
    await page.screenshot({
      path: `${TOP_DIR}/08-mobile-dashboard.png`,
      fullPage: true,
    });
  });
});
