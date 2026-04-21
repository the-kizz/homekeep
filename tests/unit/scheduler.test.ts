// @vitest-environment node
import { describe, test, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import PocketBase from 'pocketbase';

/**
 * 06-02 Task 1 RED→GREEN: scheduler idempotency + opt-in contract (D-05, D-09, D-18/D-19).
 *
 * Port 18097 — allocation log: 18090 (02-01), 18091 (03-01), 18092/18093
 * (04-01 hook / rules), 18094 (04-02 invites-roundtrip), 18095 (05-01
 * homes-onboarded), 18096 (06-01 notifications idempotency), 18097 (this
 * plan, 06-02).
 *
 * Scenarios:
 *   A) Newly-overdue task fires exactly ONE ntfy POST + writes one row.
 *   B) Second processOverdueNotifications tick is idempotent — zero POSTs.
 *   C) Member with notify_overdue=false is skipped (opt-out honoured).
 *   D) Member with empty ntfy_topic is skipped (topic-absent honoured).
 *
 * Pattern: mirrors tests/unit/actions/invites-roundtrip.test.ts. PB
 * superuser created BEFORE `serve` (WAL race). Admin-client and
 * server-client are mocked via vi.mock so the scheduler module under test
 * talks to the disposable PB on port 18097.
 */

const PB_BIN = './.pb/pocketbase';
const DATA_DIR = './.pb/test-pb-data-scheduler';
const HTTP = '127.0.0.1:18097';
const ADMIN_EMAIL = 'test@test.com';
const ADMIN_PASS = 'testpass123';

let pbProcess: ChildProcess | undefined;
let adminClient: PocketBase;

// vi.mock is hoisted — we close over a mutable reference so the mock
// returns the live admin client bound to this test's PB instance.
vi.mock('@/lib/pocketbase-admin', () => ({
  createAdminClient: async () => adminClient,
  resetAdminClientCache: () => {},
}));

// Track fetch calls to ntfy (scheduler calls global fetch via lib/ntfy.ts).
type FetchCall = { url: string; init: RequestInit | undefined };
let fetchCalls: FetchCall[] = [];
const realFetch = globalThis.fetch;

function installMockFetch() {
  fetchCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    // Only intercept outbound ntfy.sh calls; pass-through PB calls.
    if (url.includes('ntfy.sh')) {
      fetchCalls.push({ url, init });
      return new Response('ok', { status: 200 });
    }
    return realFetch(input, init);
  }) as typeof fetch;
}

function restoreFetch() {
  globalThis.fetch = realFetch;
}

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

  await new Promise((res) => setTimeout(res, 500));

  adminClient = new PocketBase(`http://${HTTP}`);
  await adminClient
    .collection('_superusers')
    .authWithPassword(ADMIN_EMAIL, ADMIN_PASS);

  // NTFY_URL points at ntfy.sh so our mockFetch intercepts.
  process.env.NTFY_URL = 'https://ntfy.sh';
}, 30_000);

afterAll(() => {
  pbProcess?.kill('SIGTERM');
  rmSync(DATA_DIR, { recursive: true, force: true });
  restoreFetch();
});

beforeEach(() => {
  installMockFetch();
});

describe.sequential('scheduler overdue notifications', () => {
  // Shared fixtures across the four scenarios.
  let alice: { id: string };
  let bob: { id: string };
  let homeId: string;
  let areaId: string;
  let taskT1: { id: string };
  let taskT2: { id: string } | null = null;
  let taskT3: { id: string } | null = null;

  test('scenario A: new overdue task fires exactly one ntfy + writes one notification row', async () => {
    // Seed users. Alice opted-in with topic; Bob (created later) opted-in without topic.
    alice = await adminClient.collection('users').create({
      email: 'alice-s@test.com',
      password: 'alice1234567',
      passwordConfirm: 'alice1234567',
      name: 'Alice',
      ntfy_topic: 'alice-test-abc123',
      notify_overdue: true,
      notify_assigned: true,
      notify_partner_completed: false,
      notify_weekly_summary: false,
      weekly_summary_day: 'sunday',
    });

    // Alice authenticates + creates a home (hooks auto-create Whole Home area + owner membership).
    const aliceClient = new PocketBase(`http://${HTTP}`);
    await aliceClient
      .collection('users')
      .authWithPassword('alice-s@test.com', 'alice1234567');
    const home = await aliceClient.collection('homes').create({
      name: 'Test Home',
      timezone: 'UTC',
      owner_id: alice.id,
    });
    homeId = home.id;

    // Lookup the Whole Home area the hook created.
    const wholeHome = await adminClient
      .collection('areas')
      .getFirstListItem(`home_id = "${homeId}"`);
    areaId = wholeHome.id;

    // Create a task with created=2 days ago, frequency_days=1 → already 1 day overdue.
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
    const t1 = await aliceClient.collection('tasks').create({
      home_id: homeId,
      area_id: areaId,
      name: 'Wipe benches',
      description: '',
      frequency_days: 1,
      schedule_mode: 'cycle',
      anchor_date: '',
      created: twoDaysAgo,
      icon: '',
      color: '',
      assigned_to_id: '',
      notes: '',
      archived: false,
    });
    // PB does not let you set created on create. Re-read + fail fast if needed.
    taskT1 = { id: t1.id };

    // Now run the scheduler. Must detect T1 as overdue, send one ntfy, record one notification.
    const { processOverdueNotifications } = await import('@/lib/scheduler');
    const sent = await processOverdueNotifications(new Date());

    expect(sent).toBe(1);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe('https://ntfy.sh/alice-test-abc123');

    const rows = await adminClient.collection('notifications').getFullList({
      filter: `user_id = "${alice.id}"`,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('overdue');
    expect(rows[0].ref_cycle).toContain(`task:${taskT1.id}:overdue:`);
  }, 60_000);

  test('scenario B: second run is idempotent — zero new ntfy calls', async () => {
    // Reset the fetch call log.
    installMockFetch();

    const { processOverdueNotifications } = await import('@/lib/scheduler');
    const sent = await processOverdueNotifications(new Date());

    expect(sent).toBe(0);
    expect(fetchCalls).toHaveLength(0);

    const rows = await adminClient.collection('notifications').getFullList({
      filter: `user_id = "${alice.id}"`,
    });
    expect(rows).toHaveLength(1); // unchanged
  }, 60_000);

  test('scenario C: opt-out is respected — notify_overdue=false skips', async () => {
    // Flip Alice to opt-out.
    await adminClient.collection('users').update(alice.id, {
      notify_overdue: false,
    });

    // Add a second overdue task T2.
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
    const aliceClient = new PocketBase(`http://${HTTP}`);
    await aliceClient
      .collection('users')
      .authWithPassword('alice-s@test.com', 'alice1234567');
    const t2 = await aliceClient.collection('tasks').create({
      home_id: homeId,
      area_id: areaId,
      name: 'Dust shelves',
      description: '',
      frequency_days: 1,
      schedule_mode: 'cycle',
      anchor_date: '',
      created: twoDaysAgo,
      icon: '',
      color: '',
      assigned_to_id: '',
      notes: '',
      archived: false,
    });
    taskT2 = { id: t2.id };

    installMockFetch();
    const { processOverdueNotifications } = await import('@/lib/scheduler');
    const sent = await processOverdueNotifications(new Date());

    // Alice is opted out → zero ntfy calls for T2.
    expect(sent).toBe(0);
    expect(fetchCalls).toHaveLength(0);
  }, 60_000);

  test('scenario D: no ntfy_topic → member skipped', async () => {
    // Re-enable Alice's opt-in. Create Bob with notify_overdue=true but empty topic.
    await adminClient.collection('users').update(alice.id, {
      notify_overdue: true,
    });

    bob = await adminClient.collection('users').create({
      email: 'bob-s@test.com',
      password: 'bob1234567890',
      passwordConfirm: 'bob1234567890',
      name: 'Bob',
      ntfy_topic: '',
      notify_overdue: true,
      notify_assigned: true,
      notify_partner_completed: false,
      notify_weekly_summary: false,
      weekly_summary_day: 'sunday',
    });

    // Add Bob as member of Alice's home (superuser bypasses createRule).
    await adminClient.collection('home_members').create({
      home_id: homeId,
      user_id: bob.id,
      role: 'member',
    });

    // Add a third overdue task T3.
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
    const aliceClient = new PocketBase(`http://${HTTP}`);
    await aliceClient
      .collection('users')
      .authWithPassword('alice-s@test.com', 'alice1234567');
    const t3 = await aliceClient.collection('tasks').create({
      home_id: homeId,
      area_id: areaId,
      name: 'Water plants',
      description: '',
      frequency_days: 1,
      schedule_mode: 'cycle',
      anchor_date: '',
      created: twoDaysAgo,
      icon: '',
      color: '',
      assigned_to_id: '',
      notes: '',
      archived: false,
    });
    taskT3 = { id: t3.id };

    installMockFetch();
    const { processOverdueNotifications } = await import('@/lib/scheduler');
    const sent = await processOverdueNotifications(new Date());

    // Alice was already notified for T1; T2+T3 are new overdues.
    // Alice should get new notifications for T2 and T3.
    // Bob should get zero (empty topic).
    const bobRows = await adminClient.collection('notifications').getFullList({
      filter: `user_id = "${bob.id}"`,
    });
    expect(bobRows).toHaveLength(0);

    // Every fetch call should target alice's topic — never bob's (empty).
    for (const call of fetchCalls) {
      expect(call.url).toBe('https://ntfy.sh/alice-test-abc123');
    }

    // Alice picks up T2 + T3 this run (and was already notified for T1).
    expect(sent).toBe(2);
    const aliceRows = await adminClient.collection('notifications').getFullList({
      filter: `user_id = "${alice.id}"`,
    });
    expect(aliceRows).toHaveLength(3);
  }, 60_000);
});
