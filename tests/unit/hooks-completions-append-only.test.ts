// @vitest-environment node
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import PocketBase, { ClientResponseError } from 'pocketbase';

/**
 * 03-01 Task 1 RED→GREEN: completions collection append-only contract.
 *
 * Boots a disposable PocketBase on 127.0.0.1:18091 (distinct port from
 * 02-01's 18090 so the tests can run concurrently without cross-
 * contamination). Re-uses the scaffolding pattern codified in
 * tests/unit/hooks-whole-home.test.ts:
 *  - Superuser is created via CLI BEFORE serve is spawned (SQLite WAL
 *    race avoidance — 02-01 decision).
 *  - `--migrationsDir` points at pocketbase/pb_migrations so the fresh
 *    completions migration applies on first boot.
 *
 * Assertions (three core, one defense-in-depth):
 *  1. Create succeeds — 201 + record returned with id.
 *  2. Update via non-superuser API call rejects with status >= 400
 *     (PB null-rule semantics: locked to superusers only).
 *  3. Delete via non-superuser API call rejects with status >= 400.
 *  4. Create with completed_by_id != authed user's id rejects
 *     (createRule `@request.body.completed_by_id = @request.auth.id`).
 */

const PB_BIN = './.pb/pocketbase';
const DATA_DIR = './.pb/test-pb-data-completions';
const HTTP = '127.0.0.1:18091';

let pbProcess: ChildProcess | undefined;

beforeAll(async () => {
  // Clean slate — PB applies migrations fresh against an empty dir so the
  // completions migration lands and is exercised from scratch each run.
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });

  // Create the superuser BEFORE starting `serve` (02-01 WAL-race mitigation).
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
        : reject(new Error(`superuser create failed (code ${code}): ${stderr}`))
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

describe('completions collection (append-only)', () => {
  test('creates a completion, then rejects update + delete + cross-user create', async () => {
    // Step 1 — Use the superuser to seed the auth user, home, area, task
    // fixtures. (API rules bypass for superusers; test subject is the
    // regular-user path further down.)
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

    // Step 2 — Create Alice's home as Alice (so owner_id = alice).
    const pbAlice = new PocketBase(`http://${HTTP}`);
    await pbAlice
      .collection('users')
      .authWithPassword('alice@test.com', 'alice123456');

    const home = await pbAlice.collection('homes').create({
      name: 'Alice Home',
      timezone: 'Australia/Perth',
      owner_id: alice.id,
    });

    // The Whole Home area is auto-created by the 02-01 hook — fetch it.
    const areas = await pbAlice.collection('areas').getFullList({
      filter: `home_id = "${home.id}"`,
    });
    expect(areas.length).toBeGreaterThanOrEqual(1);
    const areaId = areas[0].id;

    const task = await pbAlice.collection('tasks').create({
      home_id: home.id,
      area_id: areaId,
      name: 'Wipe benches',
      frequency_days: 7,
      schedule_mode: 'cycle',
      archived: false,
    });

    // Step 3 — Alice creates a completion for her own task — must succeed.
    const nowIso = new Date().toISOString();
    const completion = await pbAlice.collection('completions').create({
      task_id: task.id,
      completed_by_id: alice.id,
      completed_at: nowIso,
      via: 'tap',
      notes: '',
    });
    expect(completion.id).toBeTruthy();
    expect(completion.task_id).toBe(task.id);
    expect(completion.completed_by_id).toBe(alice.id);
    expect(completion.via).toBe('tap');

    // Step 4 — Update MUST reject (updateRule = null → superusers only).
    let updateErr: unknown;
    try {
      await pbAlice
        .collection('completions')
        .update(completion.id, { notes: 'tampered' });
    } catch (e) {
      updateErr = e;
    }
    expect(updateErr).toBeInstanceOf(ClientResponseError);
    expect((updateErr as ClientResponseError).status).toBeGreaterThanOrEqual(
      400,
    );

    // Step 5 — Delete MUST reject (deleteRule = null → superusers only).
    let deleteErr: unknown;
    try {
      await pbAlice.collection('completions').delete(completion.id);
    } catch (e) {
      deleteErr = e;
    }
    expect(deleteErr).toBeInstanceOf(ClientResponseError);
    expect((deleteErr as ClientResponseError).status).toBeGreaterThanOrEqual(
      400,
    );

    // Step 6 — Alice forging completed_by_id = Bob's id MUST reject
    // (createRule body-check: `@request.body.completed_by_id = @request.auth.id`).
    let crossErr: unknown;
    try {
      await pbAlice.collection('completions').create({
        task_id: task.id,
        completed_by_id: bob.id,
        completed_at: new Date().toISOString(),
        via: 'tap',
        notes: '',
      });
    } catch (e) {
      crossErr = e;
    }
    expect(crossErr).toBeInstanceOf(ClientResponseError);
    expect((crossErr as ClientResponseError).status).toBeGreaterThanOrEqual(
      400,
    );

    // Step 7 — Confirm the ORIGINAL completion row is unchanged after the
    // rejected update attempt — repudiation defense proof.
    const reread = await pbAlice.collection('completions').getOne(
      completion.id,
      { fields: 'id,notes' },
    );
    expect(reread.notes).toBe(''); // still empty; the rejected PATCH did not land.

    // Cleanup of in-memory authStore for good test hygiene.
    pbAlice.authStore.clear();
    pbAdmin.authStore.clear();
  }, 30_000);
});
