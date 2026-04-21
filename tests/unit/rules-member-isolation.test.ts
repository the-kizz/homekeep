// @vitest-environment node
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import PocketBase from 'pocketbase';

/**
 * 04-01 Task 2 — proves the 1714953602_update_rules_multi_member.js
 * rule swap enforces member-of-home gating at the PB API layer:
 *
 *   Test 1 — a non-member cannot read tasks of a home they're not in.
 *            PB's filter-matching rules return an empty list (NOT a 403)
 *            for non-matching rows, so the assertion is length === 0.
 *
 *   Test 2 — after a superuser inserts the non-member as a home_members
 *            row, the same filtered getList returns the task row.
 *            This proves the rule re-evaluates per-request (T-04-01-07
 *            "membership revocation takes effect on the next request").
 *
 * Port 18093 — distinct from 18090 (02-01), 18091 (03-01), 18092
 * (hooks-home-members.test.ts) so vitest parallel runners don't collide.
 * Scaffolding pattern is the same (WAL-race mitigation, migrationsDir
 * mount, health poll).
 */

const PB_BIN = './.pb/pocketbase';
const DATA_DIR = './.pb/test-pb-data-rules-member';
const HTTP = '127.0.0.1:18093';

let pbProcess: ChildProcess | undefined;

beforeAll(async () => {
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });

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

describe('rules: member isolation on tasks', () => {
  test('non-member is blocked; member can read after membership insert', async () => {
    // Step 1 — Seed two users via superuser.
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
    const bob = await pbAdmin.collection('users').create({
      email: 'bob@test.com',
      password: 'bob123456789',
      passwordConfirm: 'bob123456789',
      name: 'Bob',
    });

    // Step 2 — Bob creates his home (hook auto-creates owner membership
    // for Bob, plus the Whole Home area).
    const pbBob = new PocketBase(`http://${HTTP}`);
    await pbBob
      .collection('users')
      .authWithPassword('bob@test.com', 'bob123456789');

    const bobHome = await pbBob.collection('homes').create({
      name: 'Bob Home',
      timezone: 'Australia/Perth',
      owner_id: bob.id,
    });

    // Fetch the auto-created Whole Home area to use as the task's area_id.
    const bobAreas = await pbBob.collection('areas').getFullList({
      filter: `home_id = "${bobHome.id}"`,
    });
    expect(bobAreas.length).toBeGreaterThanOrEqual(1);
    const bobAreaId = bobAreas[0].id;

    // Bob creates a task in his home.
    const bobTask = await pbBob.collection('tasks').create({
      home_id: bobHome.id,
      area_id: bobAreaId,
      name: 'Bob task — private to Bob',
      frequency_days: 7,
      schedule_mode: 'cycle',
      archived: false,
    });
    expect(bobTask.id).toBeTruthy();

    // Step 3 — Alice authenticates. She is NOT a member of Bob's home,
    // so a filtered tasks.getList on Bob's home must return empty.
    const pbAlice = new PocketBase(`http://${HTTP}`);
    await pbAlice
      .collection('users')
      .authWithPassword('alice@test.com', 'alice123456');

    const beforeJoinList = await pbAlice.collection('tasks').getList(1, 50, {
      filter: `home_id = "${bobHome.id}"`,
    });
    expect(beforeJoinList.items).toHaveLength(0);

    // Step 4 — Superuser inserts Alice as a member of Bob's home.
    await pbAdmin.collection('home_members').create({
      home_id: bobHome.id,
      user_id: alice.id,
      role: 'member',
    });

    // Step 5 — Alice re-runs the same filtered getList. PB rules
    // re-evaluate per-request, so the newly-inserted membership grants
    // Alice read access immediately — the task should now be visible.
    const afterJoinList = await pbAlice.collection('tasks').getList(1, 50, {
      filter: `home_id = "${bobHome.id}"`,
    });
    expect(afterJoinList.items.length).toBeGreaterThanOrEqual(1);
    expect(afterJoinList.items.some((t) => t.id === bobTask.id)).toBe(true);

    pbAlice.authStore.clear();
    pbBob.authStore.clear();
    pbAdmin.authStore.clear();
  }, 60_000);
});
