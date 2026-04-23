// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/conroyke56/homekeep
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { addDays } from 'date-fns';
import PocketBase from 'pocketbase';
import {
  computeNextDue,
  type Task as TaskType,
} from '@/lib/task-scheduling';
import { getActiveOverride, type Override } from '@/lib/schedule-overrides';

/**
 * 11-03 Plan Task 1 — disposable-PB integration for Phase 11 task model
 * extensions (D-25, D-27). Four scenarios on port 18099:
 *
 *   1. Migration shape end-to-end (OOFT-01, PREF-01, SEAS-01) — v1.0 shape,
 *      OOFT shape, and full Phase 11 shape all round-trip through PB's
 *      DateField / SelectField / NumberField accept+read paths.
 *   2. OOFT lifecycle create → complete → archived atomically (OOFT-02,
 *      OOFT-03, OOFT-05, T-11-03) — Plan 11-02 Task 3's batch op fires
 *      live; refetched task shows archived === true.
 *   3. Seasonal lifecycle dormant → wake-up (SEAS-02, SEAS-03, SEAS-04) —
 *      exercises Plan 11-02's seasonal-wakeup, seasonal-dormant, and
 *      cross-year-wrap branches against real PB rows.
 *   4. Override × dormant composition — D-17 override wins (T-11-05
 *      by-design) — prevents regressions in the branch-order guarantee.
 *
 * Port 18099 — allocation log: 18090 (02-01), 18091 (03-01), 18092/18093
 * (04-01), 18094 (04-02), 18095 (05-01), 18096 (06-01), 18097 (06-02),
 * 18098 (10-01 schedule_overrides), 18099 (11-03 task extensions — this
 * file). Next free: 18100.
 *
 * Boot pattern copy-paste from tests/unit/schedule-overrides-integration
 * .test.ts: superuser CLI create BEFORE `serve` (Pitfall 9 WAL-race),
 * spawn serve with --migrationsDir (Plan 11-01 migration applies),
 * --hooksDir (Whole Home area auto-seeded on home create), poll
 * /api/health 30× at 200ms.
 *
 * vi.mock plumbing: Scenario 2 imports `completeTaskAction` dynamically
 * AFTER `currentPb = pbAlice`, so the action's createServerClient /
 * createAdminClient / revalidatePath resolve to our test-local clients.
 * Same pattern as Plan 10-03's Scenario 9 / 10.
 */
let currentPb: PocketBase | null = null;

vi.mock('next/cache', () => ({
  revalidatePath: () => {},
}));

vi.mock('@/lib/pocketbase-server', () => ({
  createServerClient: async () => currentPb,
}));

vi.mock('@/lib/pocketbase-admin', () => ({
  createAdminClient: async () => currentPb,
  resetAdminClientCache: () => {},
}));

const PB_BIN = './.pb/pocketbase';
const DATA_DIR = './.pb/test-pb-data-task-extensions';
const HTTP = '127.0.0.1:18099';

let pbProcess: ChildProcess | undefined;
let pbAdmin: PocketBase;
let pbAlice: PocketBase;
let aliceId: string;
let aliceHomeId: string;
let aliceAreaId: string;

beforeAll(async () => {
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });

  // Pitfall 9 — superuser create BEFORE `serve` (SQLite WAL race if the
  // serve process and the CLI create contend for the DB).
  await new Promise<void>((resolve, reject) => {
    const p = spawn(PB_BIN, [
      'superuser',
      'create',
      'test@test.com',
      'testpass123',
      `--dir=${DATA_DIR}`,
    ]);
    let stderr = '';
    p.stderr?.on('data', (d) => (stderr += d.toString()));
    p.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(`superuser create failed (code ${code}): ${stderr}`),
          ),
    );
  });

  pbProcess = spawn(PB_BIN, [
    'serve',
    `--http=${HTTP}`,
    `--dir=${DATA_DIR}`,
    '--migrationsDir=./pocketbase/pb_migrations',
    '--hooksDir=./pocketbase/pb_hooks',
  ]);

  let healthy = false;
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`http://${HTTP}/api/health`);
      if (r.ok) {
        healthy = true;
        break;
      }
    } catch {
      /* not ready yet */
    }
    await new Promise((res) => setTimeout(res, 200));
  }
  if (!healthy) throw new Error('PB did not start within 6s');

  // ─── Seed: admin, Alice, Alice home (Whole Home area auto-created) ────
  pbAdmin = new PocketBase(`http://${HTTP}`);
  await pbAdmin
    .collection('_superusers')
    .authWithPassword('test@test.com', 'testpass123');

  const alice = await pbAdmin.collection('users').create({
    email: 'alice@test.com',
    password: 'alice123456',
    passwordConfirm: 'alice123456',
    name: 'Alice',
  });
  aliceId = alice.id;

  pbAlice = new PocketBase(`http://${HTTP}`);
  await pbAlice
    .collection('users')
    .authWithPassword('alice@test.com', 'alice123456');

  const aliceHome = await pbAlice.collection('homes').create({
    name: 'Alice Home',
    timezone: 'UTC',
    owner_id: aliceId,
  });
  aliceHomeId = aliceHome.id;

  // The homes_whole_home.pb.js hook auto-creates a "Whole Home" area on
  // home create — read it back so tasks can reference area_id.
  const areas = await pbAlice.collection('areas').getFullList({
    filter: `home_id = "${aliceHomeId}"`,
    batch: 500,
  });
  if (areas.length === 0) {
    throw new Error('Whole Home area was not auto-created by hook');
  }
  aliceAreaId = areas[0].id;
}, 30_000);

afterAll(() => {
  pbAlice?.authStore.clear();
  pbAdmin?.authStore.clear();
  pbProcess?.kill('SIGTERM');
  rmSync(DATA_DIR, { recursive: true, force: true });
});

describe('Phase 11 integration — task model extensions (port 18099)', () => {
  test('Scenario 1 — migration shape end-to-end (OOFT-01, PREF-01, SEAS-01)', async () => {
    // 1a — v1.0 shape (no Phase 11 fields) still works. Regression gate
    // for D-26: existing tasks.create call-sites must continue to
    // function byte-identically.
    const v10 = await pbAlice.collection('tasks').create({
      home_id: aliceHomeId,
      area_id: aliceAreaId,
      name: 'v1.0 recurring task',
      frequency_days: 7,
      schedule_mode: 'cycle',
      archived: false,
    });
    expect(v10.id).toBeTruthy();
    // New fields default to null / empty on v1.0 shape.
    expect(
      v10.due_date === '' ||
        v10.due_date === null ||
        v10.due_date === undefined,
    ).toBe(true);
    expect(
      v10.preferred_days === '' ||
        v10.preferred_days === null ||
        v10.preferred_days === undefined,
    ).toBe(true);
    expect(
      v10.active_from_month === null ||
        v10.active_from_month === undefined ||
        v10.active_from_month === 0,
    ).toBe(true);

    // 1b — OOFT shape (frequency_days=null, due_date set). D-02 flipped
    // frequency_days.required to false, D-03 added due_date — both
    // present on the PB storage layer. Zod rejection of OOFT-without-
    // due_date is a separate app-layer concern (T-11-01 accept per
    // threat model — covered at unit level in Plan 11-01).
    const ooft = await pbAlice.collection('tasks').create({
      home_id: aliceHomeId,
      area_id: aliceAreaId,
      name: 'OOFT task',
      frequency_days: null,
      due_date: '2026-05-01 00:00:00.000Z',
      schedule_mode: 'cycle',
      archived: false,
    });
    expect(ooft.id).toBeTruthy();
    // PB 0.37.1 stores cleared NumberField as 0 for the legacy
    // required:true contract path OR null after the D-02 flip. Accept
    // both — the D-05 computeNextDue OOFT branch guards on
    // `frequency_days === null`, which is what PB now returns.
    expect(
      ooft.frequency_days === null ||
        ooft.frequency_days === 0 ||
        ooft.frequency_days === undefined,
    ).toBe(true);
    expect(ooft.due_date).toBeTruthy();

    // 1c — full Phase 11 shape (PREF + SEAS combined). All 4 new fields
    // round-trip with their declared types — SelectField string, two
    // NumberFields clipped to 1..12.
    const full = await pbAlice.collection('tasks').create({
      home_id: aliceHomeId,
      area_id: aliceAreaId,
      name: 'Full Phase 11 task',
      frequency_days: 14,
      schedule_mode: 'cycle',
      archived: false,
      preferred_days: 'weekend',
      active_from_month: 4,
      active_to_month: 9,
    });
    expect(full.preferred_days).toBe('weekend');
    expect(full.active_from_month).toBe(4);
    expect(full.active_to_month).toBe(9);
    // Read-back round-trip — confirm PB persisted (not just echo'd the
    // create response).
    const reread = await pbAlice.collection('tasks').getOne(full.id);
    expect(reread.preferred_days).toBe('weekend');
    expect(reread.active_from_month).toBe(4);
    expect(reread.active_to_month).toBe(9);
  }, 30_000);

  test('Scenario 2 — OOFT lifecycle: create → complete → archived atomically (OOFT-02, OOFT-05)', async () => {
    // Seed a fresh OOFT dedicated to this scenario — scenario-local
    // fixtures avoid order-coupling to Scenario 1.
    const ooft = await pbAlice.collection('tasks').create({
      home_id: aliceHomeId,
      area_id: aliceAreaId,
      name: 'Scenario 2 OOFT',
      frequency_days: null,
      due_date: '2026-05-01 00:00:00.000Z',
      schedule_mode: 'cycle',
      archived: false,
    });

    // Swap test-local pbAlice into the mock closure, then dynamic-import
    // completeTaskAction (same pattern as Plan 10-03 Scenario 9 / 10
    // avoids hoist timing pitfalls). { force: true } skips the early-
    // completion guard since our test task is fresh-created and the
    // guard would otherwise fire.
    currentPb = pbAlice;
    const { completeTaskAction } = await import('@/lib/actions/completions');
    const result = await completeTaskAction(ooft.id, { force: true });

    if (!('ok' in result) || result.ok !== true) {
      throw new Error(
        `expected ok:true, got: ${JSON.stringify(result)}`,
      );
    }
    expect(result).toMatchObject({ ok: true });
    expect(result.completion.id).toBeTruthy();
    expect(result.completion.completed_at).toBeTruthy();

    // T-11-03 live-fire: atomic archive ON the completion batch. If the
    // Plan 11-02 Task 3 batch op hadn't fired (or had run in a separate
    // non-atomic call), refetched.archived would still be false. This
    // assertion is the end-to-end proof that D-04 atomicity extends to
    // the OOFT archive op.
    const refetched = await pbAlice.collection('tasks').getOne(ooft.id);
    expect(refetched.archived).toBe(true);
    // archived_at should also be populated — Plan 11-02 writes
    // `archived_at: now.toISOString()` into the same op.
    expect(refetched.archived_at).toBeTruthy();

    // Completion row exists and is linked to the task.
    const completion = await pbAlice
      .collection('completions')
      .getFirstListItem(
        pbAlice.filter('task_id = {:t}', { t: ooft.id }),
      );
    expect(completion).toBeTruthy();
    expect(completion.task_id).toBe(ooft.id);
    expect(completion.completed_by_id).toBe(aliceId);

    // computeNextDue on the archived OOFT returns null (branch 1
    // archived wins). This closes the D-05 race-safety half: even if
    // a stale lastCompletion=null arrived, branch 1 would still short-
    // circuit on archived=true.
    const task: TaskType = {
      id: refetched.id,
      created: refetched.created as string,
      archived: true,
      frequency_days: null,
      schedule_mode: 'cycle',
      anchor_date: null,
      due_date: refetched.due_date as string,
    };
    const next = computeNextDue(
      task,
      null,
      new Date('2026-05-10T00:00:00.000Z'),
      undefined,
    );
    expect(next).toBeNull();
  }, 30_000);

  test('Scenario 3 — seasonal lifecycle: dormant / wake-up / cross-year-wrap (SEAS-02, SEAS-03, SEAS-04)', async () => {
    // Seed a wrap-window seasonal task (Oct-Mar). The wrap case is the
    // higher-risk path (off-by-one in nextWindowOpenDate's year
    // selection or isInActiveWindow's OR-branch would be caught here).
    const seasonal = await pbAlice.collection('tasks').create({
      home_id: aliceHomeId,
      area_id: aliceAreaId,
      name: 'Scenario 3 seasonal (Oct-Mar)',
      frequency_days: 30,
      schedule_mode: 'cycle',
      archived: false,
      active_from_month: 10,
      active_to_month: 3,
    });

    // Shape the task in the computeNextDue expected form — read fields
    // from the just-created PB record so we're running against real
    // stored values, not hardcoded constants.
    const task: TaskType = {
      id: seasonal.id,
      created: seasonal.created as string,
      archived: false,
      frequency_days: seasonal.frequency_days as number,
      schedule_mode: 'cycle',
      anchor_date: null,
      active_from_month: seasonal.active_from_month as number,
      active_to_month: seasonal.active_to_month as number,
    };

    // Case A — wake-up from dormant month: July (dormant), no completion
    // → Oct 1, 2026 (SEAS-03 first-cycle wake-up). lastCompletion is null
    // so wasInPriorSeason returns true; wake-up branch fires; anchors to
    // from-month start in home tz ('UTC' here).
    const caseA = computeNextDue(
      task,
      null,
      new Date('2026-07-15T12:00:00.000Z'),
      undefined,
      'UTC',
    );
    expect(caseA?.toISOString()).toBe('2026-10-01T00:00:00.000Z');

    // Case B — fresh task whose current month IS in-window → natural
    // cadence wins (Phase 19 PATCH-02 semantics). Pre-patch this
    // branch unconditionally returned 2027-10-01 (next year's from-
    // boundary) even though the task was "already awake" in Nov. The
    // guard now suppresses wake-up when (inWindowNow && !lastCompletion)
    // so a fresh in-window seasonal task renders its natural first-
    // cycle date = task.created + frequency_days. No completion exists,
    // so the base is task.created (server-generated at test runtime).
    const caseB = computeNextDue(
      task,
      null,
      new Date('2026-11-15T12:00:00.000Z'),
      undefined,
      'UTC',
    );
    const expectedCaseB = addDays(
      new Date(seasonal.created as string),
      seasonal.frequency_days as number,
    ).toISOString();
    expect(caseB?.toISOString()).toBe(expectedCaseB);

    // Case C — dormant with prior in-season completion: seed a
    // completion at Jan 10, 2026 (in-season). wasInPriorSeason returns
    // false (in-window month + within-365d elapsed). Now=Jul 2026 is
    // out-of-window. The branch composition from Plan 11-02 Deviation
    // 1 fires seasonal-dormant (!inWindowNow && !lastInPriorSeason) →
    // returns null. This is SEAS-02 — same-season dormancy.
    await pbAlice.collection('completions').create({
      task_id: seasonal.id,
      completed_by_id: aliceId,
      completed_at: '2026-01-10 00:00:00.000Z',
      via: 'tap',
      notes: '',
    });
    const caseC = computeNextDue(
      task,
      { completed_at: '2026-01-10T00:00:00.000Z' },
      new Date('2026-07-15T12:00:00.000Z'),
      undefined,
      'UTC',
    );
    expect(caseC).toBeNull();
  }, 30_000);

  test('Scenario 4 — override × dormant composition wins per D-17 (T-11-05)', async () => {
    // Seed a wrap-window seasonal task. Separate from Scenario 3 so
    // completion history / override state don't collide.
    const seasonal = await pbAlice.collection('tasks').create({
      home_id: aliceHomeId,
      area_id: aliceAreaId,
      name: 'Scenario 4 override × dormant',
      frequency_days: 30,
      schedule_mode: 'cycle',
      archived: false,
      active_from_month: 10,
      active_to_month: 3,
    });

    // Seed a prior in-season completion so the task is definitionally
    // "dormant in July" (not "first-cycle wake-up"). Without this
    // completion, the wake-up branch would win instead of dormant —
    // we need the dormant branch to be what the override beats.
    await pbAlice.collection('completions').create({
      task_id: seasonal.id,
      completed_by_id: aliceId,
      completed_at: '2026-01-10 00:00:00.000Z',
      via: 'tap',
      notes: '',
    });

    // Seed an active override with snooze_until in the dormant window
    // (Aug 1 — month 8 is dormant for Oct-Mar). This is the "user
    // snoozed a dormant seasonal" edge case flagged in D-17.
    await pbAlice.collection('schedule_overrides').create({
      task_id: seasonal.id,
      snooze_until: '2026-08-01 00:00:00.000Z',
      created_by_id: aliceId,
    });

    // Fetch the override the same way the production code path does —
    // via the getActiveOverride helper. This proves the override
    // read-path composes with the dormancy branch order.
    const override = await getActiveOverride(pbAlice, seasonal.id);
    expect(override).not.toBeNull();
    expect(override?.snooze_until).toBeTruthy();

    const task: TaskType = {
      id: seasonal.id,
      created: seasonal.created as string,
      archived: false,
      frequency_days: seasonal.frequency_days as number,
      schedule_mode: 'cycle',
      anchor_date: null,
      active_from_month: seasonal.active_from_month as number,
      active_to_month: seasonal.active_to_month as number,
    };

    const result = computeNextDue(
      task,
      { completed_at: '2026-01-10T00:00:00.000Z' },
      new Date('2026-07-15T12:00:00.000Z'),
      override as Override,
      'UTC',
    );
    // D-17 live-fire: override wins over dormancy. Without D-17 (branch
    // order reversed), this would return null because the seasonal-
    // dormant branch would fire first. Locking this behavior prevents
    // future refactors from silently breaking it; Phase 15 UI will
    // surface a warning dialog but the data layer permits unconditionally.
    expect(result?.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  }, 30_000);
});
