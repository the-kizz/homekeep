// @vitest-environment node
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * completeTaskAction must restart a cycle task's schedule from the
 * completion being recorded now. A task done late (or on time) must come
 * out of the action with next_due_smoothed roughly one frequency after
 * now, never anchored to the completion before it.
 *
 * placeNextDue / computeHouseholdLoad run for real; only PocketBase and
 * side-effect modules are mocked.
 */

type BatchOp = { collection: string; op: string; id?: string; body: unknown };

const NOW = new Date('2026-10-08T03:00:00.000Z');
const PRIOR = '2026-10-02T03:00:00.000Z';

let batchOps: BatchOp[] = [];
let taskRecord: Record<string, unknown>;
let priorCompletion: { id: string; completed_at: string } | null;

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/membership', () => ({ assertMembership: async () => undefined }));
vi.mock('@/lib/pocketbase-admin', () => ({ createAdminClient: async () => ({}) }));
vi.mock('@/lib/scheduler', () => ({
  sendPartnerCompletedNotifications: async () => undefined,
}));
vi.mock('@/lib/completions', () => ({
  getCompletionsForHome: async () =>
    priorCompletion
      ? [
          {
            id: priorCompletion.id,
            task_id: 'task-1',
            completed_by_id: 'user-1',
            completed_at: priorCompletion.completed_at,
            notes: '',
            via: 'tap',
          },
        ]
      : [],
  reduceLatestByTask: (rows: Array<{ task_id: string }>) =>
    new Map(rows.map((r) => [r.task_id, r])),
}));
vi.mock('@/lib/schedule-overrides', () => ({
  getActiveOverride: async () => null,
  getActiveOverridesForHome: async () => new Map(),
}));

vi.mock('@/lib/pocketbase-server', () => ({
  createServerClient: async () => ({
    authStore: { isValid: true, record: { id: 'user-1' } },
    filter: (expr: string, params: Record<string, string>) =>
      expr.replace(/\{:(\w+)\}/g, (_, k) => `"${params[k]}"`),
    collection: (name: string) => ({
      getOne: async (id: string) => {
        if (name === 'tasks') return taskRecord;
        if (name === 'homes') return { id, timezone: 'Australia/Perth' };
        if (name === 'areas') return { id, name: 'Kitchen' };
        throw new Error(`unexpected getOne ${name}`);
      },
      getFirstListItem: async () => {
        if (name === 'completions' && priorCompletion) return priorCompletion;
        throw new Error('404');
      },
      getFullList: async () => (name === 'tasks' ? [taskRecord] : []),
    }),
    createBatch: () => {
      const ops: BatchOp[] = batchOps;
      return {
        collection: (collection: string) => ({
          create: (body: unknown) => ops.push({ collection, op: 'create', body }),
          update: (id: string, body: unknown) =>
            ops.push({ collection, op: 'update', id, body }),
        }),
        send: async () =>
          ops.map((o) => ({
            status: 200,
            body:
              o.op === 'create'
                ? { id: 'comp-new', task_id: 'task-1', ...(o.body as object) }
                : o.body,
          })),
      };
    },
  }),
}));

const DAY = 86_400_000;

function smoothedUpdate(): string {
  const op = batchOps.find(
    (o) => o.collection === 'tasks' && o.op === 'update' && o.id === 'task-1',
  );
  expect(op, 'tasks.update for next_due_smoothed').toBeDefined();
  return (op!.body as { next_due_smoothed: string }).next_due_smoothed;
}

describe('completeTaskAction — next due restarts from this completion', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    batchOps = [];
    priorCompletion = { id: 'comp-prior', completed_at: PRIOR };
    taskRecord = {
      id: 'task-1',
      home_id: 'home-1',
      area_id: 'area-1',
      name: 'Wipe benches',
      frequency_days: 3,
      schedule_mode: 'cycle',
      anchor_date: '',
      archived: false,
      created: '2026-09-01T00:00:00.000Z',
      due_date: '',
      active_from_month: null,
      active_to_month: null,
      preferred_days: 'any',
      next_due_smoothed: '2026-10-05T03:00:00.000Z',
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('late completion of an every-3-days task lands about 3 days after now', async () => {
    const { completeTaskAction } = await import('@/lib/actions/completions');
    const res = await completeTaskAction('task-1');
    expect(res).toMatchObject({ ok: true });

    const placed = new Date(smoothedUpdate()).getTime();
    const freq = 3;
    const tolerance = Math.min(Math.floor(0.15 * freq), 5);
    expect(placed).toBeGreaterThan(NOW.getTime());
    expect(placed).toBeGreaterThanOrEqual(NOW.getTime() + (freq - tolerance) * DAY);
    expect(placed).toBeLessThanOrEqual(NOW.getTime() + (freq + tolerance) * DAY);
  });

  test('a 30-day task completed late is placed within tolerance of now + 30', async () => {
    taskRecord.frequency_days = 30;
    priorCompletion = { id: 'comp-prior', completed_at: '2026-08-01T03:00:00.000Z' };
    const { completeTaskAction } = await import('@/lib/actions/completions');
    const res = await completeTaskAction('task-1');
    expect(res).toMatchObject({ ok: true });

    const placed = new Date(smoothedUpdate()).getTime();
    const tolerance = Math.min(Math.floor(0.15 * 30), 5);
    expect(placed).toBeGreaterThan(NOW.getTime());
    expect(placed).toBeGreaterThanOrEqual(NOW.getTime() + (30 - tolerance) * DAY);
    expect(placed).toBeLessThanOrEqual(NOW.getTime() + (30 + tolerance) * DAY);
  });

  test('first-ever completion also places from now', async () => {
    priorCompletion = null;
    taskRecord.frequency_days = 7;
    taskRecord.created = '2026-09-01T00:00:00.000Z';
    const { completeTaskAction } = await import('@/lib/actions/completions');
    const res = await completeTaskAction('task-1');
    expect(res).toMatchObject({ ok: true });

    const placed = new Date(smoothedUpdate()).getTime();
    expect(placed).toBeGreaterThanOrEqual(NOW.getTime() + 6 * DAY);
  });
});
