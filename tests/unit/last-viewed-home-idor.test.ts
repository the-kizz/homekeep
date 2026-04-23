// @vitest-environment node
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import PocketBase, { ClientResponseError } from 'pocketbase';

/**
 * Phase 23 SEC-05 — last_viewed_home_id IDOR integration test.
 *
 * The `users.last_viewed_home_id` relation lives on the built-in users
 * collection, which allows self-update under PB's default rule. The
 * action-layer switchHome() already calls assertMembership before
 * writing, but a direct SDK call to /api/collections/users/records/:id
 * would bypass that guard pre-hook.
 *
 * The new pb_hook `users_last_viewed_home_membership.pb.js` is the
 * DB-layer backstop: on users.update, if last_viewed_home_id is
 * changing to a non-empty value, the hook verifies a home_members
 * row exists for (target home, authed user) and throws BadRequestError
 * otherwise.
 *
 * Scenarios:
 *   1. User tries to set last_viewed_home_id to a home they are NOT a
 *      member of -> 4xx rejection (hook blocks).
 *   2. User sets last_viewed_home_id to a home they ARE a member of ->
 *      success (hook permits).
 *   3. User clears last_viewed_home_id (empty string) -> success (hook
 *      permits clears unconditionally).
 *
 * Port 18100 — next free after 18099 (last v1.1 integration port).
 */

const PB_BIN = './.pb/pocketbase';
const DATA_DIR = './.pb/test-pb-data-last-viewed-idor';
const HTTP = '127.0.0.1:18100';

let pbProcess: ChildProcess | undefined;
let pbAdmin: PocketBase;
let pbAlice: PocketBase;
let aliceId: string;
let aliceHomeId: string;
let malloryHomeId: string;

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
      /* not ready */
    }
    await new Promise((res) => setTimeout(res, 200));
  }
  if (!healthy) throw new Error('PB did not start within 6s');

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

  // Alice creates her own home (home_members row auto-created by the
  // homes_whole_home hook for the owner).
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

  // Mallory creates her own home — Alice is NOT a member.
  const pbMallory = new PocketBase(`http://${HTTP}`);
  await pbMallory
    .collection('users')
    .authWithPassword('mallory@test.com', 'mallory123456');
  const malloryHome = await pbMallory.collection('homes').create({
    name: 'Mallory Home',
    timezone: 'Australia/Perth',
    owner_id: mallory.id,
  });
  malloryHomeId = malloryHome.id;
}, 30_000);

afterAll(() => {
  pbAlice?.authStore.clear();
  pbAdmin?.authStore.clear();
  pbProcess?.kill('SIGTERM');
  rmSync(DATA_DIR, { recursive: true, force: true });
});

describe('SEC-05 last_viewed_home_id IDOR hook (port 18100)', () => {
  test('Scenario 1 — setting to a non-member home is REJECTED by the hook', async () => {
    let err: unknown;
    try {
      await pbAlice
        .collection('users')
        .update(aliceId, { last_viewed_home_id: malloryHomeId });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ClientResponseError);
    expect((err as ClientResponseError).status).toBeGreaterThanOrEqual(400);

    // Defense-in-depth: the stored value should be unchanged.
    const reread = await pbAlice
      .collection('users')
      .getOne(aliceId, { fields: 'id,last_viewed_home_id' });
    expect(reread.last_viewed_home_id).not.toBe(malloryHomeId);
  }, 30_000);

  test('Scenario 2 — setting to a member home succeeds', async () => {
    const updated = await pbAlice
      .collection('users')
      .update(aliceId, { last_viewed_home_id: aliceHomeId });
    expect(updated.last_viewed_home_id).toBe(aliceHomeId);
  }, 30_000);

  test('Scenario 3 — clearing last_viewed_home_id (empty) always succeeds', async () => {
    const updated = await pbAlice
      .collection('users')
      .update(aliceId, { last_viewed_home_id: '' });
    // PB stores empty-relation as either '' or null depending on version.
    expect(
      updated.last_viewed_home_id === '' || updated.last_viewed_home_id === null,
    ).toBe(true);
  }, 30_000);

  test('Scenario 4 — updating OTHER fields without touching last_viewed_home_id is unaffected', async () => {
    const updated = await pbAlice
      .collection('users')
      .update(aliceId, { name: 'Alice Renamed' });
    expect(updated.name).toBe('Alice Renamed');
  }, 30_000);
});
