// @vitest-environment node
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import PocketBase from 'pocketbase';

/**
 * The overdue pass must judge "overdue" exactly as the dashboard does:
 * with every scheduling field (smoothed date, seasonal window, one-off
 * date) and the home's timezone. A narrow field projection used to drop
 * those, so tasks the UI showed as not-yet-due got pushed as overdue.
 *
 * Port 18111. (18107 and 18108 are already used by hooks-rate-limits and
 * invite-rate-limit; 18109 is left free; 18110 is last-viewed-home-idor.)
 */

const PB_BIN = './.pb/pocketbase';
const DATA_DIR = './.pb/test-pb-data-scheduler-projection';
const HTTP = '127.0.0.1:18111';
const ADMIN_EMAIL = 'test@test.com';
const ADMIN_PASS = 'testpass123';
const DAY = 86_400_000;

// Fixed November instant: the Apr–Sep seasonal task is dormant.
const NOW = new Date('2026-11-16T04:00:00.000Z');

let pbProcess: ChildProcess | undefined;
let adminClient: PocketBase;

vi.mock('@/lib/pocketbase-admin', () => ({
  createAdminClient: async () => adminClient,
  resetAdminClientCache: () => {},
}));

const sendNtfy = vi.fn(async () => ({ ok: true as const }));
vi.mock('@/lib/ntfy', () => ({ sendNtfy }));

beforeAll(async () => {
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });

  // Superuser before serve to avoid the SQLite WAL race.
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
}, 30_000);

afterAll(() => {
  pbProcess?.kill('SIGTERM');
  rmSync(DATA_DIR, { recursive: true, force: true });
});

describe.sequential('scheduler overdue pass uses the full task projection (port 18111)', () => {
  let userId: string;
  let homeId: string;
  let areaId: string;
  let userClient: PocketBase;

  async function createTask(fields: Record<string, unknown>) {
    return userClient.collection('tasks').create({
      home_id: homeId,
      area_id: areaId,
      description: '',
      schedule_mode: 'cycle',
      anchor_date: '',
      icon: '',
      color: '',
      assigned_to_id: '',
      notes: '',
      archived: false,
      ...fields,
    });
  }

  async function complete(taskId: string, daysAgo: number) {
    await adminClient.collection('completions').create({
      task_id: taskId,
      completed_by_id: userId,
      completed_at: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
      via: 'manual-date',
      notes: '',
    });
  }

  async function overdueRows(taskId: string) {
    return adminClient.collection('notifications').getFullList({
      filter: adminClient.filter('task_id = {:tid} && kind = "overdue"', {
        tid: taskId,
      }),
    });
  }

  test('setup: Perth home with an opted-in member', async () => {
    const user = await adminClient.collection('users').create({
      email: 'perth@test.com',
      password: 'perth1234567',
      passwordConfirm: 'perth1234567',
      name: 'Pat',
      ntfy_topic: 'perth-test-abc123',
      notify_overdue: true,
      notify_assigned: false,
      notify_partner_completed: false,
      notify_weekly_summary: false,
      weekly_summary_day: 'sunday',
    });
    userId = user.id;

    userClient = new PocketBase(`http://${HTTP}`);
    await userClient
      .collection('users')
      .authWithPassword('perth@test.com', 'perth1234567');
    const home = await userClient.collection('homes').create({
      name: 'Perth Home',
      timezone: 'Australia/Perth',
      owner_id: userId,
    });
    homeId = home.id;
    const area = await adminClient
      .collection('areas')
      .getFirstListItem(adminClient.filter('home_id = {:hid}', { hid: homeId }));
    areaId = area.id;
  }, 30_000);

  test('smoothed-to-tomorrow and dormant seasonal tasks are not pushed', async () => {
    // (a) natural due was 3 days ago, but smoothing moved it to tomorrow.
    const smoothed = await createTask({
      name: 'Water plants',
      frequency_days: 7,
      next_due_smoothed: new Date(NOW.getTime() + DAY).toISOString(),
    });
    await complete(smoothed.id, 10);

    // (b) Apr–Sep window, never done; in November it sleeps until April.
    const seasonal = await createTask({
      name: 'Mow lawn',
      frequency_days: 14,
      active_from_month: 4,
      active_to_month: 9,
    });

    sendNtfy.mockClear();
    const { processOverdueNotifications } = await import('@/lib/scheduler');
    await processOverdueNotifications(NOW);

    expect(await overdueRows(smoothed.id)).toHaveLength(0);
    expect(await overdueRows(seasonal.id)).toHaveLength(0);
    expect(sendNtfy).not.toHaveBeenCalled();
  }, 30_000);

  test('a genuinely overdue task is pushed exactly once', async () => {
    // (c) due 2 days ago, nothing smoothed.
    const overdue = await createTask({ name: 'Empty bins', frequency_days: 3 });
    await complete(overdue.id, 5);

    sendNtfy.mockClear();
    const { processOverdueNotifications } = await import('@/lib/scheduler');
    expect(await processOverdueNotifications(NOW)).toBe(1);
    expect(await overdueRows(overdue.id)).toHaveLength(1);
    expect(sendNtfy).toHaveBeenCalledTimes(1);

    expect(await processOverdueNotifications(NOW)).toBe(0);
    expect(await overdueRows(overdue.id)).toHaveLength(1);
    expect(sendNtfy).toHaveBeenCalledTimes(1);
  }, 30_000);
});
