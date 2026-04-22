// @vitest-environment node
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import PocketBase, { ClientResponseError } from 'pocketbase';
import {
  getActiveOverride,
  getActiveOverridesForHome,
} from '@/lib/schedule-overrides';

/**
 * 10-01 Task 2 — disposable-PB integration test for schedule_overrides
 * migration + helper round-trip. Covers REQ-SNZE-04 (collection shape +
 * member-gated rules) and the helper read-paths backing Plans 10-02 /
 * 10-03.
 *
 * Port 18098 — allocation log: 18090 (02-01), 18091 (03-01), 18092/18093
 * (04-01 hook + rules), 18094 (04-02 invites), 18095 (05-01 onboarded),
 * 18096 (06-01 notifications idempotency), 18097 (06-02 scheduler),
 * 18098 (10-01 schedule overrides — this file).
 *
 * Atomic-consumption scenario (SNZE-06) is appended in Plan 10-03 where
 * completeTaskAction gains the batch-consumption write; Plan 10-01 only
 * proves the collection/rules/helpers shape.
 *
 * Scenarios are split into separate `test()` blocks (8 total) that
 * share the seeded fixtures established in beforeAll. Vitest runs them
 * sequentially within a single file, which matches the narrative
 * ordering (create → cross-home reject → read → batch → consume →
 * delete). The seed phase is expensive (disposable PB boot + users/
 * homes/tasks) so we pay it ONCE per file rather than per scenario.
 *
 * Boot pattern mirrors `tests/unit/hooks-completions-append-only.test.ts`
 * verbatim: superuser CLI create BEFORE serve (Pitfall 9, WAL-race),
 * then spawn `serve`, poll `/api/health` 30× at 200ms intervals.
 */

const PB_BIN = './.pb/pocketbase';
const DATA_DIR = './.pb/test-pb-data-schedule-overrides';
const HTTP = '127.0.0.1:18098';

let pbProcess: ChildProcess | undefined;

// Shared fixtures populated in beforeAll; consumed by the ordered tests.
let pbAdmin: PocketBase;
let pbAlice: PocketBase;
let pbMallory: PocketBase;
let aliceId: string;
let malloryId: string;
let aliceHomeId: string;
let malloryHomeId: string;
let t1Id: string; // Alice task — primary override subject
let t1bId: string; // Alice task — secondary override for batch
let t3Id: string; // Alice task — no override (Scenario 6)
// Fixtures populated across scenarios (create → delete).
let override1Id: string;
let override1bId: string;

beforeAll(async () => {
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });

  // Create the superuser BEFORE `serve` starts (Pitfall 9 — SQLite WAL
  // race if the serve process and the CLI create contend for the DB).
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

  // ─── Seed: admin, two users, two homes, four tasks ───────────────────
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
  const mallory = await pbAdmin.collection('users').create({
    email: 'mallory@test.com',
    password: 'mallory123456',
    passwordConfirm: 'mallory123456',
    name: 'Mallory',
  });
  aliceId = alice.id;
  malloryId = mallory.id;

  pbAlice = new PocketBase(`http://${HTTP}`);
  await pbAlice
    .collection('users')
    .authWithPassword('alice@test.com', 'alice123456');
  const aliceHome = await pbAlice.collection('homes').create({
    name: 'Alice Home',
    timezone: 'Australia/Perth',
    owner_id: aliceId,
  });
  aliceHomeId = aliceHome.id;
  const aliceAreas = await pbAlice.collection('areas').getFullList({
    filter: `home_id = "${aliceHomeId}"`,
  });
  const aliceAreaId = aliceAreas[0].id;

  pbMallory = new PocketBase(`http://${HTTP}`);
  await pbMallory
    .collection('users')
    .authWithPassword('mallory@test.com', 'mallory123456');
  const malloryHome = await pbMallory.collection('homes').create({
    name: 'Mallory Home',
    timezone: 'Australia/Perth',
    owner_id: malloryId,
  });
  malloryHomeId = malloryHome.id;
  // Mallory's area exists (hook creates Whole Home) but we don't need
  // its id in the tests — just needed for cross-home isolation context.

  const t1 = await pbAlice.collection('tasks').create({
    home_id: aliceHomeId,
    area_id: aliceAreaId,
    name: 'T1 — Alice task for snooze',
    frequency_days: 7,
    schedule_mode: 'cycle',
    archived: false,
  });
  t1Id = t1.id;

  const t1b = await pbAlice.collection('tasks').create({
    home_id: aliceHomeId,
    area_id: aliceAreaId,
    name: 'T1b — Alice second task for batch',
    frequency_days: 30,
    schedule_mode: 'cycle',
    archived: false,
  });
  t1bId = t1b.id;

  const t3 = await pbAlice.collection('tasks').create({
    home_id: aliceHomeId,
    area_id: aliceAreaId,
    name: 'T3 — Alice task without override',
    frequency_days: 14,
    schedule_mode: 'cycle',
    archived: false,
  });
  t3Id = t3.id;
}, 30_000);

afterAll(() => {
  pbAlice?.authStore.clear();
  pbMallory?.authStore.clear();
  pbAdmin?.authStore.clear();
  pbProcess?.kill('SIGTERM');
  rmSync(DATA_DIR, { recursive: true, force: true });
});

describe('schedule_overrides (disposable PB, port 18098)', () => {
  test('Scenario 1 — SNZE-04 member create happy path (consumed_at null/empty on create)', async () => {
    const snoozeIso = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const override = await pbAlice
      .collection('schedule_overrides')
      .create({
        task_id: t1Id,
        snooze_until: snoozeIso,
        created_by_id: aliceId,
      });
    expect(override.id).toBeTruthy();
    expect(override.task_id).toBe(t1Id);
    expect(override.snooze_until).toBeTruthy();
    // A2 — PB DateField null-storage on fresh optional field. Record
    // whichever PB 0.37.1 returns (empty-string or null), accept either
    // so plan 10-03 doesn't guess.
    const consumedOnCreate = override.consumed_at;
    expect(
      consumedOnCreate === '' ||
        consumedOnCreate === null ||
        consumedOnCreate === undefined,
    ).toBe(true);

    override1Id = override.id;
  }, 30_000);

  test('Scenario 2 — SNZE-04 cross-home create rejection (T-10-01)', async () => {
    const snoozeIso = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000,
    ).toISOString();
    let err: unknown;
    try {
      await pbMallory.collection('schedule_overrides').create({
        task_id: t1Id, // Alice's task — Mallory is not a member
        snooze_until: snoozeIso,
        created_by_id: malloryId,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ClientResponseError);
    expect((err as ClientResponseError).status).toBeGreaterThanOrEqual(400);
  }, 30_000);

  test('Scenario 3 — SNZE-04 cross-home view denial + owner read works', async () => {
    // Mallory cannot view Alice's override (PB rule-denies with 4xx).
    let err: unknown;
    try {
      await pbMallory
        .collection('schedule_overrides')
        .getOne(override1Id);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ClientResponseError);
    expect((err as ClientResponseError).status).toBeGreaterThanOrEqual(400);

    // Alice positive-case — owner can read her own override.
    const reread = await pbAlice
      .collection('schedule_overrides')
      .getOne(override1Id);
    expect(reread.id).toBe(override1Id);
  }, 30_000);

  test('Scenario 4 — getActiveOverride round-trip (helper returns seeded row)', async () => {
    const fetched = await getActiveOverride(pbAlice, t1Id);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(override1Id);
    expect(fetched?.task_id).toBe(t1Id);
    expect(fetched?.snooze_until).toBeTruthy();
  }, 30_000);

  test('Scenario 5 — getActiveOverride returns null for task with no override', async () => {
    const result = await getActiveOverride(pbAlice, t3Id);
    expect(result).toBeNull();
  }, 30_000);

  test('Scenario 6 — getActiveOverridesForHome batch returns Map with multiple entries (A3)', async () => {
    // Seed a second override for T1b so the Map has 2 entries.
    const override1b = await pbAlice
      .collection('schedule_overrides')
      .create({
        task_id: t1bId,
        snooze_until: new Date(
          Date.now() + 14 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        created_by_id: aliceId,
      });
    override1bId = override1b.id;

    const batchMap = await getActiveOverridesForHome(pbAlice, aliceHomeId);
    // A3 — cross-table parameterized filter `task_id.home_id = {:hid}`
    // acceptance. If PB 0.37.1 rejects that syntax, the helper falls
    // open to empty Map and this assertion fails, telling us to swap
    // to string concat (safe because homeId comes from authStore).
    expect(batchMap.size).toBe(2);
    expect(batchMap.get(t1Id)?.id).toBe(override1Id);
    expect(batchMap.get(t1bId)?.id).toBe(override1bId);
  }, 30_000);

  test('Scenario 7 — consumed filter (helper returns null after consumed_at set)', async () => {
    // Superuser flips consumed_at (member could also do this per D-05;
    // superuser avoids re-auth token refresh in this test path).
    await pbAdmin
      .collection('schedule_overrides')
      .update(override1Id, { consumed_at: new Date().toISOString() });

    const afterConsumed = await getActiveOverride(pbAlice, t1Id);
    expect(afterConsumed).toBeNull();

    // Batch helper should also skip the now-consumed row — T1 drops
    // from the Map; T1b remains.
    const batchAfter = await getActiveOverridesForHome(pbAlice, aliceHomeId);
    expect(batchAfter.size).toBe(1);
    expect(batchAfter.get(t1bId)?.id).toBe(override1bId);
    expect(batchAfter.get(t1Id)).toBeUndefined();
  }, 30_000);

  test('Scenario 8 — D-05 member delete success + cross-home delete rejection', async () => {
    // Alice deletes her own (consumed) override — succeeds per D-05.
    await expect(
      pbAlice.collection('schedule_overrides').delete(override1Id),
    ).resolves.toBe(true);

    // Mallory attempts to delete the remaining Alice-owned override
    // (t1b) — rejects per cross-home rule gate.
    let err: unknown;
    try {
      await pbMallory
        .collection('schedule_overrides')
        .delete(override1bId);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ClientResponseError);
    expect((err as ClientResponseError).status).toBeGreaterThanOrEqual(400);
  }, 30_000);
});
