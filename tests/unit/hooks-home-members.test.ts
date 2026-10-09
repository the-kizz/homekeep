// @vitest-environment node
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import PocketBase from 'pocketbase';
import { runBackfill, type BackfillMockApp } from '../fixtures/backfill-loop';

/**
 * 04-01 Task 2 — proves the Whole Home hook extension atomically inserts
 * an owner `home_members` row when a new home is created, AND proves the
 * backfill loop from 1714953600_home_members.js inserts owner rows for
 * pre-existing (Phase 2-era) homes that have no membership yet.
 *
 * Scaffolding mirrors tests/unit/hooks-whole-home.test.ts (02-01) and
 * tests/unit/hooks-completions-append-only.test.ts (03-01):
 *   - Superuser created via CLI BEFORE `pb serve` starts (SQLite WAL
 *     race avoidance — 02-01 learning).
 *   - Port 18092 (distinct from 18090 / 18091 so other suites can run
 *     concurrently without contaminating state).
 *   - `--migrationsDir` points at pocketbase/pb_migrations so ALL Phase
 *     2 + 3 + 4 migrations apply on first boot.
 *
 * Backfill coverage (Test 2) uses a Node-level fixture that mirrors the
 * migration's backfill loop verbatim (see tests/fixtures/backfill-loop.js).
 * A live re-migration path would require restarting PB mid-test with
 * half the migrations — the fixture approach is simpler and keeps the
 * shipping loop body locked to the asserted behaviour.
 */

const PB_BIN = './.pb/pocketbase';
const DATA_DIR = './.pb/test-pb-data-home-members';
const HTTP = '127.0.0.1:18092';

let pbProcess: ChildProcess | undefined;

beforeAll(async () => {
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });

  // Create the superuser BEFORE `serve` (WAL race — 02-01 decision).
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
        : reject(new Error(`superuser create failed (code ${code}): ${stderr}`)),
    );
  });

  pbProcess = spawn(PB_BIN, [
    'serve',
    `--http=${HTTP}`,
    `--dir=${DATA_DIR}`,
    '--migrationsDir=./pocketbase/pb_migrations',
    '--hooksDir=./pocketbase/pb_hooks',
  ]);

  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`http://${HTTP}/api/health`);
      if (r.ok) return;
    } catch {
      /* not ready yet */
    }
    await new Promise((res) => setTimeout(res, 200));
  }
  throw new Error('PB did not start within 6s');
}, 20_000);

afterAll(() => {
  pbProcess?.kill('SIGTERM');
  rmSync(DATA_DIR, { recursive: true, force: true });
});

describe('home_members owner auto-create + backfill', () => {
  test('home creation auto-inserts owner home_members row atomically', async () => {
    // Seed Alice via superuser (user-creation API rule does not permit
    // unauthed create on the built-in users collection by default).
    const pbAdmin = new PocketBase(`http://${HTTP}`);
    await pbAdmin
      .collection('_superusers')
      .authWithPassword('test@test.com', 'testpass123');

    const alice = await pbAdmin.collection('users').create({
      email: 'alice@test.com',
      password: 'alice123456',
      passwordConfirm: 'alice123456',
      name: 'Alice',
    });

    // Alice authenticates and creates HER OWN home so owner_id = alice.id
    // triggers the extended Whole Home hook (owner-member auto-insert).
    const pbAlice = new PocketBase(`http://${HTTP}`);
    await pbAlice
      .collection('users')
      .authWithPassword('alice@test.com', 'alice123456');

    let home;
    try {
      home = await pbAlice.collection('homes').create({
        name: 'Alice Home',
        timezone: 'Australia/Perth',
        owner_id: alice.id,
      });
    } catch (err: any) {
      throw new Error(
        `homes.create failed: ${err?.message} | ${JSON.stringify(err?.response)}`,
      );
    }

    // Assertion 1: the Whole Home area is still auto-created (02-01
    // invariant not regressed by the Phase 4 hook extension).
    const areas = await pbAlice.collection('areas').getFullList({
      filter: `home_id = "${home.id}"`,
    });
    expect(areas.length).toBeGreaterThanOrEqual(1);
    const wholeHome = areas.find((a) => a.is_whole_home_system === true);
    expect(wholeHome).toBeDefined();
    expect(wholeHome!.scope).toBe('whole_home');

    // Assertion 2: exactly ONE home_members row exists with role='owner'
    // linking Alice to the new home. This is the D-03 contract — the hook
    // insert runs in the same transaction as the home+area insert so either
    // everything lands or nothing does.
    //
    // Use superuser (pbAdmin) to read home_members so we don't depend on
    // the list-rule's back-relation resolving during this same request —
    // we're testing the write path, not the read path (the read path is
    // covered by rules-member-isolation.test.ts).
    const membershipList = await pbAdmin
      .collection('home_members')
      .getFullList({
        filter: `home_id = "${home.id}" && user_id = "${alice.id}"`,
      });
    expect(membershipList).toHaveLength(1);
    expect(membershipList[0].role).toBe('owner');

    pbAlice.authStore.clear();
    pbAdmin.authStore.clear();
  }, 30_000);

  test('backfill loop idempotently inserts owner rows for pre-existing homes', () => {
    // This test validates the SHAPE of the backfill loop in
    // 1714953600_home_members.js. It uses a mock app (tests/fixtures/
    // backfill-loop.js mirrors the migration body) to simulate two
    // pre-existing Phase 2-era homes that have no membership rows yet.
    //
    // Pass 1: both homes get a new owner-member insert.
    // Pass 2 (idempotency): with those rows now "existing", no new
    // inserts happen — proves the `findFirstRecordByFilter` skip-path.

    type FakeHome = { id: string; ownerId: string };
    const homes: FakeHome[] = [
      { id: 'home_A', ownerId: 'user_alice' },
      { id: 'home_B', ownerId: 'user_bob' },
    ];

    const saved: Array<{ home_id: string; user_id: string; role: string }> = [];

    // Helper: build a mock app whose state reflects saved rows.
    function makeMockApp(
      existingRows: Array<{ home_id: string; user_id: string }>,
    ): BackfillMockApp {
      return {
        findRecordsByFilter: (collection) => {
          if (collection !== 'homes') {
            throw new Error(`unexpected collection: ${collection}`);
          }
          return homes.map((h) => ({
            id: h.id,
            get: (field: string) => {
              if (field === 'owner_id') return h.ownerId;
              throw new Error(`unexpected field access: ${field}`);
            },
          }));
        },
        findFirstRecordByFilter: (collection, _filter, params) => {
          if (collection !== 'home_members') {
            throw new Error(`unexpected collection: ${collection}`);
          }
          const hit = existingRows.find(
            (r) => r.home_id === params.hid && r.user_id === params.uid,
          );
          if (!hit) {
            // Migration body catches the throw and treats it as "no match".
            throw new Error('no match');
          }
          return hit;
        },
        save: (row) => {
          saved.push(row);
        },
      };
    }

    // ─── Pass 1: no existing memberships ────────────────────────────────
    runBackfill(makeMockApp([]));
    expect(saved).toHaveLength(2);
    expect(saved[0]).toEqual({ home_id: 'home_A', user_id: 'user_alice', role: 'owner' });
    expect(saved[1]).toEqual({ home_id: 'home_B', user_id: 'user_bob', role: 'owner' });

    // ─── Pass 2: both memberships now exist — idempotent, no new saves ─
    const existing = saved.map(({ home_id, user_id }) => ({ home_id, user_id }));
    saved.length = 0; // reset recorder
    runBackfill(makeMockApp(existing));
    expect(saved).toHaveLength(0);
  });
});
