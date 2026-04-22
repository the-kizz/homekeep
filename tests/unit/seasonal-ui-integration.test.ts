// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/conroyke56/homekeep

/**
 * Phase 14 Plan 02 — Seasonal UI integration suite on port 18102
 * (next free after 13-02's 18101).
 *
 * 3 scenarios on disposable PocketBase prove the end-to-end contract
 * of Phase 14:
 *
 *   Scenario 1 (SEAS-09 + Wave 1 threading): onboarding flow creates
 *     `seed-service-ac` → task row has active_from_month=10,
 *     active_to_month=3 persisted in PB.
 *   Scenario 2 (SEAS-06): a seasonal task in its dormant month
 *     (July for an Oct-Mar window) classifies as dormant via the
 *     Phase 14 classifyDormantTasks helper, with nextOpenDate
 *     matching Perth's Oct 1 midnight in UTC
 *     (2026-09-30T16:00:00.000Z) AND the formatted badge literal
 *     reading "Sleeps until Oct 2026".
 *   Scenario 3 (SEAS-10 + dormancy-agnostic history): a completion
 *     recorded while a task is currently dormant survives
 *     getFullList + filterCompletions (range='all') — proving the
 *     history-view data path is dormancy-agnostic at the live-PB
 *     layer, not just at the pure-helper layer Wave 1 locked.
 *
 * Boot scaffold — copied 1:1 from tests/unit/tcsem-integration.test.ts
 * (port 18101) with three substitutions:
 *   - DATA_DIR = './.pb/test-pb-data-seasonal-ui'
 *   - PORT     = 18102
 *   - Emails   = admin-14@test.test / alice14@test.com
 *
 * Port allocation register advances: 18090..18101 (Phase 11, 12, 13) →
 * 18102 (this file). Next free: 18103 (reserved for Phase 15+).
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
const DATA_DIR = './.pb/test-pb-data-seasonal-ui';
const PORT = 18102; // Phase 14 Plan 14-02 claim — next free: 18103
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
      'admin-14@test.test',
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
    .authWithPassword('admin-14@test.test', 'testpass123');

  const alice = await pbAdmin.collection('users').create({
    email: 'alice14@test.com',
    password: 'alice123456',
    passwordConfirm: 'alice123456',
    name: 'Alice',
  });
  aliceId = alice.id;

  pbAlice = new PocketBase(`http://${HTTP}`);
  await pbAlice
    .collection('users')
    .authWithPassword('alice14@test.com', 'alice123456');

  const aliceHome = await pbAlice.collection('homes').create({
    name: 'Alice Home 14',
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
  // Alice's authed client. Phase 14 server actions run against this.
  currentPb = pbAlice;
}, 30_000);

afterAll(() => {
  pbAlice?.authStore.clear();
  pbAdmin?.authStore.clear();
  pbProcess?.kill('SIGTERM');
  rmSync(DATA_DIR, { recursive: true, force: true });
});

describe('Phase 14 integration — seasonal UI (port 18102)', () => {
  test('Scenario 1 — onboarding seed-service-ac creates task with active_from=10 / active_to=3 (SEAS-09)', async () => {
    // Fresh home for isolation from scenarios 2+3 (Wave-1 threading is
    // load-map-sensitive; onboarding a cohort onto a home with existing
    // seasonal tasks would perturb placement scoring. This test only
    // cares about the active_from/to fields, but isolation is free).
    const home2 = await pbAlice.collection('homes').create({
      name: 'Alice Home 14 Seeds',
      timezone: 'Australia/Perth',
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
    const result = await batchCreateSeedTasks({
      home_id: home2Id,
      selections: [
        {
          seed_id: 'seed-service-ac',
          name: 'Service AC (S1)',
          frequency_days: 365,
          area_id: home2AreaId,
        },
      ],
    });
    expect(result.ok).toBe(true);

    // Read back the persisted task and assert the seasonal-window
    // fields were threaded from SEED_LIBRARY (NOT from client payload —
    // T-14-02: active_from/to are NEVER consulted from the client
    // batch-create-seeds envelope).
    const row = await pbAlice
      .collection('tasks')
      .getFirstListItem(`name = "Service AC (S1)"`);
    expect(row.active_from_month).toBe(10);
    expect(row.active_to_month).toBe(3);
    expect(row.frequency_days).toBe(365);
  }, 30_000);

  test('Scenario 2 — dormant task classifies correctly with "Sleeps until Oct 2026" badge (SEAS-06)', async () => {
    // Create a task directly (bypass the form — this scenario targets
    // the classifier + badge-text contract, not the form path).
    const created = await pbAlice.collection('tasks').create({
      home_id: aliceHomeId,
      area_id: wholeHomeAreaId,
      name: 'Mow (dormant S2)',
      description: '',
      frequency_days: 14,
      schedule_mode: 'cycle',
      anchor_date: '',
      icon: '',
      color: '',
      assigned_to_id: '',
      notes: '',
      archived: false,
      active_from_month: 10,
      active_to_month: 3,
    });

    // Read back as a Task-shaped object for the classifier. PB returns
    // numbers for NumberFields (not strings), so direct assignment is
    // safe after casting.
    const taskShape = {
      id: created.id,
      name: created.name as string,
      area_name: 'Whole Home',
      created: created.created as string,
      archived: Boolean(created.archived),
      frequency_days: created.frequency_days as number,
      schedule_mode:
        (created.schedule_mode as string) === 'anchored'
          ? ('anchored' as const)
          : ('cycle' as const),
      anchor_date: (created.anchor_date as string) || null,
      active_from_month: created.active_from_month as number,
      active_to_month: created.active_to_month as number,
    };

    const { classifyDormantTasks } = await import('@/lib/seasonal-rendering');
    const { formatInTimeZone } = await import('date-fns-tz');

    const now = new Date('2026-07-15T12:00:00Z');
    const timezone = 'Australia/Perth';
    const result = classifyDormantTasks([taskShape], now, timezone);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(created.id);

    // Perth Oct 1 2026 midnight = Sep 30 2026 16:00 UTC. This is the
    // exact ISO instant the classifier must emit for the badge to
    // render "Oct 2026" in Perth tz.
    expect(result[0].nextOpenDate.toISOString()).toBe(
      '2026-09-30T16:00:00.000Z',
    );

    // Badge contract lock: the formatted text MUST match what
    // DormantTaskRow renders. Any drift between classifier output and
    // component format here means the integration-test environment
    // accepts a badge text the component couldn't produce — caught
    // at the contract boundary before it hits a user.
    const badgeText = `Sleeps until ${formatInTimeZone(
      result[0].nextOpenDate,
      timezone,
      'MMM yyyy',
    )}`;
    expect(badgeText).toBe('Sleeps until Oct 2026');
  }, 30_000);

  test('Scenario 3 — completion on currently-dormant task persists + appears in getFullList + filterCompletions (SEAS-10)', async () => {
    // Create a seasonal task whose window is Oct-Mar. The test "now"
    // (conceptually July 2026) puts the task in dormancy; we insert
    // a completion row dated 2026-01-10 (in-season when done) to
    // exercise the history-view data path.
    const task = await pbAlice.collection('tasks').create({
      home_id: aliceHomeId,
      area_id: wholeHomeAreaId,
      name: 'Dormant complete (S3)',
      description: '',
      frequency_days: 30,
      schedule_mode: 'cycle',
      anchor_date: '',
      icon: '',
      color: '',
      assigned_to_id: '',
      notes: '',
      archived: false,
      active_from_month: 10,
      active_to_month: 3,
    });

    // completeTaskAction reads `new Date()` internally, so we can't
    // simulate a "completion was recorded while task is currently
    // dormant" via the action. Instead we insert the completion row
    // directly — matching Phase 3's test pattern (superuser-side
    // insert for back-dated completions).
    const completion = await pbAlice.collection('completions').create({
      task_id: task.id,
      completed_by_id: aliceId,
      completed_at: '2026-01-10T10:00:00.000Z',
      notes: '',
      via: 'tap',
    });
    expect(completion.id).toBeTruthy();

    // Data-path assertion: querying completions for this task returns
    // the row regardless of the task's current dormancy state. PB has
    // no server-side dormancy filter on completions (confirmed by
    // Wave 1's filterCompletions.length === 5 invariant — no
    // dormancy parameter in the pure helper either).
    const items = await pbAlice.collection('completions').getFullList({
      filter: `task_id = "${task.id}"`,
    });
    expect(items).toHaveLength(1);
    expect((items[0].completed_at as string).startsWith('2026-01-10')).toBe(
      true,
    );

    // Belt-and-braces: run the fetched completion through the pure
    // filterCompletions helper with range='all' (the History-view
    // default). A dormancy-aware helper would regress by dropping
    // completions from dormant tasks; the 5-param signature Wave 1
    // locked forbids any dormancy surface, and this scenario locks
    // the same behavior on a LIVE PB row.
    const { filterCompletions } = await import('@/lib/history-filter');
    const completionRecords = items.map((c) => ({
      id: c.id,
      task_id: c.task_id as string,
      completed_by_id: c.completed_by_id as string,
      completed_at: c.completed_at as string,
      notes: (c.notes as string) || '',
      via: ((c.via as string) === 'manual-date' ? 'manual-date' : 'tap') as
        | 'tap'
        | 'manual-date',
    }));
    const taskAreaMap = new Map<string, string>([[task.id, wholeHomeAreaId]]);
    const filtered = filterCompletions(
      completionRecords,
      { personId: null, areaId: null, range: 'all' },
      taskAreaMap,
      new Date('2026-07-15T12:00:00Z'),
      'Australia/Perth',
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe(completion.id);
  }, 30_000);
});
