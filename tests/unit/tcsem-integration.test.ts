// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep

/**
 * Phase 13 TCSEM integration suite — port 18101 (13-02 TCSEM integration
 * — next free after 12-04's 18100).
 *
 * 3 scenarios on disposable PocketBase:
 *   1. Custom createTask writes next_due_smoothed atomically
 *      (TCSEM-04 + TCSEM-02 — explicit last_done path).
 *   2. batchCreateSeedTasks 5-seed cohort distributes across ≥4 ISO
 *      dates with no ≥3-cluster (TCSEM-05 + D-08 load-map threading).
 *   3. SDST runtime audit — via='seed-stagger' completion rows NEVER
 *      get created by any Phase 13 code path (TCSEM-06 + D-12).
 *
 * Boot pattern copied verbatim from tests/unit/load-smoothing-integration
 * .test.ts (port 18100): superuser CLI BEFORE serve (Pitfall 9 WAL-race),
 * spawn serve with --migrationsDir (Phase 12 LOAD-01 migration picks up
 * next_due_smoothed field) + --hooksDir (Whole Home hook auto-creates
 * area on homes.create), 30×200ms health poll, vi.mock plumbing for
 * next/cache + next/navigation + pocketbase-server + pocketbase-admin
 * so createTask's `createServerClient()` resolves to the test-local
 * Alice-authed client, and its `redirect(...)` throws instead of exits.
 *
 * Port allocation register advances: 18090..18100 (Phase 11 + 12) → 18101
 * (this file).
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
    // createTask signals success via `redirect(path)`. In the action
    // this throws a Next.js-specific NEXT_REDIRECT sentinel; in tests
    // we map it to a plain Error whose message is parseable by the
    // test block's try/catch.
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
const DATA_DIR = './.pb/test-pb-data-tcsem';
const PORT = 18101;
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

  // Pitfall 9 — superuser create BEFORE `serve` (SQLite WAL race if the
  // serve process and the CLI create contend for the DB).
  await new Promise<void>((resolve, reject) => {
    const p = spawn(PB_BIN, [
      'superuser',
      'create',
      'admin-13@test.test',
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
    .authWithPassword('admin-13@test.test', 'testpass123');

  const alice = await pbAdmin.collection('users').create({
    email: 'alice13@test.com',
    password: 'alice123456',
    passwordConfirm: 'alice123456',
    name: 'Alice',
  });
  aliceId = alice.id;

  pbAlice = new PocketBase(`http://${HTTP}`);
  await pbAlice
    .collection('users')
    .authWithPassword('alice13@test.com', 'alice123456');

  const aliceHome = await pbAlice.collection('homes').create({
    name: 'Alice Home 13',
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

  // Bind the vi.mock's createServerClient + createAdminClient to Alice's
  // authed client. Phase 13 server actions run against this client.
  currentPb = pbAlice;
}, 30_000);

afterAll(() => {
  pbAlice?.authStore.clear();
  pbAdmin?.authStore.clear();
  pbProcess?.kill('SIGTERM');
  rmSync(DATA_DIR, { recursive: true, force: true });
});

describe('Phase 13 integration — task-creation semantics (port 18101)', () => {
  test('Scenario 1 — custom createTask writes next_due_smoothed atomically (TCSEM-04 + TCSEM-02)', async () => {
    // last_done = now - 12 days; freq = 30 → firstIdeal = now + 18 days.
    // Tolerance cap min(0.15 * 30, 5) = 4 → placement window = [now+14, now+22]
    // in the happy-case (no prior load). We assert a widened [now+10, now+26]
    // to survive Rider-1-style tolerance tweaks and weekend-preference
    // drift without masking a genuine failure (the natural-ideal is 18
    // days out; a smart-default result — which would be now + 30/4 = +7d
    // — is clearly outside the window, so TCSEM-02 vs TCSEM-03 remains
    // unambiguously distinguishable).
    const now = Date.now();
    const lastDoneIso = new Date(now - 12 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const formData = new FormData();
    formData.set('home_id', aliceHomeId);
    formData.set('area_id', wholeHomeAreaId);
    formData.set('name', 'Mop floors (TCSEM-02)');
    formData.set('frequency_days', '30');
    formData.set('schedule_mode', 'cycle');
    formData.set('last_done', lastDoneIso);

    currentPb = pbAlice;
    const { createTask } = await import('@/lib/actions/tasks');
    let redirected = false;
    try {
      await createTask({ ok: false }, formData);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.startsWith('REDIRECT:')) {
        redirected = true;
      } else {
        throw e;
      }
    }
    expect(redirected).toBe(true);

    // Atomicity check — single PB read returns the task WITH smoothed
    // date already populated. If next_due_smoothed were written in a
    // subsequent op, there would be a window where this row existed
    // without the smoothed date; Phase 13 D-05 Approach A precludes
    // that by including the field in the same tasks.create body.
    const created = await pbAlice
      .collection('tasks')
      .getFirstListItem(`name = "Mop floors (TCSEM-02)"`);
    expect(created.next_due_smoothed).toBeTruthy();

    const placed = new Date(created.next_due_smoothed as string);
    const deltaDays = (placed.getTime() - now) / 86_400_000;
    expect(deltaDays).toBeGreaterThanOrEqual(10);
    expect(deltaDays).toBeLessThanOrEqual(26);
  }, 30_000);

  test('Scenario 2 — batchCreateSeedTasks 5-seed cohort distributes across ≥4 ISO dates with no ≥3-cluster (TCSEM-05)', async () => {
    // Fresh home to keep this scenario's load map clean (Scenario 1
    // created Mop floors, which would otherwise occupy a slot in the
    // cohort's starting load). New home via admin so homes.owner_id
    // is still Alice; Whole Home area auto-created by hook.
    const home2 = await pbAlice.collection('homes').create({
      name: 'Alice Home 13 Seeds',
      timezone: 'UTC',
      owner_id: aliceId,
    });
    const home2Id = home2.id;
    const home2Areas = await pbAlice.collection('areas').getFullList({
      filter: `home_id = "${home2Id}"`,
    });
    if (home2Areas.length === 0) {
      throw new Error('Whole Home area was not auto-created for home2');
    }
    const home2AreaId = home2Areas[0].id;

    currentPb = pbAlice;
    const { batchCreateSeedTasks } = await import('@/lib/actions/seed');
    // 5 seeds, all freq=30 so they share the same smart-default first-
    // ideal target date (now + Math.floor(30/4) = now + 7d). TCSEM-05
    // requires the load-map threading to fan these out across distinct
    // ISO dates rather than all landing on day 7.
    //
    // Seed IDs must be real SEED_LIBRARY entries (T-05-03-01 rejects
    // fabricated IDs). Picked 5 library entries with distinct names;
    // the selection-level frequency_days=30 overrides the library's
    // own frequency per D-12 (user-editable on the wizard step).
    const result = await batchCreateSeedTasks({
      home_id: home2Id,
      selections: [
        {
          seed_id: 'seed-wipe-benches',
          name: 'Cohort seed 1 (freq=30)',
          frequency_days: 30,
          area_id: home2AreaId,
        },
        {
          seed_id: 'seed-clean-sink',
          name: 'Cohort seed 2 (freq=30)',
          frequency_days: 30,
          area_id: home2AreaId,
        },
        {
          seed_id: 'seed-mop-kitchen-floor',
          name: 'Cohort seed 3 (freq=30)',
          frequency_days: 30,
          area_id: home2AreaId,
        },
        {
          seed_id: 'seed-clean-oven',
          name: 'Cohort seed 4 (freq=30)',
          frequency_days: 30,
          area_id: home2AreaId,
        },
        {
          seed_id: 'seed-deep-clean-fridge',
          name: 'Cohort seed 5 (freq=30)',
          frequency_days: 30,
          area_id: home2AreaId,
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.count).toBe(5);
    }

    // Read back all 5 cohort tasks for this home.
    const cohortTasks = await pbAlice.collection('tasks').getFullList({
      filter: `home_id = "${home2Id}" && archived = false`,
      fields: 'id,name,next_due_smoothed',
    });
    expect(cohortTasks.length).toBe(5);
    for (const t of cohortTasks) {
      expect(t.next_due_smoothed).toBeTruthy();
    }

    // TCSEM-05 core assertion: the 5-seed cohort distributes across
    // ≥4 distinct ISO dates. At most one collision allowed (D-08
    // closest-to-ideal tiebreaker can land 2 seeds on the same date
    // if both have equal load-score; 3+ on one date would indicate
    // threading broke).
    const dateKeys = new Set<string>();
    const dateCounts = new Map<string, number>();
    for (const t of cohortTasks) {
      const iso = (t.next_due_smoothed as string).slice(0, 10);
      dateKeys.add(iso);
      dateCounts.set(iso, (dateCounts.get(iso) ?? 0) + 1);
    }

    // eslint-disable-next-line no-console
    console.log(
      `[Scenario 2] 5-seed cohort placement distribution: ${Array.from(
        dateCounts.entries(),
      )
        .map(([d, c]) => `${d}=${c}`)
        .join(', ')}`,
    );

    expect(dateKeys.size).toBeGreaterThanOrEqual(4);

    // No ISO date carries 3 or more cohort tasks — "no ≥3-cluster"
    // TCSEM-05 invariant from the plan.
    for (const [iso, count] of dateCounts.entries()) {
      expect(
        count,
        `Cluster of ${count} tasks on ${iso} violates TCSEM-05 no-≥3-cluster invariant`,
      ).toBeLessThan(3);
    }
  }, 30_000);

  test('Scenario 3 — SDST runtime audit: via="seed-stagger" completion rows are never created by Phase 13 code paths (TCSEM-06)', async () => {
    // By this point Scenarios 1 + 2 have exercised createTask (custom
    // path) + batchCreateSeedTasks (cohort path) — both Phase 13 code
    // paths with activity. TCSEM-06 D-12 demands zero synthetic
    // completions of the legacy SDST type.

    // Token-concat obfuscation: the test file must not contribute a
    // false-positive match to any future code-level grep for the
    // forbidden token. The runtime audit query still constructs the
    // literal string for PB's filter engine.
    const forbiddenVia = 'seed' + '-' + 'stagger';

    // Primary query — getList caps at a reasonable page size. 500 is
    // well above any plausible synthetic cohort count (cohort max = 50).
    const list = await pbAlice.collection('completions').getList(1, 500, {
      filter: `via = "${forbiddenVia}"`,
    });
    expect(list.items.length).toBe(0);

    // Belt-and-braces via getFullList — exhaustively paginated, guards
    // against the 500-cap ever being insufficient for a larger cohort.
    const full = await pbAlice.collection('completions').getFullList({
      filter: `via = "${forbiddenVia}"`,
    });
    expect(full.length).toBe(0);
  }, 30_000);
});
