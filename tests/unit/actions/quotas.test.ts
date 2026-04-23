// @vitest-environment node
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import PocketBase from 'pocketbase';

/**
 * Phase 25 RATE-01 — row-quota enforcement at the server-action layer.
 *
 * Exercises `createHome`, `createTask`, `createArea` through their
 * server-action entry points on a disposable PocketBase instance.
 * Per-create quotas ride on `lib/quotas.ts` and reject the N+1th
 * create with a friendly `formError` string containing "Quota exceeded".
 *
 * Port 18106 — next free after 18105 (rebalance-integration, Phase 17).
 *
 * Scenarios:
 *   1. Alice creates 5 homes → 6th rejected with quota error.
 *   2. Alice fills tasks quota in a home (MAX_TASKS_PER_HOME=10 via
 *      test env) → 11th rejected. Archived tasks exempt.
 *   3. Alice creates 10 location areas → 11th rejected. Whole Home
 *      area exempt.
 */

const PB_BIN = './.pb/pocketbase';
const DATA_DIR = './.pb/test-pb-data-quotas-actions';
const HTTP = '127.0.0.1:18106';

let pbProcess: ChildProcess | undefined;
let adminClient: PocketBase;
let currentAuthed: PocketBase;

// Mock the server PB client so the server actions read our disposable PB.
vi.mock('@/lib/pocketbase-server', () => ({
  createServerClient: async () => currentAuthed,
}));

// Mock the admin client (some action code imports it; we return admin).
vi.mock('@/lib/pocketbase-admin', () => ({
  createAdminClient: async () => adminClient,
  resetAdminClientCache: () => {},
}));

// Mock next/cache revalidatePath (server action side-effect, irrelevant).
vi.mock('next/cache', () => ({
  revalidatePath: () => {},
}));

// Mock next/navigation redirect to throw a recognisable signal so tests
// can tell that a redirect was attempted (createHome redirects on OK).
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

  pbProcess = spawn(
    PB_BIN,
    [
      'serve',
      `--http=${HTTP}`,
      `--dir=${DATA_DIR}`,
      '--migrationsDir=./pocketbase/pb_migrations',
      '--hooksDir=./pocketbase/pb_hooks',
    ],
    {
      env: {
        ...process.env,
        // Tighten the task ceiling so the test runs in seconds.
        MAX_TASKS_PER_HOME: '10',
      },
    },
  );

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

  adminClient = new PocketBase(`http://${HTTP}`);
  await adminClient
    .collection('_superusers')
    .authWithPassword('test@test.com', 'testpass123');

  // Mirror the test subprocess's MAX_TASKS_PER_HOME override into the
  // Node parent process so lib/quotas.ts reads the same ceiling.
  process.env.MAX_TASKS_PER_HOME = '10';
}, 30_000);

afterAll(() => {
  adminClient?.authStore.clear();
  pbProcess?.kill('SIGTERM');
  rmSync(DATA_DIR, { recursive: true, force: true });
  delete process.env.MAX_TASKS_PER_HOME;
});

describe('RATE-01 server-action quotas (port 18106)', () => {
  let aliceId: string;
  let aliceFirstHomeId: string;

  test('Scenario 1 — 5 homes/owner accepted, 6th rejected with quota error', async () => {
    const alice = await adminClient.collection('users').create({
      email: 'alice-q@test.com',
      password: 'alice1234567',
      passwordConfirm: 'alice1234567',
      name: 'Alice',
    });
    aliceId = alice.id;

    const aliceClient = new PocketBase(`http://${HTTP}`);
    await aliceClient
      .collection('users')
      .authWithPassword('alice-q@test.com', 'alice1234567');
    currentAuthed = aliceClient;

    const { createHome } = await import('@/lib/actions/homes');

    // Helper: build FormData for createHome.
    const fd = (name: string) => {
      const f = new FormData();
      f.set('name', name);
      f.set('timezone', 'Australia/Perth');
      return f;
    };

    // Create 5 homes — each should redirect (throws NEXT_REDIRECT).
    for (let i = 0; i < 5; i++) {
      let redirected = false;
      try {
        await createHome({ ok: false }, fd(`Home ${i}`));
      } catch (err) {
        if ((err as Error).message?.startsWith('NEXT_REDIRECT:')) {
          redirected = true;
        } else {
          throw err;
        }
      }
      expect(redirected).toBe(true);
    }

    // 6th home → action returns formError with quota reason (no throw).
    const r = await createHome({ ok: false }, fd('Home 6'));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected quota rejection');
    expect(r.formError).toMatch(/Quota exceeded/i);

    // DB sanity: exactly 5 homes.
    const list = await adminClient
      .collection('homes')
      .getFullList({ filter: `owner_id = "${aliceId}"` });
    expect(list).toHaveLength(5);

    aliceFirstHomeId = list[0].id;
  }, 60_000);

  test('Scenario 2 — MAX_TASKS_PER_HOME=10; 11th rejected; archived exempt', async () => {
    // Alice is still authed from scenario 1.
    const wholeHome = await adminClient
      .collection('areas')
      .getFirstListItem(
        `home_id = "${aliceFirstHomeId}" && is_whole_home_system = true`,
      );

    const { createTask, archiveTask } = await import('@/lib/actions/tasks');

    const taskFd = (name: string) => {
      const f = new FormData();
      f.set('home_id', aliceFirstHomeId);
      f.set('area_id', wholeHome.id);
      f.set('name', name);
      f.set('frequency_days', '7');
      f.set('schedule_mode', 'cycle');
      return f;
    };

    // createTask may redirect on success (TASK-01 flow). Treat
    // NEXT_REDIRECT as equivalent to an ok-return.
    const runTaskCreate = async (name: string) => {
      try {
        return await createTask({ ok: false }, taskFd(name));
      } catch (err) {
        const msg = (err as Error).message ?? '';
        if (msg.startsWith('NEXT_REDIRECT:')) {
          return { ok: true as const, _redirected: true };
        }
        throw err;
      }
    };

    const created: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await runTaskCreate(`Task ${i}`);
      if (!r.ok) {
        throw new Error(
          `task ${i} create failed: ${JSON.stringify((r as { formError?: string; fieldErrors?: unknown }).formError ?? (r as { fieldErrors?: unknown }).fieldErrors)}`,
        );
      }
      const rows = await adminClient.collection('tasks').getList(1, 1, {
        filter: `home_id = "${aliceFirstHomeId}" && name = "Task ${i}"`,
      });
      if (rows.items.length) created.push(rows.items[0].id);
    }
    expect(created).toHaveLength(10);

    // 11th → action returns formError before any redirect (quota check
    // happens BEFORE the create attempt, so no redirect fires).
    const over = await runTaskCreate('Task 11');
    expect(over.ok).toBe(false);
    if (over.ok) throw new Error('expected quota rejection');
    expect((over as { formError?: string }).formError).toMatch(/Quota exceeded/i);

    // Archive one existing task; the quota now has headroom again.
    await archiveTask(created[0]).catch((err: Error) => {
      if (!err.message?.startsWith('NEXT_REDIRECT:')) throw err;
    });

    // Retry: 10th+1 slot freed up → new create should succeed.
    const retry = await runTaskCreate('Task 11 retry');
    expect(retry.ok).toBe(true);
  }, 60_000);

  test('Scenario 3 — 10 location areas/home; 11th rejected; Whole Home exempt', async () => {
    // Admin-delete 2 of Alice's homes to make headroom for a fresh home.
    // (Alice is at her 5-home ceiling from scenario 1.)
    const existing = await adminClient
      .collection('homes')
      .getFullList({ filter: `owner_id = "${aliceId}"` });
    const toDelete = existing.filter((h) => h.id !== aliceFirstHomeId).slice(0, 2);
    for (const h of toDelete) {
      try {
        await adminClient.collection('homes').delete(h.id);
      } catch {
        /* cascade / block — fall through */
      }
    }

    // Create a fresh home via action → takes Alice to 4 homes.
    const { createHome } = await import('@/lib/actions/homes');
    const homeFd = new FormData();
    homeFd.set('name', 'Area Quota Home');
    homeFd.set('timezone', 'Australia/Perth');

    let redirectTarget: string | undefined;
    try {
      await createHome({ ok: false }, homeFd);
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (msg.startsWith('NEXT_REDIRECT:')) {
        redirectTarget = msg.substring('NEXT_REDIRECT:'.length);
      } else {
        throw err;
      }
    }
    expect(redirectTarget).toBeDefined();
    const areaHomeId = redirectTarget!.replace(/^\/h\//, '');

    // Verify the auto-created Whole Home exists (should be exempt).
    const wholeHome = await adminClient
      .collection('areas')
      .getFirstListItem(
        `home_id = "${areaHomeId}" && is_whole_home_system = true`,
      );
    expect(wholeHome.is_whole_home_system).toBe(true);

    const { createArea } = await import('@/lib/actions/areas');
    const areaFd = (name: string) => {
      const f = new FormData();
      f.set('home_id', areaHomeId);
      f.set('name', name);
      return f;
    };

    // 10 location areas — all should succeed.
    for (let i = 0; i < 10; i++) {
      const r = await createArea({ ok: false }, areaFd(`Area ${i}`));
      if (!r.ok) {
        throw new Error(
          `area ${i} failed: ${JSON.stringify(r.formError ?? r.fieldErrors)}`,
        );
      }
    }

    // 11th → rejected with quota error.
    const over = await createArea({ ok: false }, areaFd('Area 11'));
    expect(over.ok).toBe(false);
    if (over.ok) throw new Error('expected quota rejection');
    expect(over.formError).toMatch(/Quota exceeded/i);

    // Confirm 11 areas total (10 location + 1 Whole Home).
    const all = await adminClient
      .collection('areas')
      .getFullList({ filter: `home_id = "${areaHomeId}"` });
    expect(all).toHaveLength(11);
  }, 60_000);
});
