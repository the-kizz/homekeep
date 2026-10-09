// @vitest-environment node
import {
  describe,
  test,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';

/**
 * Phase 17 Plan 17-01 Task 2 — rebalancePreviewAction + rebalanceApplyAction
 * unit tests. Mirrors the Phase 15 scaffold (reschedule-actions.test.ts) +
 * Phase 13 batch-op recording pattern (seed-tcsem.test.ts).
 *
 * Coverage:
 *
 * Preview (5 tests):
 *   P1 counts correct for mixed home
 *   P2 empty home → all zeros
 *   P3 all excluded → all zeros
 *   P4 membership rejection → {ok:false, formError}
 *   P5 not signed in → {ok:false, formError}
 *
 * Apply (8 tests):
 *   A1 ascending-ideal order of rebalanceable batch ops
 *   A2 load-map threading (REBAL-07) via REAL placeNextDue — placements
 *      distribute across >= N-1 distinct isoDateKeys
 *   A3 single rebalanceable task → one tasks.update with next_due_smoothed
 *   A4 preservation: anchored/override/marker never appear in
 *      next_due_smoothed update ops
 *   A5 marker-clear (D-06 revision): from_now_on bucket tasks appear
 *      exactly once with {reschedule_marker: null}
 *   A6 single atomic batch.send
 *   A7 idempotency (D-12): second apply's ISO values match first apply's
 *   A8 membership gate → zero batch.send
 */

// ─── Module-level mock refs ──────────────────────────────────────────────
const mockAssertMembership = vi.fn().mockResolvedValue({ role: 'member' });
const mockGetFullList = vi.fn();
const mockGetOne = vi.fn();
const mockRevalidatePath = vi.fn();
const mockGetActiveOverridesForHome = vi.fn();
const mockGetCompletionsForHome = vi.fn();
const mockReduceLatestByTask = vi.fn();
const mockPlaceNextDue = vi.fn();
const mockComputeHouseholdLoad = vi.fn();

type BatchOp = { collection: string; method: string; args: unknown[] };
let batchOps: BatchOp[] = [];
const mockBatchSend = vi.fn().mockResolvedValue([]);
const mockBatch = {
  collection: (name: string) => ({
    create: (...args: unknown[]) => {
      batchOps.push({ collection: name, method: 'create', args });
    },
    update: (...args: unknown[]) => {
      batchOps.push({ collection: name, method: 'update', args });
    },
  }),
  send: mockBatchSend,
};

let authValid = true;
let authUserId: string | null = 'user1234567890a';

vi.mock('@/lib/membership', () => ({
  assertMembership: (...args: unknown[]) => mockAssertMembership(...args),
}));

vi.mock('@/lib/pocketbase-server', () => ({
  createServerClient: async () => ({
    get authStore() {
      return {
        isValid: authValid,
        record: authUserId ? { id: authUserId } : null,
      };
    },
    filter: (expr: string, params: Record<string, string>) =>
      expr.replace(/\{:(\w+)\}/g, (_, k) => `"${params[k]}"`),
    collection: (name: string) => ({
      getOne: (...args: unknown[]) => mockGetOne(name, ...args),
      getFullList: (...args: unknown[]) => mockGetFullList(name, ...args),
    }),
    createBatch: () => mockBatch,
  }),
}));

vi.mock('@/lib/schedule-overrides', () => ({
  getActiveOverridesForHome: (...args: unknown[]) =>
    mockGetActiveOverridesForHome(...args),
}));

vi.mock('@/lib/completions', () => ({
  getCompletionsForHome: (...args: unknown[]) =>
    mockGetCompletionsForHome(...args),
  reduceLatestByTask: (...args: unknown[]) => mockReduceLatestByTask(...args),
}));

vi.mock('@/lib/load-smoothing', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/load-smoothing')
  >('@/lib/load-smoothing');
  return {
    ...actual,
    placeNextDue: (...args: unknown[]) => mockPlaceNextDue(...args),
    computeHouseholdLoad: (...args: unknown[]) =>
      mockComputeHouseholdLoad(...args),
    // Keep real isoDateKey so threading-map integration uses same format.
  };
});

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

async function loadActions() {
  return await import('@/lib/actions/rebalance');
}

const HOME_ID = 'home1234567890a'; // 15 chars

type Task = {
  id: string;
  created: string;
  archived: boolean;
  frequency_days: number | null;
  schedule_mode: 'cycle' | 'anchored';
  anchor_date: string | null;
  preferred_days?: 'any' | 'weekend' | 'weekday' | null;
  active_from_month?: number | null;
  active_to_month?: number | null;
  due_date?: string | null;
  next_due_smoothed?: string | null;
  reschedule_marker?: string | null;
};

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task0000000001',
    created: '2026-01-01T00:00:00.000Z',
    archived: false,
    frequency_days: 30,
    schedule_mode: 'cycle',
    anchor_date: null,
    preferred_days: null,
    active_from_month: null,
    active_to_month: null,
    due_date: null,
    next_due_smoothed: null,
    reschedule_marker: null,
    ...overrides,
  };
}

type Override = {
  id: string;
  task_id: string;
  snooze_until: string;
  consumed_at: string | null;
  created_by_id: string | null;
  created: string;
};

function makeOverride(taskId: string): Override {
  return {
    id: `ovr-${taskId.slice(0, 10)}`,
    task_id: taskId,
    snooze_until: '2026-07-01T00:00:00.000Z',
    consumed_at: null,
    created_by_id: 'user1234567890a',
    created: '2026-06-10T00:00:00.000Z',
  };
}

// Deterministic mock placeNextDue — echoes baseIso + freq.
// This makes A1 ordering + A7 idempotency testable with stable ISOs.
// The real placeNextDue also takes (load, now); this echo ignores them.
function deterministicPlaceNextDue(
  task: Task,
  lastCompletion: { completed_at: string } | null,
): Date {
  const freq = task.frequency_days as number;
  const baseIso = lastCompletion?.completed_at ?? task.created;
  const base = new Date(baseIso);
  // Echo baseIso + freq days — matches natural ideal for rebalance
  // since apply doesn't strip next_due_smoothed when calling placeNextDue
  // (it passes the original task; placeNextDue derives baseIso from
  // lastCompletion ?? task.created).
  return new Date(base.getTime() + freq * 86400000);
}

describe('Phase 17 rebalance server actions (Plan 17-01 Task 2)', () => {
  beforeEach(() => {
    batchOps = [];
    mockAssertMembership.mockReset().mockResolvedValue({ role: 'member' });
    mockGetFullList.mockReset();
    mockGetOne.mockReset();
    mockRevalidatePath.mockReset();
    mockGetActiveOverridesForHome.mockReset().mockResolvedValue(new Map());
    mockGetCompletionsForHome.mockReset().mockResolvedValue([]);
    mockReduceLatestByTask.mockReset().mockReturnValue(new Map());
    mockPlaceNextDue.mockReset().mockImplementation(deterministicPlaceNextDue);
    mockComputeHouseholdLoad.mockReset().mockReturnValue(new Map());
    mockBatchSend.mockReset().mockResolvedValue([]);
    authValid = true;
    authUserId = 'user1234567890a';

    // Default: homes.getOne returns UTC timezone.
    mockGetOne.mockImplementation(async (name: string, id: string) => {
      if (name === 'homes') return { id, timezone: 'UTC' };
      return { id };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Preview tests ─────────────────────────────────────────────

  describe('rebalancePreviewAction', () => {
    test('P1: mixed home — counts match bucket sizes', async () => {
      const { rebalancePreviewAction } = await loadActions();

      const anchored = [
        makeTask({ id: 'anch00000000001', schedule_mode: 'anchored', anchor_date: '2026-08-01T00:00:00.000Z' }),
        makeTask({ id: 'anch00000000002', schedule_mode: 'anchored', anchor_date: '2026-09-01T00:00:00.000Z' }),
        makeTask({ id: 'anch00000000003', schedule_mode: 'anchored', anchor_date: '2026-10-01T00:00:00.000Z' }),
      ];
      const ovrTasks = [
        makeTask({ id: 'ovrt00000000001' }),
        makeTask({ id: 'ovrt00000000002' }),
      ];
      const markerTasks = [
        makeTask({ id: 'mark00000000001', reschedule_marker: '2026-06-01T00:00:00.000Z' }),
        makeTask({ id: 'mark00000000002', reschedule_marker: '2026-06-01T00:00:00.000Z' }),
      ];
      const rebalTasks = [
        makeTask({ id: 'reba00000000001' }),
        makeTask({ id: 'reba00000000002' }),
        makeTask({ id: 'reba00000000003' }),
        makeTask({ id: 'reba00000000004' }),
        makeTask({ id: 'reba00000000005' }),
      ];
      // Not in home task list: archived and OOFT would be filtered by
      // PB filter (archived=false) or excluded by classifier.
      const ooft = [makeTask({ id: 'ooft00000000001', frequency_days: null })];

      const all = [...anchored, ...ovrTasks, ...markerTasks, ...rebalTasks, ...ooft];

      mockGetFullList.mockImplementation(async (name: string) => {
        if (name === 'tasks') return all;
        return [];
      });
      mockGetActiveOverridesForHome.mockResolvedValue(
        new Map<string, Override>(
          ovrTasks.map((t) => [t.id, makeOverride(t.id)]),
        ),
      );

      const result = await rebalancePreviewAction(HOME_ID);

      expect(result).toEqual({
        ok: true,
        preview: {
          update_count: 5,
          preserve_anchored: 3,
          preserve_override: 2,
          preserve_from_now_on: 2,
          preserve_total: 7,
        },
      });

      // No batch send on preview.
      expect(mockBatchSend).not.toHaveBeenCalled();
    });

    test('P2: empty home → all zeros', async () => {
      const { rebalancePreviewAction } = await loadActions();
      mockGetFullList.mockImplementation(async () => []);

      const result = await rebalancePreviewAction(HOME_ID);

      expect(result).toEqual({
        ok: true,
        preview: {
          update_count: 0,
          preserve_anchored: 0,
          preserve_override: 0,
          preserve_from_now_on: 0,
          preserve_total: 0,
        },
      });
    });

    test('P3: all tasks excluded (OOFT) → all zeros', async () => {
      const { rebalancePreviewAction } = await loadActions();
      mockGetFullList.mockImplementation(async (name: string) => {
        if (name === 'tasks') {
          return [
            makeTask({ id: 'ooft00000000001', frequency_days: null }),
            makeTask({ id: 'ooft00000000002', frequency_days: 0 }),
          ];
        }
        return [];
      });

      const result = await rebalancePreviewAction(HOME_ID);
      expect(result).toEqual({
        ok: true,
        preview: {
          update_count: 0,
          preserve_anchored: 0,
          preserve_override: 0,
          preserve_from_now_on: 0,
          preserve_total: 0,
        },
      });
    });

    test('P4: membership rejection → {ok:false, formError}', async () => {
      const { rebalancePreviewAction } = await loadActions();
      mockAssertMembership.mockRejectedValueOnce(new Error('Not member'));

      const result = await rebalancePreviewAction(HOME_ID);

      expect(result).toEqual({
        ok: false,
        formError: 'You are not a member of this home',
      });
      // Classifier / fetches should NOT have been called.
      expect(mockGetFullList).not.toHaveBeenCalled();
    });

    test('P5: not signed in → {ok:false, formError:"Not signed in"}', async () => {
      const { rebalancePreviewAction } = await loadActions();
      authValid = false;

      const result = await rebalancePreviewAction(HOME_ID);
      expect(result).toEqual({ ok: false, formError: 'Not signed in' });
      expect(mockAssertMembership).not.toHaveBeenCalled();
    });
  });

  // ─── Apply tests (mocked placeNextDue — deterministic) ─────────

  describe('rebalanceApplyAction', () => {
    test('A1: rebalanceable batch ops processed in ascending natural-ideal order', async () => {
      const { rebalanceApplyAction } = await loadActions();

      // Three rebalanceable tasks with naturalIdeal = created + freq.
      // t1.created = 2026-04-20 - 30d, freq=30  → natural = 2026-04-20
      // t2.created = 2026-05-10 - 30d, freq=30  → natural = 2026-05-10
      // t3.created = 2026-06-01 - 30d, freq=30  → natural = 2026-06-01
      //
      // Input order scrambled: t2, t3, t1. Expected batch order after
      // ascending sort: t1 (Apr 20), t2 (May 10), t3 (Jun 1).
      const t1 = makeTask({
        id: 'task00000000001',
        created: '2026-03-21T00:00:00.000Z', // +30d = 2026-04-20
      });
      const t2 = makeTask({
        id: 'task00000000002',
        created: '2026-04-10T00:00:00.000Z', // +30d = 2026-05-10
      });
      const t3 = makeTask({
        id: 'task00000000003',
        created: '2026-05-02T00:00:00.000Z', // +30d = 2026-06-01
      });

      mockGetFullList.mockImplementation(async (name: string) => {
        if (name === 'tasks') return [t2, t3, t1]; // scrambled
        return [];
      });

      const result = await rebalanceApplyAction(HOME_ID);
      expect(result).toEqual({ ok: true, updated: 3 });

      const updateOps = batchOps.filter(
        (o) =>
          o.collection === 'tasks' &&
          o.method === 'update' &&
          (o.args[1] as Record<string, unknown>).next_due_smoothed !== undefined,
      );
      expect(updateOps).toHaveLength(3);

      // Ascending by natural ideal → t1, t2, t3.
      expect(updateOps[0].args[0]).toBe(t1.id);
      expect(updateOps[1].args[0]).toBe(t2.id);
      expect(updateOps[2].args[0]).toBe(t3.id);
    });

    test('A3: single rebalanceable task → one tasks.update with next_due_smoothed', async () => {
      const { rebalanceApplyAction } = await loadActions();
      const task = makeTask({ id: 'solo00000000001' });
      mockGetFullList.mockImplementation(async (name: string) => {
        if (name === 'tasks') return [task];
        return [];
      });

      const result = await rebalanceApplyAction(HOME_ID);
      expect(result).toEqual({ ok: true, updated: 1 });

      const updateOps = batchOps.filter(
        (o) =>
          o.collection === 'tasks' &&
          o.method === 'update' &&
          (o.args[1] as Record<string, unknown>).next_due_smoothed !== undefined,
      );
      expect(updateOps).toHaveLength(1);
      expect(updateOps[0].args[0]).toBe(task.id);
      const payload = updateOps[0].args[1] as { next_due_smoothed: string };
      expect(typeof payload.next_due_smoothed).toBe('string');
      expect(new Date(payload.next_due_smoothed).getTime()).toBeGreaterThan(0);
    });

    test('A4: preservation — anchored/override/marker never appear in next_due_smoothed updates', async () => {
      const { rebalanceApplyAction } = await loadActions();

      const anchored = makeTask({
        id: 'anch00000000001',
        schedule_mode: 'anchored',
        anchor_date: '2026-08-01T00:00:00.000Z',
      });
      const ovrTask = makeTask({ id: 'ovrt00000000001' });
      const markerTask = makeTask({
        id: 'mark00000000001',
        reschedule_marker: '2026-06-01T00:00:00.000Z',
      });
      const rebalTask = makeTask({ id: 'reba00000000001' });

      mockGetFullList.mockImplementation(async (name: string) => {
        if (name === 'tasks') return [anchored, ovrTask, markerTask, rebalTask];
        return [];
      });
      mockGetActiveOverridesForHome.mockResolvedValue(
        new Map<string, Override>([[ovrTask.id, makeOverride(ovrTask.id)]]),
      );

      const result = await rebalanceApplyAction(HOME_ID);
      expect(result).toHaveProperty('ok', true);

      // Only rebalanceable task id in next_due_smoothed updates.
      const smoothedUpdates = batchOps.filter(
        (o) =>
          o.collection === 'tasks' &&
          o.method === 'update' &&
          (o.args[1] as Record<string, unknown>).next_due_smoothed !== undefined,
      );
      expect(smoothedUpdates).toHaveLength(1);
      expect(smoothedUpdates[0].args[0]).toBe(rebalTask.id);

      // Anchored / override / marker ids appear in ZERO next_due_smoothed updates.
      const targetIds = smoothedUpdates.map((o) => o.args[0] as string);
      expect(targetIds).not.toContain(anchored.id);
      expect(targetIds).not.toContain(ovrTask.id);
      // markerTask ID may appear in a marker-clear op (tested A5), but
      // NOT in a next_due_smoothed op.
      expect(targetIds).not.toContain(markerTask.id);
    });

    test('A5: from_now_on bucket — one marker-clear op {reschedule_marker: null} per task', async () => {
      const { rebalanceApplyAction } = await loadActions();

      const markerTask = makeTask({
        id: 'mark00000000001',
        reschedule_marker: '2026-03-01T00:00:00.000Z',
      });
      const rebalTask = makeTask({ id: 'reba00000000001' });

      mockGetFullList.mockImplementation(async (name: string) => {
        if (name === 'tasks') return [markerTask, rebalTask];
        return [];
      });

      const result = await rebalanceApplyAction(HOME_ID);
      expect(result).toHaveProperty('ok', true);

      const markerClearOps = batchOps.filter(
        (o) =>
          o.collection === 'tasks' &&
          o.method === 'update' &&
          (o.args[1] as Record<string, unknown>).reschedule_marker === null,
      );
      expect(markerClearOps).toHaveLength(1);
      expect(markerClearOps[0].args[0]).toBe(markerTask.id);
    });

    test('A6: single atomic batch.send per apply', async () => {
      const { rebalanceApplyAction } = await loadActions();
      const tasks = [
        makeTask({ id: 'reba00000000001' }),
        makeTask({ id: 'reba00000000002' }),
        makeTask({
          id: 'mark00000000001',
          reschedule_marker: '2026-03-01T00:00:00.000Z',
        }),
      ];
      mockGetFullList.mockImplementation(async (name: string) => {
        if (name === 'tasks') return tasks;
        return [];
      });

      await rebalanceApplyAction(HOME_ID);
      expect(mockBatchSend).toHaveBeenCalledTimes(1);
    });

    test('A7: idempotency — second apply produces same next_due_smoothed ISO per task', async () => {
      const { rebalanceApplyAction } = await loadActions();

      // Stable completion that anchors naturalIdeal.
      const latestByTask = new Map([
        [
          'reba00000000001',
          {
            id: 'cmpl000000001',
            task_id: 'reba00000000001',
            completed_by_id: 'user1234567890a',
            completed_at: '2026-03-15T00:00:00.000Z',
            notes: '',
            via: 'tap' as const,
          },
        ],
      ]);
      mockReduceLatestByTask.mockReturnValue(latestByTask);

      const task = makeTask({
        id: 'reba00000000001',
        frequency_days: 30,
      });
      mockGetFullList.mockImplementation(async (name: string) => {
        if (name === 'tasks') return [task];
        return [];
      });

      // Run 1
      batchOps = [];
      await rebalanceApplyAction(HOME_ID);
      const firstOps = structuredClone(batchOps);
      const firstSmoothed = firstOps
        .filter(
          (o) =>
            o.collection === 'tasks' &&
            o.method === 'update' &&
            (o.args[1] as Record<string, unknown>).next_due_smoothed !==
              undefined,
        )
        .map((o) => ({
          id: o.args[0] as string,
          iso: (o.args[1] as { next_due_smoothed: string }).next_due_smoothed,
        }));

      // Simulate stored state after first apply: task now carries smoothed.
      const updatedTask: Task = {
        ...task,
        next_due_smoothed: firstSmoothed[0].iso,
      };
      mockGetFullList.mockImplementation(async (name: string) => {
        if (name === 'tasks') return [updatedTask];
        return [];
      });

      // Run 2
      batchOps = [];
      await rebalanceApplyAction(HOME_ID);
      const secondOps = structuredClone(batchOps);
      const secondSmoothed = secondOps
        .filter(
          (o) =>
            o.collection === 'tasks' &&
            o.method === 'update' &&
            (o.args[1] as Record<string, unknown>).next_due_smoothed !==
              undefined,
        )
        .map((o) => ({
          id: o.args[0] as string,
          iso: (o.args[1] as { next_due_smoothed: string }).next_due_smoothed,
        }));

      // Same number of smoothed updates.
      expect(secondSmoothed).toHaveLength(firstSmoothed.length);
      // Per-task value stable.
      for (let i = 0; i < firstSmoothed.length; i++) {
        expect(secondSmoothed[i].id).toBe(firstSmoothed[i].id);
        expect(secondSmoothed[i].iso).toBe(firstSmoothed[i].iso);
      }
    });

    test('A8: membership gate → zero batch.send', async () => {
      const { rebalanceApplyAction } = await loadActions();
      mockAssertMembership.mockRejectedValueOnce(new Error('Not member'));

      const result = await rebalanceApplyAction(HOME_ID);
      expect(result).toEqual({
        ok: false,
        formError: 'You are not a member of this home',
      });
      expect(mockBatchSend).not.toHaveBeenCalled();
    });
  });

  // ─── Apply test A2 — REAL placeNextDue to prove load-map threading ───

  describe('rebalanceApplyAction — with REAL placeNextDue (REBAL-07)', () => {
    test('A2: 5 same-freq rebalanceable tasks distribute across >= 4 distinct isoDateKeys (threading proof)', async () => {
      // Unmock placeNextDue + computeHouseholdLoad for this test only.
      const actual = await vi.importActual<
        typeof import('@/lib/load-smoothing')
      >('@/lib/load-smoothing');
      mockPlaceNextDue.mockImplementation(actual.placeNextDue);
      mockComputeHouseholdLoad.mockImplementation(actual.computeHouseholdLoad);

      const { rebalanceApplyAction } = await loadActions();

      // 5 tasks with same frequency and same created date → natural
      // ideal collapses to the same date. Without threading, all 5 would
      // pick the same date. With threading (Map mutated between
      // placements), placements distribute within the tolerance window.
      const sameFreqTasks = Array.from({ length: 5 }, (_, i) =>
        makeTask({
          id: `same${i.toString().padStart(11, '0')}`,
          created: '2026-03-21T00:00:00.000Z',
          frequency_days: 30,
          next_due_smoothed: null,
        }),
      );

      mockGetFullList.mockImplementation(async (name: string) => {
        if (name === 'tasks') return sameFreqTasks;
        return [];
      });

      const result = await rebalanceApplyAction(HOME_ID);
      expect(result).toHaveProperty('ok', true);

      const smoothedUpdates = batchOps.filter(
        (o) =>
          o.collection === 'tasks' &&
          o.method === 'update' &&
          (o.args[1] as Record<string, unknown>).next_due_smoothed !== undefined,
      );
      expect(smoothedUpdates).toHaveLength(5);

      // Extract YYYY-MM-DD of each placed date.
      const distinctDateKeys = new Set(
        smoothedUpdates.map((o) => {
          const iso = (o.args[1] as { next_due_smoothed: string })
            .next_due_smoothed;
          return iso.slice(0, 10);
        }),
      );
      // Without threading: 5 placements collapse to 1 or 2 date keys.
      // With threading + tolerance=min(0.15*30,5)=4 → window is 9 days
      // wide (±4) → placements spread. Assert >= 4 distinct keys.
      expect(distinctDateKeys.size).toBeGreaterThanOrEqual(4);
    });
  });
});
