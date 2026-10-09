// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep

/**
 * Phase 17 Plan 17-02 Task 2 — Rebalance integration suite on port 18105
 * (next free after Phase 16's 18104).
 *
 * 3 scenarios on disposable PocketBase prove the end-to-end contract of
 * Phase 17 Manual Rebalance — closing all 7 REBAL REQs behaviorally:
 *
 *   Scenario 1 (REBAL-06): preview counts match live state. Seed a mix
 *     of anchored + active-override + marker + rebalanceable + OOFT +
 *     archived tasks; assert the 5 preview fields exactly.
 *
 *   Scenario 2 (REBAL-01..04, REBAL-07, D-06 marker-clear): apply
 *     updates only rebalanceable tasks' next_due_smoothed, preserves
 *     the 3 preservation buckets, clears the from-now-on marker per
 *     D-06 revision, and distributes same-freq cohort across ≥2
 *     distinct dates (load-map threading proof, REBAL-07).
 *
 *   Scenario 3 (D-12 idempotency): second apply on the same 3
 *     originally-rebalanceable tasks produces bit-identical
 *     next_due_smoothed values. The ex-marker task (now rebalanceable
 *     since the first apply cleared its marker per D-06) may shift —
 *     idempotency is about the STABLE rebalanceable set, not the
 *     absolute updated count.
 *
 * Boot scaffold — copied 1:1 from tests/unit/horizon-density-
 * integration.test.ts (port 18104) with three substitutions:
 *   - DATA_DIR = './.pb/test-pb-data-rebalance'
 *   - PORT     = 18105
 *   - Emails   = admin-17@test.test / alice17@test.com
 *
 * Port allocation register:
 *   18100 — load-smoothing-integration (Phase 12)
 *   18101 — tcsem-integration (Phase 13)
 *   18102 — seasonal-ui-integration (Phase 14)
 *   18103 — reschedule-integration (Phase 15)
 *   18104 — horizon-density-integration (Phase 16)
 *   18105 — rebalance-integration (Phase 17 — THIS FILE)
 *   18106+ — reserved for Phase 18+
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
const DATA_DIR = './.pb/test-pb-data-rebalance';
const PORT = 18105; // Phase 17 Plan 17-02 claim — next free: 18106
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

  // Pitfall 9 — superuser create BEFORE `serve` (SQLite WAL race if
  // the serve process and the CLI create contend for the DB).
  await new Promise<void>((resolve, reject) => {
    const p = spawn(PB_BIN, [
      'superuser',
      'create',
      'admin-17@test.test',
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
    .authWithPassword('admin-17@test.test', 'testpass123');

  const alice = await pbAdmin.collection('users').create({
    email: 'alice17@test.com',
    password: 'alice123456',
    passwordConfirm: 'alice123456',
    name: 'Alice',
  });
  aliceId = alice.id;

  pbAlice = new PocketBase(`http://${HTTP}`);
  await pbAlice
    .collection('users')
    .authWithPassword('alice17@test.com', 'alice123456');

  const aliceHome = await pbAlice.collection('homes').create({
    name: 'Alice Home 17',
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
  // Alice's authed client. Phase 17 REBAL actions run against this.
  currentPb = pbAlice;
}, 30_000);

afterAll(() => {
  pbAlice?.authStore.clear();
  pbAdmin?.authStore.clear();
  pbProcess?.kill('SIGTERM');
  rmSync(DATA_DIR, { recursive: true, force: true });
});

// ─── Shared seed builder ─────────────────────────────────────────

type SeedIds = {
  anchored: string[]; // 2 anchored
  override: string; // 1 cycle + active snooze
  marker: string; // 1 cycle + reschedule_marker
  rebalanceable: string[]; // 3 cycle rebalanceable
  archived: string; // 1 archived (noise)
  ooft: string; // 1 OOFT (excluded by D-02)
};

/**
 * Build the Scenario 1/2 fixture. Returns the ids of each seeded task.
 *
 * Shape (per the PLAN file):
 *   - 2 anchored (schedule_mode='anchored', anchor_date=future)
 *   - 1 cycle + ACTIVE unconsumed schedule_overrides row (snooze_until=future)
 *   - 1 cycle + reschedule_marker set (and next_due_smoothed=future)
 *   - 3 cycle rebalanceable (no override, no marker), freq=14, Whole Home
 *     with the SAME created timestamp (now-7d) so natural ideals cluster
 *     ~now+7d → threading distributes them across ≥2 distinct dates
 *   - 1 archived (must be excluded from all buckets)
 *   - 1 OOFT (frequency_days=null, due_date=future — excluded by D-02)
 */
async function seedRebalanceFixture(): Promise<SeedIds> {
  const now = Date.now();
  const futureIso = (days: number) =>
    new Date(now + days * 86400000).toISOString();
  const pastIso = (days: number) =>
    new Date(now - days * 86400000).toISOString();

  // Anchored #1 + #2 — future anchor dates.
  const a1 = await pbAlice.collection('tasks').create({
    home_id: aliceHomeId,
    area_id: wholeHomeAreaId,
    name: 'Anchored A (S1)',
    frequency_days: 365,
    schedule_mode: 'anchored',
    anchor_date: futureIso(30),
    archived: false,
  });
  const a2 = await pbAlice.collection('tasks').create({
    home_id: aliceHomeId,
    area_id: wholeHomeAreaId,
    name: 'Anchored B (S1)',
    frequency_days: 180,
    schedule_mode: 'anchored',
    anchor_date: futureIso(60),
    archived: false,
  });

  // Override bucket — cycle task with ACTIVE unconsumed override row.
  const ov = await pbAlice.collection('tasks').create({
    home_id: aliceHomeId,
    area_id: wholeHomeAreaId,
    name: 'Override (S1)',
    frequency_days: 14,
    schedule_mode: 'cycle',
    anchor_date: null,
    archived: false,
  });
  await pbAlice.collection('schedule_overrides').create({
    task_id: ov.id,
    snooze_until: futureIso(10),
    consumed_at: null,
    created_by_id: aliceId,
  });

  // Marker bucket — cycle task with reschedule_marker set +
  // next_due_smoothed populated (the "From now on" after-state).
  const mk = await pbAlice.collection('tasks').create({
    home_id: aliceHomeId,
    area_id: wholeHomeAreaId,
    name: 'Marker (S1)',
    frequency_days: 14,
    schedule_mode: 'cycle',
    anchor_date: null,
    archived: false,
    next_due_smoothed: futureIso(20),
    reschedule_marker: new Date(now - 3600_000).toISOString(),
  });

  // Rebalanceable bucket — 3 cycle tasks with identical freq and a
  // back-dated 'created' so natural ideal = created + 14d ≈ now+7d for
  // each. Without load-map threading, all 3 would collapse to the same
  // placed date. WITH threading, Set(placedDates).size >= 2.
  const baseCreated = pastIso(7);
  const r1 = await pbAlice.collection('tasks').create({
    home_id: aliceHomeId,
    area_id: wholeHomeAreaId,
    name: 'Rebal 1 (S1)',
    frequency_days: 14,
    schedule_mode: 'cycle',
    anchor_date: null,
    archived: false,
    created: baseCreated, // PB allows client-supplied `created` on create
  });
  const r2 = await pbAlice.collection('tasks').create({
    home_id: aliceHomeId,
    area_id: wholeHomeAreaId,
    name: 'Rebal 2 (S1)',
    frequency_days: 14,
    schedule_mode: 'cycle',
    anchor_date: null,
    archived: false,
    created: baseCreated,
  });
  const r3 = await pbAlice.collection('tasks').create({
    home_id: aliceHomeId,
    area_id: wholeHomeAreaId,
    name: 'Rebal 3 (S1)',
    frequency_days: 14,
    schedule_mode: 'cycle',
    anchor_date: null,
    archived: false,
    created: baseCreated,
  });

  // Archived noise — must NOT count in any bucket.
  const arch = await pbAlice.collection('tasks').create({
    home_id: aliceHomeId,
    area_id: wholeHomeAreaId,
    name: 'Archived (S1)',
    frequency_days: 14,
    schedule_mode: 'cycle',
    anchor_date: null,
    archived: true,
  });

  // OOFT — excluded by D-02 (frequency_days null).
  const oo = await pbAlice.collection('tasks').create({
    home_id: aliceHomeId,
    area_id: wholeHomeAreaId,
    name: 'OOFT (S1)',
    frequency_days: null,
    schedule_mode: 'cycle',
    anchor_date: null,
    archived: false,
    due_date: futureIso(5),
  });

  return {
    anchored: [a1.id, a2.id],
    override: ov.id,
    marker: mk.id,
    rebalanceable: [r1.id, r2.id, r3.id],
    archived: arch.id,
    ooft: oo.id,
  };
}

/** Wipe ALL tasks + schedule_overrides for Alice's home. */
async function wipeHome() {
  const rows = await pbAlice.collection('tasks').getFullList({
    filter: pbAlice.filter('home_id = {:h}', { h: aliceHomeId }),
    batch: 500,
  });
  for (const r of rows) {
    const overrides = await pbAlice
      .collection('schedule_overrides')
      .getFullList({
        filter: pbAlice.filter('task_id = {:t}', { t: r.id }),
        batch: 500,
      });
    for (const o of overrides) {
      await pbAlice.collection('schedule_overrides').delete(o.id);
    }
    await pbAlice.collection('tasks').delete(r.id);
  }
}

// ─── Tests ───────────────────────────────────────────────────────

describe('Phase 17 integration — rebalance preview + apply (port 18105)', () => {
  test('port 18105 claim present (allocation register lock)', () => {
    expect(PORT).toBe(18105);
  });

  test('Scenario 1 — REBAL-06 preview counts match live state (live-PB classification)', async () => {
    currentPb = pbAlice;
    await wipeHome();
    await seedRebalanceFixture();

    const { rebalancePreviewAction } = await import(
      '@/lib/actions/rebalance'
    );
    const result = await rebalancePreviewAction(aliceHomeId);
    if (!result.ok) {
      throw new Error(`preview failed: ${result.formError}`);
    }

    // 5-field exact match per D-10.
    expect(result.preview.update_count).toBe(3);
    expect(result.preview.preserve_anchored).toBe(2);
    expect(result.preview.preserve_override).toBe(1);
    expect(result.preview.preserve_from_now_on).toBe(1);
    expect(result.preview.preserve_total).toBe(4);
  }, 30_000);

  test('Scenario 2 — REBAL-01..04, REBAL-07, D-06 marker-clear (live-PB apply)', async () => {
    currentPb = pbAlice;
    await wipeHome();
    const ids = await seedRebalanceFixture();

    // Capture pre-apply state for the preserved buckets — anchored +
    // override + marker. next_due_smoothed MUST remain byte-identical
    // post-apply for these three categories.
    const pre = await pbAlice.collection('tasks').getFullList({
      filter: pbAlice.filter('home_id = {:h}', { h: aliceHomeId }),
      batch: 500,
    });
    const byId = (id: string) => pre.find((t) => t.id === id);
    const preAnchored1 = byId(ids.anchored[0])!.next_due_smoothed;
    const preAnchored2 = byId(ids.anchored[1])!.next_due_smoothed;
    const preOverride = byId(ids.override)!.next_due_smoothed;
    const preMarkerSmoothed = byId(ids.marker)!.next_due_smoothed;
    const preArchived = byId(ids.archived)!.next_due_smoothed;
    const preOoft = byId(ids.ooft)!.due_date;

    const { rebalanceApplyAction } = await import('@/lib/actions/rebalance');
    const result = await rebalanceApplyAction(aliceHomeId);
    if (!result.ok) {
      throw new Error(`apply failed: ${result.formError}`);
    }

    // REBAL-04: exactly 3 rebalanceable tasks updated.
    expect(result.updated).toBe(3);

    // Re-fetch post-apply state.
    const post = await pbAlice.collection('tasks').getFullList({
      filter: pbAlice.filter('home_id = {:h}', { h: aliceHomeId }),
      batch: 500,
    });
    const postById = (id: string) => post.find((t) => t.id === id)!;

    // REBAL-01 — anchored tasks UNCHANGED (both sides of the equality).
    expect(postById(ids.anchored[0]).next_due_smoothed).toBe(preAnchored1);
    expect(postById(ids.anchored[1]).next_due_smoothed).toBe(preAnchored2);

    // REBAL-02 — override-preserved task UNCHANGED.
    expect(postById(ids.override).next_due_smoothed).toBe(preOverride);

    // REBAL-03 — from-now-on task's next_due_smoothed UNCHANGED (the
    // value preserved, per REBAL-03).
    expect(postById(ids.marker).next_due_smoothed).toBe(preMarkerSmoothed);

    // D-06 revision — from-now-on task's reschedule_marker now CLEARED.
    // Phase 15 stores cleared DateField as '' via PB 0.37.1; also accept
    // null. Falsy check covers both.
    expect(postById(ids.marker).reschedule_marker).toBeFalsy();

    // REBAL-04 — 3 rebalanceable tasks have non-empty ISO
    // next_due_smoothed values (were null before; should be populated now).
    const postRebal = ids.rebalanceable.map(postById);
    for (const t of postRebal) {
      expect(t.next_due_smoothed).toBeTruthy();
      expect(String(t.next_due_smoothed)).toMatch(/^\d{4}-\d{2}-\d{2}/);
    }

    // REBAL-07 load-map threading proof: the 3 same-freq tasks with
    // identical `created` timestamps cluster around the same natural
    // ideal (now+7d). Without threading, all 3 would land on the same
    // date; WITH threading, subsequent placements see earlier placements'
    // contributions and distribute to ≥2 distinct date keys.
    const dateKeys = new Set(
      postRebal.map((t) => String(t.next_due_smoothed).slice(0, 10)),
    );
    expect(dateKeys.size).toBeGreaterThanOrEqual(2);

    // D-02 exclusions — archived stays archived, OOFT's due_date unchanged.
    expect(postById(ids.archived).archived).toBe(true);
    expect(postById(ids.archived).next_due_smoothed).toBe(preArchived);
    expect(postById(ids.ooft).due_date).toBe(preOoft);
    // OOFT next_due_smoothed must NOT have been populated by rebalance.
    expect(postById(ids.ooft).next_due_smoothed).toBeFalsy();
  }, 30_000);

  test('Scenario 3 — D-12 idempotency across runs on a stable rebalanceable set (bit-identical next_due_smoothed)', async () => {
    currentPb = pbAlice;
    await wipeHome();
    const ids = await seedRebalanceFixture();

    const { rebalanceApplyAction } = await import('@/lib/actions/rebalance');

    // Run 1 — establishes placements for the 3 originally-rebalanceable
    // tasks AND clears the marker. The ex-marker task becomes a normal
    // cycle task for future runs (D-06 revision).
    const run1 = await rebalanceApplyAction(aliceHomeId);
    if (!run1.ok) throw new Error(`run1 failed: ${run1.formError}`);
    expect(run1.updated).toBe(3);

    // Run 2 — rebalanceable set is now 4 (original 3 + ex-marker). This
    // run establishes the new STEADY-STATE placements. Run 1 vs Run 2
    // values differ for the original 3 because the ex-marker's
    // contribution re-enters the sort/threading loop on Run 2 — that's
    // expected behavior (the set changed between runs).
    const run2 = await rebalanceApplyAction(aliceHomeId);
    if (!run2.ok) throw new Error(`run2 failed: ${run2.formError}`);
    expect(run2.updated).toBe(4);

    // Capture post-run-2 state — this is the STABLE baseline for
    // idempotency. From this point forward, the rebalanceable set is
    // 4 tasks; no markers, no overrides will flip; no completions are
    // being added between runs. Run 3 should reproduce exactly Run 2.
    const afterRun2 = await pbAlice.collection('tasks').getFullList({
      filter: pbAlice.filter('home_id = {:h}', { h: aliceHomeId }),
      batch: 500,
    });
    const afterRun2ById = (id: string) =>
      afterRun2.find((t) => t.id === id)!;
    const stableRebalIds = [...ids.rebalanceable, ids.marker]; // 4-task set
    const run2Smoothed = stableRebalIds.map(
      (id) => afterRun2ById(id).next_due_smoothed,
    );

    // Run 3 — D-12 idempotency proof. With the rebalanceable set
    // unchanged from Run 2, placeNextDue is deterministic (same baseIso,
    // same freq, same load map) so each of the 4 tasks MUST receive the
    // same next_due_smoothed ISO string.
    const run3 = await rebalanceApplyAction(aliceHomeId);
    if (!run3.ok) throw new Error(`run3 failed: ${run3.formError}`);
    expect(run3.updated).toBe(4);

    const afterRun3 = await pbAlice.collection('tasks').getFullList({
      filter: pbAlice.filter('home_id = {:h}', { h: aliceHomeId }),
      batch: 500,
    });
    const afterRun3ById = (id: string) =>
      afterRun3.find((t) => t.id === id)!;
    const run3Smoothed = stableRebalIds.map(
      (id) => afterRun3ById(id).next_due_smoothed,
    );

    // D-12 — bit-identical next_due_smoothed across Run 2 → Run 3 for
    // every task in the stable rebalanceable set.
    expect(run3Smoothed).toEqual(run2Smoothed);

    // Ex-marker task — marker stays cleared across runs (never re-set).
    expect(afterRun3ById(ids.marker).reschedule_marker).toBeFalsy();
    expect(afterRun3ById(ids.marker).next_due_smoothed).toBeTruthy();

    // Preserved buckets (anchored + override) ALSO stable across Run 2
    // → Run 3 — they're never written by apply, so values must match.
    for (const aid of ids.anchored) {
      expect(afterRun3ById(aid).next_due_smoothed).toBe(
        afterRun2ById(aid).next_due_smoothed,
      );
    }
    expect(afterRun3ById(ids.override).next_due_smoothed).toBe(
      afterRun2ById(ids.override).next_due_smoothed,
    );
  }, 30_000);
});
