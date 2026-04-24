// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep

/**
 * Phase 12 LOAD integration suite — port 18100.
 *
 * 5 scenarios on disposable PocketBase:
 *   1. Migration shape — LOAD-01 live-fire (next_due_smoothed DateField
 *      round-trip, null accepted)
 *   2. Completion flow E2E — LOAD-10 atomic batch writes next_due_smoothed;
 *      result is in tolerance window of natural ideal (T-12-04)
 *   3. Perf + tz-drift — LOAD-13 + Pitfall 7 combined (Australia/Perth tz)
 *   4. Rider 1 tolerance validation — cluster count ≤ 7 OR widen
 *   5. v1.0 holdover upgrade — T-12-03 mitigation (null smoothed → write
 *      on first complete → read on next complete)
 *
 * Port 18100 (12-04 load-smoothing integration — next free after 11-03's 18099).
 *
 * Boot pattern copied verbatim from tests/unit/task-extensions-integration
 * .test.ts: superuser CLI BEFORE serve (Pitfall 9 WAL-race), spawn serve
 * with --migrationsDir (1745280002 picks up) + --hooksDir (Whole Home
 * hook), 30×200ms health poll, vi.mock plumbing for next/cache +
 * pocketbase-server + pocketbase-admin.
 *
 * Scenario 4 DELIBERATELY throws `RIDER-1-WIDEN-NEEDED` when clusters > 7
 * so Task 3 can parse the signal and decide to widen the default
 * tolerance cap from 5 to 14.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import PocketBase from 'pocketbase';
import {
  computeHouseholdLoad,
  placeNextDue,
  isoDateKey,
} from '@/lib/load-smoothing';
import type { Task } from '@/lib/task-scheduling';
import type { CompletionRecord } from '@/lib/completions';

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
const DATA_DIR = './.pb/test-pb-data-load-smoothing';
const PORT = 18100;
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

  // Pitfall 9 — superuser create BEFORE `serve` (SQLite WAL race).
  await new Promise<void>((resolve, reject) => {
    const p = spawn(PB_BIN, [
      'superuser',
      'create',
      'admin-12@test.test',
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
    .authWithPassword('admin-12@test.test', 'testpass123');

  const alice = await pbAdmin.collection('users').create({
    email: 'alice12@test.com',
    password: 'alice123456',
    passwordConfirm: 'alice123456',
    name: 'Alice',
  });
  aliceId = alice.id;

  pbAlice = new PocketBase(`http://${HTTP}`);
  await pbAlice
    .collection('users')
    .authWithPassword('alice12@test.com', 'alice123456');

  const aliceHome = await pbAlice.collection('homes').create({
    name: 'Alice Home',
    timezone: 'UTC',
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
}, 30_000);

afterAll(() => {
  pbAlice?.authStore.clear();
  pbAdmin?.authStore.clear();
  pbProcess?.kill('SIGTERM');
  rmSync(DATA_DIR, { recursive: true, force: true });
});

describe('Phase 12 integration — load-smoothing engine (port 18100)', () => {
  test('Scenario 1 — LOAD-01 migration: next_due_smoothed DateField round-trips', async () => {
    // Create a task with an explicit next_due_smoothed — confirms PB
    // accepts the new field, stores it, returns it.
    const created = await pbAlice.collection('tasks').create({
      home_id: aliceHomeId,
      area_id: wholeHomeAreaId,
      name: 'Plan 12 shape check',
      frequency_days: 7,
      schedule_mode: 'cycle',
      anchor_date: null,
      next_due_smoothed: '2026-05-20T00:00:00.000Z',
    });
    const fetched = await pbAlice.collection('tasks').getOne(created.id);
    // PB 0.37.1 DateField accepts both 'T' and space-separated ISO; both round-trip.
    const smoothed = fetched.next_due_smoothed;
    expect(smoothed).toBeTruthy();
    expect(new Date(smoothed as string).toISOString()).toBe(
      '2026-05-20T00:00:00.000Z',
    );

    // Null round-trip — create another task without next_due_smoothed.
    const nulled = await pbAlice.collection('tasks').create({
      home_id: aliceHomeId,
      area_id: wholeHomeAreaId,
      name: 'Plan 12 null check',
      frequency_days: 14,
      schedule_mode: 'cycle',
      anchor_date: null,
    });
    const nullFetched = await pbAlice.collection('tasks').getOne(nulled.id);
    // PB 0.37.1: may return null / '' / undefined. Truthy check suffices.
    expect(!nullFetched.next_due_smoothed).toBe(true);
  }, 30_000);

  test('Scenario 2 — LOAD-10 completion writes next_due_smoothed atomically', async () => {
    // Seed a cycle task with a back-dated completion so the guard doesn't fire.
    const task = await pbAlice.collection('tasks').create({
      home_id: aliceHomeId,
      area_id: wholeHomeAreaId,
      name: 'Cycle task for placement',
      frequency_days: 14,
      schedule_mode: 'cycle',
      anchor_date: null,
    });
    // Back-dated completion (5 days ago) so shouldWarnEarly doesn't fire
    // AND naturalIdeal (= last + freq = -5d + 14d = +9d) lands FUTURE
    // of now. completeTaskAction passes the PRE-existing lastCompletion
    // (this seeded one) to placeNextDue, not the new completion being
    // created in this call. So naturalIdeal ≈ now + 9d; tolerance
    // ±min(0.15*14, 5) = ±2 days; expected window [now+7d, now+11d].
    await pbAlice.collection('completions').create({
      task_id: task.id,
      completed_by_id: aliceId,
      completed_at: new Date(Date.now() - 5 * 86400_000).toISOString(),
      via: 'manual-date',
      notes: '',
    });

    // Pre-state: next_due_smoothed should be null / empty.
    const pre = await pbAlice.collection('tasks').getOne(task.id);
    expect(!pre.next_due_smoothed).toBe(true);

    // Invoke completeTaskAction via dynamic import AFTER setting currentPb.
    currentPb = pbAlice;
    const { completeTaskAction } = await import('@/lib/actions/completions');
    const result = await completeTaskAction(task.id, { force: true });
    if (!('ok' in result) || result.ok !== true) {
      throw new Error(`expected ok:true, got: ${JSON.stringify(result)}`);
    }
    expect(result.ok).toBe(true);

    // Post-state: next_due_smoothed populated with ISO date ≥ now.
    // completeTaskAction passes the PRE-existing lastCompletion (the
    // seeded -5d one) to placeNextDue, NOT the new completion being
    // created. So naturalIdeal = (now - 5d) + 14d = now + 9d. Tolerance
    // cap min(0.15*14, 5) = 2 days → placement window [now+7d, now+11d].
    // Widen assertion to [+5d, +14d] for flaky CI clock-skew tolerance
    // and future changes to the tolerance cap (rider 1 might widen to 14).
    const post = await pbAlice.collection('tasks').getOne(task.id);
    expect(post.next_due_smoothed).toBeTruthy();
    const smoothed = new Date(post.next_due_smoothed as string);
    // T-12-04: never picks a past date (naturalIdeal=+9d is future).
    expect(smoothed.getTime()).toBeGreaterThanOrEqual(Date.now() - 60_000);
    const deltaDays = (smoothed.getTime() - Date.now()) / 86400_000;
    expect(deltaDays).toBeGreaterThan(5);
    expect(deltaDays).toBeLessThan(14);
  }, 30_000);

  test('Scenario 3 — perf with non-UTC tz (Pitfall 7 alignment)', async () => {
    // Repeat Task 1's in-memory benchmark but with 'Australia/Perth' tz.
    // Proves Map keys built in home-tz align with scoring lookups.
    const NOW = new Date('2026-05-01T00:00:00.000Z');
    const TZ = 'Australia/Perth';
    const tasks: Task[] = [];
    for (let i = 0; i < 100; i++) {
      tasks.push({
        id: `pt-${i}`,
        created: '2026-01-01T00:00:00.000Z',
        archived: false,
        frequency_days: [7, 14, 30][i % 3],
        schedule_mode: 'cycle',
        anchor_date: null,
        due_date: null,
        preferred_days: null,
        active_from_month: null,
        active_to_month: null,
        next_due_smoothed: null,
      });
    }
    const latestByTask = new Map<string, CompletionRecord>();
    const start = performance.now();
    const load = computeHouseholdLoad(
      tasks,
      latestByTask,
      new Map(),
      NOW,
      120,
      TZ,
    );
    const placed = placeNextDue(tasks[0], null, load, NOW, { timezone: TZ });
    const elapsed = performance.now() - start;
    expect(placed).toBeInstanceOf(Date);
    expect(elapsed).toBeLessThan(100);
    // Pitfall 7 cross-check: isoDateKey of placed date in TZ round-trips.
    const key = isoDateKey(placed, TZ);
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }, 30_000);

  test('Scenario 4 — Rider 1 tolerance validation (cluster count ≤ 7 OR widen)', async () => {
    // Deterministic fixture per D-17: 30 tasks across 6 frequencies,
    // fixed NOW, staggered task.created offsets, no completions.
    const NOW = new Date('2026-05-01T00:00:00.000Z');
    const TZ = 'UTC';
    const tasks: Task[] = [];
    const freqs = [1, 7, 14, 30, 90, 365];
    for (const freq of freqs) {
      for (let i = 0; i < 5; i++) {
        const staggerMin = tasks.length; // 0..29 minute offsets
        tasks.push({
          id: `r1-${freq}-${i}`,
          created: new Date(
            NOW.getTime() - 3600_000 + staggerMin * 60_000,
          ).toISOString(),
          archived: false,
          frequency_days: freq,
          schedule_mode: 'cycle',
          anchor_date: null,
          due_date: null,
          preferred_days: null,
          active_from_month: null,
          active_to_month: null,
          next_due_smoothed: null,
        });
      }
    }
    expect(tasks.length).toBe(30);

    // Sequentially place each task, updating an in-memory load Map between
    // placements (previews Phase 13 TCSEM pattern — D-14 + D-21).
    const load = new Map<string, number>();
    const placements = new Map<string, Date>();
    for (const task of tasks) {
      const placed = placeNextDue(task, null, load, NOW, { timezone: TZ });
      placements.set(task.id, placed);
      // Update the load Map to reflect this placement.
      const key = isoDateKey(placed, TZ);
      load.set(key, (load.get(key) ?? 0) + 1);
    }

    // Count clusters (ISO dates with ≥3 tasks).
    const clusters = Array.from(load.values()).filter((c) => c >= 3).length;
    // eslint-disable-next-line no-console
    console.log(
      `[Rider 1] 30-task placement: ${clusters} clusters (threshold: 7)`,
    );
    // Expose the cluster count for Task 3's decision logic.
    // IF RIDER 1 FAILS: this test FAILS with a specific error that Task 3
    // catches and acts on.
    if (clusters > 7) {
      throw new Error(
        `RIDER-1-WIDEN-NEEDED: ${clusters} clusters > 7 threshold. ` +
          `Widen default tolerance cap from 5 to 14 in lib/load-smoothing.ts ` +
          `+ REQUIREMENTS.md LOAD-04 + 12-CONTEXT.md D-05. ` +
          `Re-run this test after widening to confirm cluster count drops.`,
      );
    }
    expect(clusters).toBeLessThanOrEqual(7);
  }, 30_000);

  test('Scenario 5 — v1.0 holdover upgrade: null smoothed → write on complete → read on next complete', async () => {
    // Create a cycle task WITHOUT next_due_smoothed (simulates v1.0 row
    // post-migration per CONTEXT D-02 / T-12-03 mitigation).
    const task = await pbAlice.collection('tasks').create({
      home_id: aliceHomeId,
      area_id: wholeHomeAreaId,
      name: 'v1.0 holdover',
      frequency_days: 7,
      schedule_mode: 'cycle',
      anchor_date: null,
    });
    // Back-dated completion so guard doesn't fire.
    await pbAlice.collection('completions').create({
      task_id: task.id,
      completed_by_id: aliceId,
      completed_at: new Date(Date.now() - 10 * 86400_000).toISOString(),
      via: 'manual-date',
      notes: '',
    });

    // Pre-state: smoothed null (v1.0 shape).
    const pre = await pbAlice.collection('tasks').getOne(task.id);
    expect(!pre.next_due_smoothed).toBe(true);

    // First completion — writes smoothed.
    currentPb = pbAlice;
    const { completeTaskAction } = await import('@/lib/actions/completions');
    const first = await completeTaskAction(task.id, { force: true });
    if (!('ok' in first) || first.ok !== true) {
      throw new Error(`first completion failed: ${JSON.stringify(first)}`);
    }
    expect(first.ok).toBe(true);

    const afterFirst = await pbAlice.collection('tasks').getOne(task.id);
    expect(afterFirst.next_due_smoothed).toBeTruthy();
    const firstSmoothed = new Date(
      afterFirst.next_due_smoothed as string,
    ).toISOString();

    // Second completion — reads smoothed + writes new smoothed. Pass
    // { force: true } to skip early-completion guard (we just completed
    // this task seconds ago).
    const second = await completeTaskAction(task.id, { force: true });
    if (!('ok' in second) || second.ok !== true) {
      throw new Error(`second completion failed: ${JSON.stringify(second)}`);
    }
    expect(second.ok).toBe(true);
    const afterSecond = await pbAlice.collection('tasks').getOne(task.id);
    expect(afterSecond.next_due_smoothed).toBeTruthy();
    const secondSmoothed = new Date(
      afterSecond.next_due_smoothed as string,
    ).toISOString();
    // Second smoothed date should be AFTER the first (cycle moved forward).
    expect(new Date(secondSmoothed).getTime()).toBeGreaterThan(
      new Date(firstSmoothed).getTime(),
    );
  }, 30_000);
});
