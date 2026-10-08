// @vitest-environment node
/**
 * Onboarding seeds → real areas, against a live PocketBase on port 18112.
 *
 * Checks the end-to-end contract the By Area view depends on: suggested
 * areas are created once (and reused on a second run), tasks point at them,
 * seasonal months follow the home's hemisphere, and the home is flagged
 * onboarded. Bootstrap mirrors tcsem-integration.test.ts (superuser created
 * before `serve` to avoid the SQLite WAL race).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import PocketBase from 'pocketbase';

let currentPb: PocketBase | null = null;

vi.mock('next/cache', () => ({
  revalidatePath: () => {},
}));

vi.mock('@/lib/pocketbase-server', () => ({
  createServerClient: async () => currentPb,
}));

const PB_BIN = './.pb/pocketbase';
const DATA_DIR = './.pb/test-pb-data-seed-areas';
const PORT = 18112;
const HTTP = `127.0.0.1:${PORT}`;

let pbProcess: ChildProcess | undefined;
let pbAdmin: PocketBase;
let pbAlice: PocketBase;
let homeId: string;
let wholeHomeAreaId: string;

beforeAll(async () => {
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const p = spawn(PB_BIN, [
      'superuser',
      'create',
      'admin-seedareas@test.test',
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

  pbAdmin = new PocketBase(`http://${HTTP}`);
  await pbAdmin
    .collection('_superusers')
    .authWithPassword('admin-seedareas@test.test', 'testpass123');

  const alice = await pbAdmin.collection('users').create({
    email: 'alice-seedareas@test.com',
    password: 'alice123456',
    passwordConfirm: 'alice123456',
    name: 'Alice',
  });

  pbAlice = new PocketBase(`http://${HTTP}`);
  await pbAlice
    .collection('users')
    .authWithPassword('alice-seedareas@test.com', 'alice123456');

  const home = await pbAlice.collection('homes').create({
    name: 'Perth Home',
    timezone: 'Australia/Perth',
    owner_id: alice.id,
  });
  homeId = home.id;

  const areas = await pbAlice.collection('areas').getFullList({
    filter: pbAlice.filter('home_id = {:hid}', { hid: homeId }),
  });
  const wholeHome = areas.find((a) => a.is_whole_home_system === true);
  if (!wholeHome) throw new Error('Whole Home area was not auto-created');
  wholeHomeAreaId = wholeHome.id;

  currentPb = pbAlice;
}, 30_000);

afterAll(() => {
  pbAlice?.authStore.clear();
  pbAdmin?.authStore.clear();
  pbProcess?.kill('SIGTERM');
  rmSync(DATA_DIR, { recursive: true, force: true });
});

async function areasByName() {
  const rows = await pbAlice.collection('areas').getFullList({
    filter: pbAlice.filter('home_id = {:hid}', { hid: homeId }),
  });
  return new Map(rows.map((a) => [a.name as string, a]));
}

async function tasksByName() {
  const rows = await pbAlice.collection('tasks').getFullList({
    filter: pbAlice.filter('home_id = {:hid}', { hid: homeId }),
  });
  return new Map(rows.map((t) => [t.name as string, t]));
}

describe('onboarding seeds create real areas (port 18112)', () => {
  test('first run: creates Kitchen, Bathroom, Yard; tasks use them; seasons are southern', async () => {
    const { batchCreateSeedTasks } = await import('@/lib/actions/seed');
    const result = await batchCreateSeedTasks({
      home_id: homeId,
      selections: [
        { seed_id: 'seed-wipe-benches', area: { kind: 'suggested', key: 'kitchen' } },
        { seed_id: 'seed-clean-toilet', area: { kind: 'suggested', key: 'bathroom' } },
        { seed_id: 'seed-mow-lawn-warm', area: { kind: 'suggested', key: 'yard' } },
        { seed_id: 'seed-mow-lawn-cool', area: { kind: 'suggested', key: 'yard' } },
        { seed_id: 'seed-service-heater', area: { kind: 'suggested', key: 'whole_home' } },
        { seed_id: 'seed-test-rcd', area: { kind: 'existing', id: wholeHomeAreaId } },
      ],
    });
    expect(result).toEqual({ ok: true, count: 6, areasCreated: 3 });

    const areas = await areasByName();
    expect(areas.has('Kitchen')).toBe(true);
    expect(areas.has('Bathroom')).toBe(true);
    expect(areas.has('Yard')).toBe(true);
    expect(areas.has('Living areas')).toBe(false);
    for (const name of ['Kitchen', 'Bathroom', 'Yard']) {
      const a = areas.get(name)!;
      expect(a.scope).toBe('location');
      expect(a.is_whole_home_system).toBe(false);
      expect(Number(a.sort_order)).toBeGreaterThan(0);
    }

    const tasks = await tasksByName();
    expect(tasks.size).toBe(6);
    expect(tasks.get('Wipe kitchen benches')?.area_id).toBe(areas.get('Kitchen')!.id);
    expect(tasks.get('Clean toilet')?.area_id).toBe(areas.get('Bathroom')!.id);
    expect(tasks.get('Mow lawn (warm season)')?.area_id).toBe(areas.get('Yard')!.id);
    expect(tasks.get('Service heater')?.area_id).toBe(wholeHomeAreaId);
    expect(tasks.get('Test RCD safety switch')?.area_id).toBe(wholeHomeAreaId);

    const warm = tasks.get('Mow lawn (warm season)')!;
    expect([warm.active_from_month, warm.active_to_month]).toEqual([10, 3]);
    const cool = tasks.get('Mow lawn (cool season)')!;
    expect([cool.active_from_month, cool.active_to_month]).toEqual([4, 9]);
    const heater = tasks.get('Service heater')!;
    expect([heater.active_from_month, heater.active_to_month]).toEqual([4, 9]);

    const home = await pbAlice.collection('homes').getOne(homeId);
    expect(home.onboarded).toBe(true);
  }, 30_000);

  test('second run: reuses Kitchen instead of creating another', async () => {
    const { batchCreateSeedTasks } = await import('@/lib/actions/seed');
    const result = await batchCreateSeedTasks({
      home_id: homeId,
      selections: [
        { seed_id: 'seed-clean-sink', area: { kind: 'suggested', key: 'kitchen' } },
        { seed_id: 'seed-clean-oven', area: { kind: 'suggested', key: 'kitchen' } },
      ],
    });
    expect(result).toEqual({ ok: true, count: 2, areasCreated: 0 });

    const rows = await pbAlice.collection('areas').getFullList({
      filter: pbAlice.filter('home_id = {:hid} && name = {:n}', {
        hid: homeId,
        n: 'Kitchen',
      }),
    });
    expect(rows).toHaveLength(1);
    const tasks = await tasksByName();
    expect(tasks.get('Clean kitchen sink')?.area_id).toBe(rows[0].id);
    expect(tasks.get('Clean oven')?.area_id).toBe(rows[0].id);
  }, 30_000);
});
