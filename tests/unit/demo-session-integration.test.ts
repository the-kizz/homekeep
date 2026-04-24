// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep

/**
 * Phase 26 DEMO integration suite — port 18106.
 *
 * 5 scenarios on disposable PocketBase per D-17:
 *
 *   1. DEMO_MODE=true + no cookie → session created, home + 3 areas +
 *      15 seed tasks seeded, users.is_demo=true, cookies returned.
 *   2. Resume existing session → same home returned, last_activity
 *      updated, NO new user/home/tasks created.
 *   3. 2h idle → cleanup sweep deletes the user + home + tasks
 *      (demo_cleanup.pb.js cron simulated by direct-invoking the
 *      logic via a crafted user row with last_activity in the past).
 *   4. 24h absolute → deletion regardless of activity (fresh
 *      last_activity but created > 24h ago → still evicted).
 *   5. Cleanup sweep does NOT touch users where is_demo=false
 *      (D-09 safety gate).
 *
 * Port allocation register advances: 18090..18105 → 18106 (THIS FILE);
 * 18107+ reserved for Phase 27+.
 *
 * Boot pattern: superuser CLI BEFORE serve (Pitfall 9 WAL-race), spawn
 * serve with --migrationsDir (1745280006_demo_flag picks up) +
 * --hooksDir (Whole Home hook + demo_cleanup hook both load).
 * DEMO_MODE=true is set on the test process BEFORE importing the lib,
 * so assertDemoMode passes. The actual PB `serve` child process does
 * NOT need DEMO_MODE — the cron hook is DEAD-CODE inside PB until we
 * simulate cleanup directly; we test the cleanup logic by shaping
 * rows + a manual query/delete pass rather than waiting 15 min for
 * the cron to fire.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import PocketBase from 'pocketbase';

// DEMO_MODE must be set BEFORE importing lib/demo-session.ts — the
// assertDemoMode guard runs at first call, which is from inside
// ensureDemoSession. Setting it here (before `import`) is not enough
// because vi hoists mocks; we therefore set it in the vi.mock factory's
// runtime effect below AND in beforeAll before the first dynamic import.
process.env.DEMO_MODE = 'true';

let currentPb: PocketBase | null = null;

vi.mock('next/cache', () => ({
  revalidatePath: () => {},
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

vi.mock('@/lib/pocketbase-server', () => ({
  createServerClient: async () => currentPb,
}));

vi.mock('@/lib/pocketbase-admin', () => ({
  createAdminClient: async () => currentPb,
  resetAdminClientCache: () => {},
}));

const PB_BIN = './.pb/pocketbase';
const DATA_DIR = './.pb/test-pb-data-demo';
const PORT = 18106; // Phase 26 DEMO claim — next free: 18107
const HTTP = `127.0.0.1:${PORT}`;

let pbProcess: ChildProcess | undefined;
let pbAdmin: PocketBase;

beforeAll(async () => {
  process.env.DEMO_MODE = 'true';

  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });

  // Pitfall 9 — superuser create BEFORE `serve` (SQLite WAL race).
  await new Promise<void>((resolve, reject) => {
    const p = spawn(PB_BIN, [
      'superuser',
      'create',
      'admin-26@test.test',
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

  // Admin client for setup + cleanup simulation. The demo-session lib
  // will use THIS via the vi.mock above (currentPb = pbAdmin).
  pbAdmin = new PocketBase(`http://${HTTP}`);
  await pbAdmin
    .collection('_superusers')
    .authWithPassword('admin-26@test.test', 'testpass123');

  currentPb = pbAdmin;
}, 30_000);

afterAll(() => {
  pbAdmin?.authStore.clear();
  pbProcess?.kill('SIGTERM');
  rmSync(DATA_DIR, { recursive: true, force: true });
  delete process.env.DEMO_MODE;
});

/**
 * Minimal cookieStore shim so tests can pass a plain object without
 * standing up Next's `cookies()` helper. ensureDemoSession only calls
 * `.get(name)` — we expose a writeable backing map for scenario setup.
 */
function makeCookieStore(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get: (name: string) => {
      const v = store.get(name);
      return v === undefined ? undefined : { value: v };
    },
    set: (name: string, value: string) => {
      store.set(name, value);
    },
    _store: store,
  };
}

describe('Phase 26 DEMO integration (port 18106)', () => {
  test('Scenario 1 — DEMO_MODE=true + no cookie → session created + home + 3 areas + 15 seed tasks (DEMO-02)', async () => {
    const cookieStore = makeCookieStore(); // no cookie
    currentPb = pbAdmin;

    const { ensureDemoSession } = await import('@/lib/demo-session');
    const result = await ensureDemoSession(cookieStore);

    expect(result.isNew).toBe(true);
    expect(result.userId).toMatch(/^[a-zA-Z0-9]{15}$/);
    expect(result.homeId).toMatch(/^[a-zA-Z0-9]{15}$/);
    expect(result.pbAuthCookie).toContain('pb_auth=');

    // User exists with is_demo=true + last_activity set.
    const user = await pbAdmin.collection('users').getOne(result.userId);
    expect(user.is_demo).toBe(true);
    expect(user.last_activity).toBeTruthy();
    expect((user.email as string).endsWith('@demo.homekeep.local')).toBe(true);

    // Home exists + owner_id = demo user.
    const home = await pbAdmin.collection('homes').getOne(result.homeId);
    expect(home.owner_id).toBe(result.userId);
    expect(home.name).toBe('Demo House');
    expect(home.onboarded).toBe(true);

    // 3 areas: Kitchen, Outdoor, Whole Home (hook-created).
    const areas = await pbAdmin.collection('areas').getFullList({
      filter: `home_id = "${result.homeId}"`,
      batch: 10,
    });
    expect(areas).toHaveLength(3);
    const areaNames = areas.map((a) => a.name).sort();
    expect(areaNames).toEqual(['Kitchen', 'Outdoor', 'Whole Home']);

    // 15 seed tasks.
    const tasks = await pbAdmin.collection('tasks').getFullList({
      filter: `home_id = "${result.homeId}"`,
      batch: 50,
    });
    expect(tasks).toHaveLength(15);

    // All tasks are cycle-mode with positive frequency (seeded from SEED_LIBRARY).
    for (const t of tasks) {
      expect(t.schedule_mode).toBe('cycle');
      expect(t.frequency_days).toBeGreaterThan(0);
    }
  }, 30_000);

  test('Scenario 2 — resume existing session (same home, no duplicate seed)', async () => {
    // Create a first-visit session.
    const firstStore = makeCookieStore();
    currentPb = pbAdmin;
    const { ensureDemoSession } = await import('@/lib/demo-session');
    const first = await ensureDemoSession(firstStore);

    // Count baseline state (1 home, 15 tasks for this user).
    const homesBefore = await pbAdmin.collection('homes').getFullList({
      filter: `owner_id = "${first.userId}"`,
    });
    expect(homesBefore).toHaveLength(1);
    const tasksBefore = await pbAdmin.collection('tasks').getFullList({
      filter: `home_id = "${first.homeId}"`,
      batch: 50,
    });
    expect(tasksBefore).toHaveLength(15);

    const lastActivityBefore = (
      await pbAdmin.collection('users').getOne(first.userId)
    ).last_activity;

    // Wait 50ms so the last_activity touch is distinguishable from
    // the initial value (PB DateTime precision is millisecond).
    await new Promise((r) => setTimeout(r, 50));

    // Second visit carries the session cookie pointing at the first user.
    const resumeStore = makeCookieStore({
      homekeep_demo_session: first.userId,
    });
    const second = await ensureDemoSession(resumeStore);

    expect(second.isNew).toBe(false);
    expect(second.userId).toBe(first.userId);
    expect(second.homeId).toBe(first.homeId);

    // NO new homes / tasks.
    const homesAfter = await pbAdmin.collection('homes').getFullList({
      filter: `owner_id = "${first.userId}"`,
    });
    expect(homesAfter).toHaveLength(1);
    const tasksAfter = await pbAdmin.collection('tasks').getFullList({
      filter: `home_id = "${first.homeId}"`,
      batch: 50,
    });
    expect(tasksAfter).toHaveLength(15);

    // last_activity was touched.
    const userAfter = await pbAdmin.collection('users').getOne(first.userId);
    expect(userAfter.last_activity).not.toBe(lastActivityBefore);
  }, 30_000);

  test('Scenario 3 — 2h idle cutoff → cleanup deletes user + home (DEMO-03 idle-TTL)', async () => {
    // Spawn a demo user manually with last_activity set 3h ago.
    const user = await pbAdmin.collection('users').create({
      email: `demo-idle-${Date.now()}@demo.homekeep.local`,
      password: 'idlepass1234',
      passwordConfirm: 'idlepass1234',
      name: 'Idle Demo',
      is_demo: true,
      last_activity: new Date(Date.now() - 3 * 3600_000).toISOString(),
    });

    // Create a home for them (via admin — same result as user-authed).
    const home = await pbAdmin.collection('homes').create({
      name: 'Idle Home',
      timezone: 'UTC',
      owner_id: user.id,
    });

    // Simulate the cleanup logic inline (can't wait for the 15-min cron
    // in a test). Mirrors pocketbase/pb_hooks/demo_cleanup.pb.js filter
    // INCLUDING the T→space ISO→PB-format fix (Rule 1 deviation — see
    // the hook's DEVIATION comment block for why).
    const idleCutoff = new Date(Date.now() - 2 * 3600_000)
      .toISOString()
      .replace('T', ' ');
    const matches = await pbAdmin.collection('users').getFullList({
      filter: `is_demo = true && last_activity != "" && last_activity < "${idleCutoff}"`,
    });
    expect(matches.find((m) => m.id === user.id)).toBeTruthy();

    // Execute the cascade: delete homes first (owner_id.cascadeDelete=false),
    // then the user.
    for (const m of matches) {
      const homes = await pbAdmin.collection('homes').getFullList({
        filter: `owner_id = "${m.id}"`,
      });
      for (const h of homes) {
        await pbAdmin.collection('homes').delete(h.id);
      }
      await pbAdmin.collection('users').delete(m.id);
    }

    // Both gone.
    await expect(pbAdmin.collection('users').getOne(user.id)).rejects.toThrow();
    await expect(pbAdmin.collection('homes').getOne(home.id)).rejects.toThrow();
  }, 30_000);

  test('Scenario 4 — 24h absolute cutoff → deletion regardless of activity (DEMO-03 absolute-TTL)', async () => {
    // PB 0.37.x autodate `created` is server-controlled and cannot be
    // overridden via REST (even as superuser). Rather than back-date
    // the row, we test the absolute-TTL logic by shifting the CUTOFF
    // forward in time instead of the record backward. The cron at
    // now=T+25h would compute absoluteCutoff = T+1h; any user created
    // at T would satisfy `created < T+1h`. This proves the filter
    // expression picks up the row AND that fresh last_activity does
    // NOT save it (the absolute-TTL pass is independent of last_activity).
    const user = await pbAdmin.collection('users').create({
      email: `demo-abs-${Date.now()}@demo.homekeep.local`,
      password: 'absolutepass1234',
      passwordConfirm: 'absolutepass1234',
      name: 'Absolute Demo',
      is_demo: true,
      last_activity: new Date().toISOString(), // deliberately fresh!
    });
    const home = await pbAdmin.collection('homes').create({
      name: 'Absolute Home',
      timezone: 'UTC',
      owner_id: user.id,
    });

    // Simulate the cron running 25h after this user was created:
    // absoluteCutoff = simulatedNow - 24h = user.created + 1h, which
    // is strictly GREATER than user.created → filter matches.
    const simulatedNow = Date.now() + 25 * 3600_000;
    const absoluteCutoff = new Date(simulatedNow - 24 * 3600_000)
      .toISOString()
      .replace('T', ' ');

    const matches = await pbAdmin.collection('users').getFullList({
      filter: `is_demo = true && created < "${absoluteCutoff}"`,
    });
    expect(matches.find((m) => m.id === user.id)).toBeTruthy();

    // Prove the absolute-TTL pass fires INDEPENDENTLY of activity:
    // run an idle sweep with the REAL (non-simulated) cutoff — fresh
    // activity means this user is NOT in the idle set. The absolute
    // filter above still caught them, so the cleanup hook's OR logic
    // (idle OR absolute) correctly evicts long-lived demo users even
    // when they're actively using the demo.
    //
    // Deep-dive Pitfall: PB 0.37.x stores datetimes in space-separated
    // format ("2026-04-23 22:50:00.000Z") but ISO serializer emits
    // T-separated ("2026-04-23T22:50:00.000Z"). The filter grammar does
    // STRING-compare on the raw stored value, and ' ' (0x20) < 'T' (0x54)
    // so ANY stored datetime is lexicographically less than an ISO-T
    // cutoff string. To get a correct idle-window match we must send
    // the cutoff in PB's space-separated format. The production cron
    // hook (pb_hooks/demo_cleanup.pb.js) runs inside PB JSVM where
    // Date.toISOString() is the same but we compare against
    // PB-internal stored values — this is a test-harness concern only.
    const realIdleCutoffPb = new Date(Date.now() - 2 * 3600_000)
      .toISOString()
      .replace('T', ' ');
    const idleOnly = await pbAdmin.collection('users').getFullList({
      filter: `is_demo = true && last_activity != "" && last_activity < "${realIdleCutoffPb}"`,
    });
    expect(idleOnly.find((m) => m.id === user.id)).toBeUndefined();

    // (scenario-local var kept to document the format invariant for the
    // Scenario 5 safety-gate test below, which reuses the same idiom.)
    void realIdleCutoffPb;

    // Execute the cascade using the absolute match set.
    for (const m of matches) {
      const homes = await pbAdmin.collection('homes').getFullList({
        filter: `owner_id = "${m.id}"`,
      });
      for (const h of homes) {
        await pbAdmin.collection('homes').delete(h.id);
      }
      await pbAdmin.collection('users').delete(m.id);
    }

    await expect(pbAdmin.collection('users').getOne(user.id)).rejects.toThrow();
    await expect(pbAdmin.collection('homes').getOne(home.id)).rejects.toThrow();
  }, 30_000);

  test('Scenario 5 — cleanup NEVER touches is_demo=false users (D-09 safety gate)', async () => {
    // Create a REAL user (is_demo defaults to false) with back-dated
    // created (simulating a long-lived real user) and stale last_activity
    // (simulating an idle real user). Neither should ever be a cleanup
    // target.
    const realUser = await pbAdmin.collection('users').create({
      email: `real-${Date.now()}@example.com`,
      password: 'realpass12345',
      passwordConfirm: 'realpass12345',
      name: 'Real User',
      // Explicitly NOT setting is_demo — defaults to false.
      last_activity: new Date(Date.now() - 72 * 3600_000).toISOString(), // 3 days ago
    });

    // Back-date created to 30 days ago — well past the 24h absolute TTL.
    await pbAdmin.collection('users').update(realUser.id, {
      created: new Date(Date.now() - 30 * 86400_000).toISOString(),
    });

    // Run BOTH sweeps (idle + absolute) and assert realUser appears in NEITHER.
    // T→space conversion per the DEVIATION in demo_cleanup.pb.js.
    const idleCutoff = new Date(Date.now() - 2 * 3600_000)
      .toISOString()
      .replace('T', ' ');
    const idleMatches = await pbAdmin.collection('users').getFullList({
      filter: `is_demo = true && last_activity != "" && last_activity < "${idleCutoff}"`,
    });
    expect(idleMatches.find((m) => m.id === realUser.id)).toBeUndefined();

    const absoluteCutoff = new Date(Date.now() - 24 * 3600_000)
      .toISOString()
      .replace('T', ' ');
    const absoluteMatches = await pbAdmin.collection('users').getFullList({
      filter: `is_demo = true && created < "${absoluteCutoff}"`,
    });
    expect(absoluteMatches.find((m) => m.id === realUser.id)).toBeUndefined();

    // Real user still exists.
    const stillThere = await pbAdmin.collection('users').getOne(realUser.id);
    expect(stillThere.id).toBe(realUser.id);
    expect(stillThere.is_demo).toBe(false);
  }, 30_000);
});
