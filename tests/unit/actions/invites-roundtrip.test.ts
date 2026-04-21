// @vitest-environment node
import { describe, test, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import PocketBase from 'pocketbase';

/**
 * 04-02 Task 2 — invites + members server actions end-to-end roundtrip
 * against a live disposable PocketBase. Proves every HOME-05 / HOME-06 /
 * HOME-07 behavior contract in the plan's `must_haves.truths`.
 *
 * Port 18094 — 18090 (02-01), 18091 (03-01), 18092 (04-01 hook),
 * 18093 (04-01 rules) are all in use. Each test file owns a unique port
 * so vitest parallel runners don't collide.
 *
 * Scaffolding pattern (same as hooks-home-members.test.ts,
 * rules-member-isolation.test.ts):
 *   - Superuser created via CLI BEFORE `pb serve` starts.
 *   - `--migrationsDir` points at pocketbase/pb_migrations so all
 *     Phase 1-4 migrations apply on first boot.
 *   - Mock `@/lib/pocketbase-server` + `@/lib/pocketbase-admin` via
 *     vi.mock so the action code under test talks to our test-local
 *     PB instance.
 *
 * Scenarios (9):
 *   1. Owner creates invite → returns {ok, token, url, expiresAt};
 *      invites row exists with created_by_id=owner, accepted_at=null.
 *   2. Bob (new user) accepts invite → home_members row + invites row
 *      updated atomically via pb.createBatch().
 *   3. Bob re-accepts same invite → idempotent {ok:true}.
 *   4. Charlie (third user) accepts same (now-used) invite →
 *      {ok:false, reason:'already-accepted'}.
 *   5. Non-owner calls createInvite → formError.
 *   6. Expired invite → {ok:false, reason:'expired'}.
 *   7. Owner removes Bob → {ok:true}, home_members row deleted.
 *   8. Owner calls leaveHome → formError (must delete/transfer first).
 *   9. Bob re-joins, then calls leaveHome → {ok:true, redirectTo:'/h'}
 *      and users.last_viewed_home_id cleared if it matched.
 */

const PB_BIN = './.pb/pocketbase';
const DATA_DIR = './.pb/test-pb-data-invites-roundtrip';
const HTTP = '127.0.0.1:18094';
const ADMIN_EMAIL = 'test@test.com';
const ADMIN_PASS = 'testpass123';

let pbProcess: ChildProcess | undefined;

// Module-level client holders that vi.mock closures read via getters
// (vi.mock is hoisted — refs must be mutated after beforeAll).
let adminClient: PocketBase;
const aliceClient = () => new PocketBase(`http://${HTTP}`);

// Per-test "current authed user" client that `createServerClient` mock returns.
let currentAuthed: PocketBase;

// Mock the server PB client — action files import it and expect a fresh,
// request-scoped PB client authed via the HttpOnly cookie. The integration
// test substitutes a directly-authed PB client instead.
vi.mock('@/lib/pocketbase-server', () => ({
  createServerClient: async () => currentAuthed,
}));

// Mock the admin client — in production it reads PB_ADMIN_EMAIL /
// PB_ADMIN_PASSWORD from env and auths against :8090. Here we return a
// pre-authed superuser client bound to our test port.
vi.mock('@/lib/pocketbase-admin', () => ({
  createAdminClient: async () => adminClient,
  resetAdminClientCache: () => {},
}));

// Mock next/cache revalidatePath (server action side-effect, not useful
// in a node integration test).
vi.mock('next/cache', () => ({
  revalidatePath: () => {},
}));

// Mock next/navigation redirect to throw (so we can detect that server
// actions that `redirect()` actually attempted to).
vi.mock('next/navigation', () => ({
  redirect: (target: string) => {
    const err = new Error(`NEXT_REDIRECT:${target}`);
    (err as Error & { digest?: string }).digest = `NEXT_REDIRECT;${target}`;
    throw err;
  },
}));

beforeAll(async () => {
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const p = spawn(PB_BIN, [
      'superuser',
      'create',
      ADMIN_EMAIL,
      ADMIN_PASS,
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
      if (r.ok) break;
    } catch {
      /* not ready yet */
    }
    await new Promise((res) => setTimeout(res, 200));
  }

  // Give PB a tick to finish applying migrations in its background goroutine.
  await new Promise((res) => setTimeout(res, 500));

  adminClient = new PocketBase(`http://${HTTP}`);
  await adminClient
    .collection('_superusers')
    .authWithPassword(ADMIN_EMAIL, ADMIN_PASS);

  // Point SITE_URL for invite URL building (createInvite reads it).
  process.env.SITE_URL = 'http://localhost:3000';
}, 30_000);

afterAll(() => {
  pbProcess?.kill('SIGTERM');
  rmSync(DATA_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  // Reset the authed client between tests — each scenario sets its own.
  currentAuthed = new PocketBase(`http://${HTTP}`);
});

describe('invites + members roundtrip', () => {
  // Shared users + homes created in scenario 1 and reused downstream.
  let alice: { id: string };
  let bob: { id: string };
  let charlie: { id: string };
  let aliceHome: { id: string };
  let charlieHome: { id: string };
  let invite: { token: string; id: string };

  test('scenario 1: owner creates invite → returns token+url+expiry', async () => {
    // Seed: Alice, Bob, Charlie via superuser.
    alice = await adminClient.collection('users').create({
      email: 'alice-r@test.com',
      password: 'alice1234567',
      passwordConfirm: 'alice1234567',
      name: 'Alice',
    });
    bob = await adminClient.collection('users').create({
      email: 'bob-r@test.com',
      password: 'bob1234567890',
      passwordConfirm: 'bob1234567890',
      name: 'Bob',
    });
    charlie = await adminClient.collection('users').create({
      email: 'charlie-r@test.com',
      password: 'charlie1234567',
      passwordConfirm: 'charlie1234567',
      name: 'Charlie',
    });

    // Alice auths + creates her home (owner-member auto-insert via 04-01 hook).
    const aliceClient = new PocketBase(`http://${HTTP}`);
    await aliceClient
      .collection('users')
      .authWithPassword('alice-r@test.com', 'alice1234567');
    aliceHome = await aliceClient.collection('homes').create({
      name: 'Alice Home',
      timezone: 'Australia/Perth',
      owner_id: alice.id,
    });

    // Charlie auths + creates his own home (so Alice is a non-owner of it).
    const charlieClient = new PocketBase(`http://${HTTP}`);
    await charlieClient
      .collection('users')
      .authWithPassword('charlie-r@test.com', 'charlie1234567');
    charlieHome = await charlieClient.collection('homes').create({
      name: 'Charlie Home',
      timezone: 'Australia/Perth',
      owner_id: charlie.id,
    });

    // Swap currentAuthed to Alice (the server action will see her authStore).
    currentAuthed = aliceClient;

    const { createInvite } = await import('@/lib/actions/invites');
    const r = await createInvite(aliceHome.id);

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('createInvite failed');
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(r.url).toBe(`http://localhost:3000/invite/${r.token}`);
    expect(new Date(r.expiresAt).getTime()).toBeGreaterThan(Date.now());

    // Confirm DB row shape.
    const inviteRow = await adminClient
      .collection('invites')
      .getFirstListItem(adminClient.filter('token = {:t}', { t: r.token }));
    expect(inviteRow.home_id).toBe(aliceHome.id);
    expect(inviteRow.created_by_id).toBe(alice.id);
    expect(inviteRow.accepted_at).toBeFalsy();

    invite = { token: r.token, id: inviteRow.id };
  }, 60_000);

  test('scenario 2: Bob (new user) accepts invite → atomic membership + mark accepted', async () => {
    // Bob auths.
    const bobClient = new PocketBase(`http://${HTTP}`);
    await bobClient
      .collection('users')
      .authWithPassword('bob-r@test.com', 'bob1234567890');
    currentAuthed = bobClient;

    const { acceptInvite } = await import('@/lib/actions/invites');
    const r = await acceptInvite(invite.token);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('acceptInvite failed');
    expect(r.homeId).toBe(aliceHome.id);

    // home_members row for Bob exists with role=member.
    const memberRow = await adminClient
      .collection('home_members')
      .getFirstListItem(
        adminClient.filter('home_id = {:h} && user_id = {:u}', {
          h: aliceHome.id,
          u: bob.id,
        }),
      );
    expect(memberRow.role).toBe('member');

    // invites row: accepted_at set + accepted_by_id = Bob.
    const inviteRow = await adminClient.collection('invites').getOne(invite.id);
    expect(inviteRow.accepted_at).toBeTruthy();
    expect(inviteRow.accepted_by_id).toBe(bob.id);

    // Bob's last_viewed_home_id updated to the joined home.
    const bobRec = await adminClient.collection('users').getOne(bob.id);
    expect(bobRec.last_viewed_home_id).toBe(aliceHome.id);
  }, 30_000);

  test('scenario 3: Bob re-accepts same invite → idempotent {ok:true}', async () => {
    const bobClient = new PocketBase(`http://${HTTP}`);
    await bobClient
      .collection('users')
      .authWithPassword('bob-r@test.com', 'bob1234567890');
    currentAuthed = bobClient;

    const { acceptInvite } = await import('@/lib/actions/invites');
    const r = await acceptInvite(invite.token);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('self re-accept should be idempotent');
    expect(r.homeId).toBe(aliceHome.id);
  }, 30_000);

  test('scenario 4: Charlie accepts already-used invite → already-accepted', async () => {
    const charlieClient = new PocketBase(`http://${HTTP}`);
    await charlieClient
      .collection('users')
      .authWithPassword('charlie-r@test.com', 'charlie1234567');
    currentAuthed = charlieClient;

    const { acceptInvite } = await import('@/lib/actions/invites');
    const r = await acceptInvite(invite.token);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('Charlie should get already-accepted');
    expect(r.reason).toBe('already-accepted');
  }, 30_000);

  test('scenario 5: non-owner createInvite → formError', async () => {
    // Alice tries to createInvite on Charlie's home — she's not the owner.
    const aliceClient = new PocketBase(`http://${HTTP}`);
    await aliceClient
      .collection('users')
      .authWithPassword('alice-r@test.com', 'alice1234567');
    currentAuthed = aliceClient;

    const { createInvite } = await import('@/lib/actions/invites');
    const r = await createInvite(charlieHome.id);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('non-owner should be rejected');
    expect(r.formError).toMatch(/owner/i);
  }, 30_000);

  test('scenario 6: expired invite → {ok:false, reason:"expired"}', async () => {
    // Insert an expired invite directly via superuser (the create action
    // always computes expires_at in the future, so we need to bypass it).
    const expiredToken = 'expired_abc_DEF-ghi_JKL-mno_PQR-stu'.slice(0, 32);
    await adminClient.collection('invites').create({
      home_id: aliceHome.id,
      token: expiredToken,
      expires_at: new Date(Date.now() - 86400000).toISOString(), // yesterday
      created_by_id: alice.id,
    });

    // Charlie tries to accept the expired invite.
    const charlieClient = new PocketBase(`http://${HTTP}`);
    await charlieClient
      .collection('users')
      .authWithPassword('charlie-r@test.com', 'charlie1234567');
    currentAuthed = charlieClient;

    const { acceptInvite } = await import('@/lib/actions/invites');
    const r = await acceptInvite(expiredToken);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expired invite should fail');
    expect(r.reason).toBe('expired');
  }, 30_000);

  test('scenario 7: owner removes Bob → {ok:true}, membership deleted', async () => {
    const aliceClient = new PocketBase(`http://${HTTP}`);
    await aliceClient
      .collection('users')
      .authWithPassword('alice-r@test.com', 'alice1234567');
    currentAuthed = aliceClient;

    const { removeMember } = await import('@/lib/actions/members');
    const r = await removeMember(aliceHome.id, bob.id);
    expect(r.ok).toBe(true);

    // home_members row for Bob is gone.
    const rows = await adminClient
      .collection('home_members')
      .getFullList({
        filter: adminClient.filter('home_id = {:h} && user_id = {:u}', {
          h: aliceHome.id,
          u: bob.id,
        }),
      });
    expect(rows).toHaveLength(0);
  }, 30_000);

  test('scenario 8: owner calls leaveHome → formError (must delete or transfer)', async () => {
    const aliceClient = new PocketBase(`http://${HTTP}`);
    await aliceClient
      .collection('users')
      .authWithPassword('alice-r@test.com', 'alice1234567');
    currentAuthed = aliceClient;

    const { leaveHome } = await import('@/lib/actions/members');
    const r = await leaveHome(aliceHome.id);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('owner leaveHome should be refused');
    expect(r.formError).toMatch(/owner/i);
  }, 30_000);

  test('scenario 9: Bob re-joins via new invite → leaveHome succeeds + last_viewed cleared', async () => {
    // Alice creates a new invite for Bob.
    const aliceClient = new PocketBase(`http://${HTTP}`);
    await aliceClient
      .collection('users')
      .authWithPassword('alice-r@test.com', 'alice1234567');
    currentAuthed = aliceClient;

    const { createInvite } = await import('@/lib/actions/invites');
    const mk = await createInvite(aliceHome.id);
    expect(mk.ok).toBe(true);
    if (!mk.ok) throw new Error('recreate invite failed');

    // Bob auths + accepts.
    const bobClient = new PocketBase(`http://${HTTP}`);
    await bobClient
      .collection('users')
      .authWithPassword('bob-r@test.com', 'bob1234567890');
    currentAuthed = bobClient;

    const { acceptInvite } = await import('@/lib/actions/invites');
    const acc = await acceptInvite(mk.token);
    expect(acc.ok).toBe(true);

    // acceptInvite already sets last_viewed_home_id to aliceHome.id.
    // Sanity-check that state is where we want it before the leaveHome.
    const bobBefore = await adminClient.collection('users').getOne(bob.id);
    expect(bobBefore.last_viewed_home_id).toBe(aliceHome.id);

    // Bob calls leaveHome.
    const { leaveHome } = await import('@/lib/actions/members');
    const r = await leaveHome(aliceHome.id);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('leaveHome failed');
    expect(r.redirectTo).toBe('/h');

    // Bob's home_members row for Alice Home is deleted.
    const rows = await adminClient
      .collection('home_members')
      .getFullList({
        filter: adminClient.filter('home_id = {:h} && user_id = {:u}', {
          h: aliceHome.id,
          u: bob.id,
        }),
      });
    expect(rows).toHaveLength(0);

    // Bob's last_viewed_home_id cleared because it matched the left home.
    const bobAfter = await adminClient.collection('users').getOne(bob.id);
    expect(bobAfter.last_viewed_home_id).toBeFalsy();
  }, 30_000);
});
