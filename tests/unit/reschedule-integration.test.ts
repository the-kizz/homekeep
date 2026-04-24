// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep

/**
 * Phase 15 Plan 15-03 — Reschedule integration suite on port 18103
 * (next free after 14-02's 18102).
 *
 * 4 scenarios on disposable PocketBase prove the end-to-end contract
 * of Phase 15:
 *
 *   Scenario 1 (OOFT-04 + SNZE-01 + SNZE-03 + Phase 11 archive): full
 *     OOFT lifecycle — create → snooze → complete → archive + override
 *     consumed atomically in Phase 10+11 batch.
 *   Scenario 2 (SNZE-07): from-now-on on cycle task writes
 *     next_due_smoothed + reschedule_marker; anchor_date untouched.
 *   Scenario 3 (SNZE-07): from-now-on on anchored task writes
 *     anchor_date + reschedule_marker; next_due_smoothed untouched.
 *   Scenario 4 (SNZE-08): cross-season snooze — ExtendWindowDialog
 *     flow widens active_to via updateTask then snoozeTaskAction
 *     lands the override for the October date.
 *
 * Boot scaffold — copied 1:1 from tests/unit/seasonal-ui-integration
 * .test.ts (port 18102) with three substitutions:
 *   - DATA_DIR = './.pb/test-pb-data-reschedule'
 *   - PORT     = 18103
 *   - Emails   = admin-15@test.test / alice15@test.com
 *
 * Port allocation register advances: 18090..18102 → 18103 (this file).
 * Next free: 18104 (reserved for Phase 16+).
 */

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import PocketBase from 'pocketbase';

let currentPb: PocketBase | null = null;

vi.mock('next/cache', () => ({
  revalidatePath: () => {},
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

vi.mock('@/lib/pocketbase-server', () => ({
  createServerClient: async () => currentPb,
}));

vi.mock('@/lib/pocketbase-admin', () => ({
  createAdminClient: async () => currentPb,
  resetAdminClientCache: () => {},
}));

const PB_BIN = './.pb/pocketbase';
const DATA_DIR = './.pb/test-pb-data-reschedule';
const PORT = 18103; // Phase 15 Plan 15-03 claim — next free: 18104
const HTTP = `127.0.0.1:${PORT}`;

let pbProcess: ChildProcess | undefined;
let pbAdmin: PocketBase;
let pbAlice: PocketBase;
let aliceId: string;
let aliceHomeId: string;
let wholeHomeAreaId: string;

beforeAll(async () => {
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });

  // Pitfall 9 — superuser create BEFORE `serve` (SQLite WAL race
  // if the serve process and the CLI create contend for the DB).
  await new Promise<void>((resolve, reject) => {
    const p = spawn(PB_BIN, [
      'superuser',
      'create',
      'admin-15@test.test',
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

  // ─── Seed: admin, Alice, Alice home (Whole Home area auto-created) ──
  pbAdmin = new PocketBase(`http://${HTTP}`);
  await pbAdmin
    .collection('_superusers')
    .authWithPassword('admin-15@test.test', 'testpass123');

  const alice = await pbAdmin.collection('users').create({
    email: 'alice15@test.com',
    password: 'alice123456',
    passwordConfirm: 'alice123456',
    name: 'Alice',
  });
  aliceId = alice.id;

  pbAlice = new PocketBase(`http://${HTTP}`);
  await pbAlice
    .collection('users')
    .authWithPassword('alice15@test.com', 'alice123456');

  const aliceHome = await pbAlice.collection('homes').create({
    name: 'Alice Home 15',
    timezone: 'Australia/Perth',
    owner_id: aliceId,
  });
  aliceHomeId = aliceHome.id;

  // Whole Home area auto-created by hook.
  const areas = await pbAlice.collection('areas').getFullList({
    filter: `home_id = "${aliceHomeId}"`,
    batch: 500,
  });
  if (areas.length === 0) {
    throw new Error('Whole Home area was not auto-created by hook');
  }
  wholeHomeAreaId = areas[0].id;

  // Bind the vi.mock's createServerClient + createAdminClient to
  // Alice's authed client. Phase 15 server actions run against this.
  currentPb = pbAlice;
}, 30_000);

afterAll(() => {
  pbAlice?.authStore.clear();
  pbAdmin?.authStore.clear();
  pbProcess?.kill('SIGTERM');
  rmSync(DATA_DIR, { recursive: true, force: true });
});

describe('Phase 15 integration — reschedule + OOFT (port 18103)', () => {
  test('Scenario 1: OOFT full lifecycle (create → snooze → complete → archive)', async () => {
    currentPb = pbAlice;
    const now = new Date();
    const dueIso = new Date(now.getTime() + 86400000).toISOString(); // tomorrow

    // 1a: Create OOFT task directly via pbAlice (simulates form submission
    // where task_type=one-off sets frequency_days=null + due_date).
    const ooftTask = await pbAlice.collection('tasks').create({
      home_id: aliceHomeId,
      area_id: wholeHomeAreaId,
      name: 'One-off (S1)',
      frequency_days: null, // D-01 OOFT — null = no cycle
      schedule_mode: 'cycle', // D-02 — anchored disallowed for OOFT
      anchor_date: null,
      archived: false,
      due_date: dueIso,
    });
    // PB 0.37.1 stores a cleared NumberField as `0` on the wire — both
    // null and 0 route through the isOoftTask() guard in lib/task-
    // scheduling.ts. Accept either here.
    expect(
      ooftTask.frequency_days == null || ooftTask.frequency_days === 0,
    ).toBe(true);
    expect(ooftTask.due_date).toBeTruthy();

    // 1b: Snooze the OOFT task to the day after tomorrow.
    const snoozeIso = new Date(now.getTime() + 2 * 86400000).toISOString();
    const { snoozeTaskAction } = await import('@/lib/actions/reschedule');
    const snoozeRes = await snoozeTaskAction({
      task_id: ooftTask.id,
      snooze_until: snoozeIso,
    });
    if (!snoozeRes.ok) throw new Error('snooze failed: ' + snoozeRes.formError);
    expect(snoozeRes.override.id).toBeTruthy();

    // 1c: Verify override row lives in PB, active (consumed_at = null).
    const { getActiveOverride } = await import('@/lib/schedule-overrides');
    const activeOv = await getActiveOverride(pbAlice, ooftTask.id);
    expect(activeOv?.id).toBe(snoozeRes.override.id);
    expect(activeOv?.consumed_at).toBeFalsy();

    // 1d: Complete the OOFT task — Phase 10 + Phase 11 batch must
    // (a) create a completions row, (b) set override.consumed_at, (c)
    // archive the OOFT task — all atomically.
    const { completeTaskAction } = await import('@/lib/actions/completions');
    const completeRes = await completeTaskAction(ooftTask.id, { force: true });
    expect('ok' in completeRes && completeRes.ok === true).toBe(true);

    // 1e: Verify archive landed.
    const reRead = await pbAlice.collection('tasks').getOne(ooftTask.id);
    expect(reRead.archived).toBe(true);

    // 1f: Verify override was consumed atomically.
    const postOv = await getActiveOverride(pbAlice, ooftTask.id);
    expect(postOv).toBeNull();
  }, 30_000);

  test('Scenario 2: From-now-on on cycle task writes next_due_smoothed + reschedule_marker', async () => {
    currentPb = pbAlice;
    const cycleTask = await pbAlice.collection('tasks').create({
      home_id: aliceHomeId,
      area_id: wholeHomeAreaId,
      name: 'Cycle (S2)',
      frequency_days: 30,
      schedule_mode: 'cycle',
      anchor_date: null,
      archived: false,
    });
    expect(cycleTask.next_due_smoothed).toBeFalsy();
    expect(cycleTask.reschedule_marker).toBeFalsy();

    const newDateIso = new Date(Date.now() + 10 * 86400000).toISOString();
    const { rescheduleTaskAction } = await import('@/lib/actions/reschedule');
    const res = await rescheduleTaskAction({
      task_id: cycleTask.id,
      new_date: newDateIso,
    });
    if (!res.ok) throw new Error('reschedule failed: ' + res.formError);

    const row = await pbAlice.collection('tasks').getOne(cycleTask.id);
    // next_due_smoothed set to new_date (ISO date portion match).
    expect(row.next_due_smoothed).toBeTruthy();
    expect(String(row.next_due_smoothed).slice(0, 10)).toBe(
      newDateIso.slice(0, 10),
    );
    // reschedule_marker set to a fresh ISO-ish timestamp. PB 0.37.1's
    // DateField read-back uses a space separator ('YYYY-MM-DD HH:MM:SS.mmmZ')
    // even though the stored value was written as an ISO 'T' string —
    // the write-side action (lib/actions/reschedule.ts) uses
    // now.toISOString(), so either separator is semantically valid here.
    // Regex accepts both.
    expect(row.reschedule_marker).toBeTruthy();
    expect(String(row.reschedule_marker)).toMatch(/^\d{4}-\d{2}-\d{2}[T ]/);
    // anchor_date UNTOUCHED.
    expect(row.anchor_date).toBeFalsy();
  }, 30_000);

  test('Scenario 3: From-now-on on anchored task writes anchor_date + reschedule_marker', async () => {
    currentPb = pbAlice;
    const anchorIso = new Date(Date.now() + 5 * 86400000).toISOString();
    const anchoredTask = await pbAlice.collection('tasks').create({
      home_id: aliceHomeId,
      area_id: wholeHomeAreaId,
      name: 'Anchored (S3)',
      frequency_days: 365,
      schedule_mode: 'anchored',
      anchor_date: anchorIso,
      archived: false,
    });
    expect(anchoredTask.reschedule_marker).toBeFalsy();

    const newDateIso = new Date(Date.now() + 15 * 86400000).toISOString();
    const { rescheduleTaskAction } = await import('@/lib/actions/reschedule');
    const res = await rescheduleTaskAction({
      task_id: anchoredTask.id,
      new_date: newDateIso,
    });
    if (!res.ok) throw new Error('reschedule failed: ' + res.formError);

    const row = await pbAlice.collection('tasks').getOne(anchoredTask.id);
    // anchor_date updated to new_date (ISO date portion match).
    expect(String(row.anchor_date).slice(0, 10)).toBe(newDateIso.slice(0, 10));
    // reschedule_marker set. PB 0.37.1 DateField read-back uses space
    // separator; regex accepts both T and space (see Scenario 2 note).
    expect(row.reschedule_marker).toBeTruthy();
    expect(String(row.reschedule_marker)).toMatch(/^\d{4}-\d{2}-\d{2}[T ]/);
    // next_due_smoothed UNTOUCHED.
    expect(row.next_due_smoothed).toBeFalsy();
  }, 30_000);

  test('Scenario 4: Cross-season snooze — extend-window widens active_to then snooze lands', async () => {
    currentPb = pbAlice;
    // Seasonal task Apr-Sep (active_from=4, active_to=9).
    const seasonalTask = await pbAlice.collection('tasks').create({
      home_id: aliceHomeId,
      area_id: wholeHomeAreaId,
      name: 'Seasonal (S4)',
      frequency_days: 30,
      schedule_mode: 'cycle',
      anchor_date: null,
      archived: false,
      active_from_month: 4,
      active_to_month: 9,
    });

    // User wants to snooze to October 15 (month 10 — outside window).
    // The UI's ExtendWindowDialog flow: user clicks "Extend active window"
    // → caller invokes updateTask with widened active_to. Simulate by
    // calling updateTask directly with FormData — mirrors what
    // RescheduleActionSheet's onExtendWindow prop does in Wave 2.
    //
    // T-15-03-04 note: October date is hardcoded to exercise the specific
    // cross-window case. Test expires if wall-clock advances past
    // 2026-10-15; dynamic construction (new Date(year+1, 9, 15)) is the
    // fallback if this becomes a concern.
    const octoberIso = new Date('2026-10-15T12:00:00Z').toISOString();

    // 4a: Widen active_to from 9 → 10 via updateTask (mimics D-12 flow).
    const { updateTask } = await import('@/lib/actions/tasks');
    const fd = new FormData();
    fd.set('home_id', aliceHomeId);
    fd.set('area_id', wholeHomeAreaId);
    fd.set('name', 'Seasonal (S4)');
    fd.set('frequency_days', '30');
    fd.set('schedule_mode', 'cycle');
    fd.set('active_from_month', '4');
    fd.set('active_to_month', '10'); // widened
    const updRes = await updateTask(seasonalTask.id, { ok: false }, fd);
    // updateTask returns ActionState; ok may be true or the action may
    // redirect — just verify the PB row picked up the change.
    const widenedRow = await pbAlice
      .collection('tasks')
      .getOne(seasonalTask.id);
    expect(widenedRow.active_to_month).toBe(10);
    // Silence the unused linter if updRes is unused.
    void updRes;

    // 4b: Now fire the snooze that originally triggered the dialog.
    const { snoozeTaskAction } = await import('@/lib/actions/reschedule');
    const snoozeRes = await snoozeTaskAction({
      task_id: seasonalTask.id,
      snooze_until: octoberIso,
    });
    if (!snoozeRes.ok) throw new Error('snooze failed: ' + snoozeRes.formError);

    // 4c: Verify override row active with snooze_until in October.
    const { getActiveOverride } = await import('@/lib/schedule-overrides');
    const ov = await getActiveOverride(pbAlice, seasonalTask.id);
    expect(ov?.id).toBe(snoozeRes.override.id);
    expect(String(ov?.snooze_until).slice(0, 10)).toBe('2026-10-15');
    expect(ov?.consumed_at).toBeFalsy();

    // 4d: Verify active window now includes October (month 10).
    // isInActiveWindow(10, 4, 10) === true.
    const { isInActiveWindow } = await import('@/lib/task-scheduling');
    expect(isInActiveWindow(10, 4, 10)).toBe(true);
  }, 30_000);
});
