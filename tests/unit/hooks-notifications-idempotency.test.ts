// @vitest-environment node
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import PocketBase, { ClientResponseError } from 'pocketbase';

/**
 * 06-01 Task 1 RED→GREEN: notifications collection idempotency contract (D-05).
 *
 * Boots a disposable PocketBase on 127.0.0.1:18096 (distinct from 18090..18095
 * previously claimed by 02-01 / 03-01 / 04-01 / 04-02 / 05-01) so this suite
 * can run concurrently with the rest of the unit matrix without cross-
 * contamination.
 *
 * Contract under test (per D-05 + threat_model T-06-01-01..03):
 *   1. Superuser-created notifications row with a unique (user_id, ref_cycle)
 *      returns 201.
 *   2. A second superuser insert with the same (user_id, ref_cycle) tuple
 *      rejects with HTTP 400 via the unique-index violation — race-condition
 *      safety net behind the hasNotified() pre-check.
 *   3. Same ref_cycle but a DIFFERENT user_id succeeds — the index is
 *      per-user, not global.
 *   4. A non-superuser PATCH on an inserted row rejects (updateRule=null).
 *   5. A non-superuser DELETE on an inserted row rejects (deleteRule=null).
 *   6. The original row is unchanged after the rejected PATCH attempt.
 *
 * Port allocation log: 18090 (02-01), 18091 (03-01), 18092/18093 (04-01),
 * 18094 (04-02), 18095 (05-01), 18096 (this plan, 06-01).
 */

const PB_BIN = './.pb/pocketbase';
const DATA_DIR = './.pb/test-pb-data-notifications';
const HTTP = '127.0.0.1:18096';

let pbProcess: ChildProcess | undefined;

beforeAll(async () => {
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });

  // Create the superuser BEFORE `serve` starts (02-01 WAL-race mitigation).
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
      /* not ready */
    }
    await new Promise((res) => setTimeout(res, 200));
  }
  throw new Error('PB did not start within 6s');
}, 20_000);

afterAll(() => {
  pbProcess?.kill('SIGTERM');
  rmSync(DATA_DIR, { recursive: true, force: true });
});

describe('notifications collection (idempotent, append-only)', () => {
  test('unique (user_id, ref_cycle) + non-superuser PATCH/DELETE reject', async () => {
    const pbAdmin = new PocketBase(`http://${HTTP}`);
    await pbAdmin
      .collection('_superusers')
      .authWithPassword('test@test.com', 'testpass123');

    // --- Fixtures: two users, two homes (each owns one) -----------------------
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

    const pbAlice = new PocketBase(`http://${HTTP}`);
    await pbAlice
      .collection('users')
      .authWithPassword('alice@test.com', 'alice123456');

    const homeAlice = await pbAlice.collection('homes').create({
      name: 'Alice Home',
      timezone: 'Australia/Perth',
      owner_id: alice.id,
    });

    const pbBob = new PocketBase(`http://${HTTP}`);
    await pbBob
      .collection('users')
      .authWithPassword('bob@test.com', 'bob123456789');

    const homeBob = await pbBob.collection('homes').create({
      name: 'Bob Home',
      timezone: 'Australia/Perth',
      owner_id: bob.id,
    });

    // --- Case 1: first superuser insert succeeds ------------------------------
    const refCycle = 'user:alice:weekly:2026-W17';
    const first = await pbAdmin.collection('notifications').create({
      user_id: alice.id,
      home_id: homeAlice.id,
      task_id: null,
      kind: 'weekly_summary',
      sent_at: new Date().toISOString(),
      ref_cycle: refCycle,
    });
    expect(first.id).toBeTruthy();
    expect(first.ref_cycle).toBe(refCycle);
    expect(first.kind).toBe('weekly_summary');

    // --- Case 2: duplicate (same user_id, same ref_cycle) rejects via index ---
    let dupErr: unknown;
    try {
      await pbAdmin.collection('notifications').create({
        user_id: alice.id,
        home_id: homeAlice.id,
        task_id: null,
        kind: 'weekly_summary',
        sent_at: new Date().toISOString(),
        ref_cycle: refCycle,
      });
    } catch (e) {
      dupErr = e;
    }
    expect(dupErr).toBeInstanceOf(ClientResponseError);
    expect((dupErr as ClientResponseError).status).toBeGreaterThanOrEqual(400);

    // --- Case 3: same ref_cycle but different user_id succeeds ----------------
    const cross = await pbAdmin.collection('notifications').create({
      user_id: bob.id,
      home_id: homeBob.id,
      task_id: null,
      kind: 'weekly_summary',
      sent_at: new Date().toISOString(),
      ref_cycle: refCycle,
    });
    expect(cross.id).toBeTruthy();
    expect(cross.user_id).toBe(bob.id);

    // --- Case 4: Alice cannot PATCH her own notifications row -----------------
    let patchErr: unknown;
    try {
      await pbAlice
        .collection('notifications')
        .update(first.id, { kind: 'overdue' });
    } catch (e) {
      patchErr = e;
    }
    expect(patchErr).toBeInstanceOf(ClientResponseError);
    expect((patchErr as ClientResponseError).status).toBeGreaterThanOrEqual(400);

    // --- Case 5: Alice cannot DELETE her own notifications row ----------------
    let delErr: unknown;
    try {
      await pbAlice.collection('notifications').delete(first.id);
    } catch (e) {
      delErr = e;
    }
    expect(delErr).toBeInstanceOf(ClientResponseError);
    expect((delErr as ClientResponseError).status).toBeGreaterThanOrEqual(400);

    // --- Case 6: original row unchanged after rejected PATCH ------------------
    const reread = await pbAdmin.collection('notifications').getOne(first.id, {
      fields: 'id,kind,ref_cycle',
    });
    expect(reread.kind).toBe('weekly_summary');
    expect(reread.ref_cycle).toBe(refCycle);

    pbAlice.authStore.clear();
    pbBob.authStore.clear();
    pbAdmin.authStore.clear();
  }, 30_000);
});
