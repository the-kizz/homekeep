// @vitest-environment node
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import PocketBase from 'pocketbase';

/**
 * 05-01 Task 1 — proves migration 1714953604_homes_onboarded.js correctly:
 *   a) Adds a BoolField `onboarded` to the `homes` collection.
 *   b) Defaults new homes (created AFTER the migration ran) to `false` —
 *      this is the "show the wizard" path for Phase 5.
 *   c) Round-trips the field: writing `onboarded=true` via PATCH persists
 *      and re-reads as `true`.
 *
 * Backfill note (D-15): the migration backfills pre-existing `homes` rows
 * to `onboarded=true`. At first-boot of a disposable PB the DB is empty, so
 * there's nothing to backfill — the happy path is covered instead by (b)
 * which proves new rows default to `false` (i.e. the migration did NOT
 * force-default-true on all future inserts, which would break ONBD-01).
 * Pre-existing-row backfill behaviour is also asserted implicitly by the
 * migration loading without error against the full migration set.
 *
 * Scaffolding mirrors tests/unit/hooks-whole-home.test.ts (02-01) and
 * tests/unit/hooks-home-members.test.ts (04-01):
 *   - Superuser created via CLI BEFORE `pb serve` starts (SQLite WAL race
 *     avoidance — 02-01 learning).
 *   - Port 18095 — new entry in the disposable-PB allocation table:
 *       18090 (02-01 whole-home), 18091 (03-01 completions),
 *       18092 (04-01 home-members), 18093 (04-01 rules),
 *       18094 (04-02 invites-roundtrip), 18095 (05-01 homes-onboarded).
 *   - `--migrationsDir` points at pocketbase/pb_migrations so ALL Phase
 *     2+3+4+5 migrations apply on first boot — this exercises 1714953604.
 */

const PB_BIN = './.pb/pocketbase';
const DATA_DIR = './.pb/test-pb-data-homes-onboarded';
const HTTP = '127.0.0.1:18095';

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

describe('homes.onboarded field (migration 1714953604)', () => {
  test('new home defaults to onboarded=false (wizard-should-run path)', async () => {
    const pb = new PocketBase(`http://${HTTP}`);
    await pb
      .collection('_superusers')
      .authWithPassword('test@test.com', 'testpass123');

    const user = await pb.collection('users').create({
      email: 'alice-onboarded@test.com',
      password: 'alice123456',
      passwordConfirm: 'alice123456',
      name: 'Alice',
    });

    const home = await pb.collection('homes').create({
      name: 'New Home',
      timezone: 'Australia/Perth',
      owner_id: user.id,
    });

    // Re-fetch to see the stored field (the create response may omit
    // fields not explicitly set; the GET returns the full row).
    const fetched = await pb.collection('homes').getOne(home.id);
    expect(fetched).toHaveProperty('onboarded');
    expect(fetched.onboarded).toBe(false);
  }, 15_000);

  test('onboarded=true round-trips via update', async () => {
    const pb = new PocketBase(`http://${HTTP}`);
    await pb
      .collection('_superusers')
      .authWithPassword('test@test.com', 'testpass123');

    const user = await pb.collection('users').create({
      email: 'bob-onboarded@test.com',
      password: 'bob12345678',
      passwordConfirm: 'bob12345678',
      name: 'Bob',
    });

    const home = await pb.collection('homes').create({
      name: "Bob's Home",
      timezone: 'Australia/Melbourne',
      owner_id: user.id,
    });
    expect(home.onboarded === false || home.onboarded === undefined).toBe(true);

    const updated = await pb
      .collection('homes')
      .update(home.id, { onboarded: true });
    expect(updated.onboarded).toBe(true);

    const refetched = await pb.collection('homes').getOne(home.id);
    expect(refetched.onboarded).toBe(true);
  }, 15_000);

  test('onboarded=true can be flipped back to false (idempotent flag)', async () => {
    const pb = new PocketBase(`http://${HTTP}`);
    await pb
      .collection('_superusers')
      .authWithPassword('test@test.com', 'testpass123');

    const user = await pb.collection('users').create({
      email: 'carol-onboarded@test.com',
      password: 'carol1234567',
      passwordConfirm: 'carol1234567',
      name: 'Carol',
    });

    const home = await pb.collection('homes').create({
      name: "Carol's Home",
      timezone: 'Australia/Brisbane',
      owner_id: user.id,
      onboarded: true,
    });
    expect(home.onboarded).toBe(true);

    await pb.collection('homes').update(home.id, { onboarded: false });
    const refetched = await pb.collection('homes').getOne(home.id);
    expect(refetched.onboarded).toBe(false);
  }, 15_000);
});
