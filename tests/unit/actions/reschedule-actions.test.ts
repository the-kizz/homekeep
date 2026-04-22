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
 * Phase 15 Plan 15-01 Task 2 — reschedule server actions unit tests
 * (D-13, D-14, D-15, SNZE-07).
 *
 * Mocks PB (no live server) + membership + schedule-overrides. Asserts:
 *   (1) snoozeTaskAction writes a schedule_overrides row via pb.createBatch
 *       on the happy path (no prior override).
 *   (2) snoozeTaskAction atomically consumes a pre-existing active
 *       override in the SAME batch (Phase 10 D-02 atomic-replace-active).
 *   (3) snoozeTaskAction returns {ok:false, formError:'Not signed in'}
 *       when !authStore.isValid.
 *   (4) snoozeTaskAction returns {ok:false, formError:'Missing task id'}
 *       for empty task_id.
 *   (5) snoozeTaskAction returns {ok:false, formError:'Invalid snooze
 *       date'} for non-parseable snooze_until.
 *   (6) rescheduleTaskAction cycle-mode writes {next_due_smoothed,
 *       reschedule_marker} only (D-14).
 *   (7) rescheduleTaskAction anchored-mode writes {anchor_date,
 *       reschedule_marker} only (D-14).
 *   (8) rescheduleTaskAction returns {ok:false, formError:'You are not
 *       a member of this home'} on membership rejection.
 *
 * Module-layout contract: module-level vi.fn refs; vi.mock factories
 * close over them. Mirrors the PB-mock conventions in
 * tasks-tcsem.test.ts.
 */

// ─── Module-level mock refs (hoisted-safe via lazy closures) ─────────────
const mockAssertMembership = vi.fn().mockResolvedValue({ role: 'member' });
const mockGetOne = vi.fn();
const mockUpdateTask = vi.fn();
const mockGetActiveOverride = vi.fn();
const mockRevalidatePath = vi.fn();
// Captured batch ops per action invocation. Each op is
// { collection, verb: 'create'|'update', id?, payload }.
type BatchOp = {
  collection: string;
  verb: 'create' | 'update';
  id?: string;
  payload: Record<string, unknown>;
};
let currentBatchOps: BatchOp[] = [];
// Value returned by batch.send() — controllable per-test for the
// result shape (mirrors PB's BatchRequestResult[] = [{status, body}]).
let currentBatchSendResult: Array<{ status: number; body: unknown }> = [];

// Controllable authStore per test
let authValid = true;
let authUserId: string | null = 'user-1';

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
      update: (...args: unknown[]) => mockUpdateTask(name, ...args),
    }),
    createBatch: () => ({
      collection: (collectionName: string) => ({
        create: (payload: Record<string, unknown>) => {
          currentBatchOps.push({
            collection: collectionName,
            verb: 'create',
            payload,
          });
        },
        update: (id: string, payload: Record<string, unknown>) => {
          currentBatchOps.push({
            collection: collectionName,
            verb: 'update',
            id,
            payload,
          });
        },
      }),
      send: async () => currentBatchSendResult,
    }),
  }),
}));

vi.mock('@/lib/schedule-overrides', () => ({
  getActiveOverride: (...args: unknown[]) => mockGetActiveOverride(...args),
}));

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

// Dynamic import AFTER mocks registered.
async function loadActions() {
  return await import('@/lib/actions/reschedule');
}

describe('Phase 15 reschedule server actions (Plan 15-01 Task 2)', () => {
  beforeEach(() => {
    mockAssertMembership.mockReset().mockResolvedValue({ role: 'member' });
    mockGetOne.mockReset();
    mockUpdateTask.mockReset();
    mockGetActiveOverride.mockReset().mockResolvedValue(null);
    mockRevalidatePath.mockReset();
    currentBatchOps = [];
    currentBatchSendResult = [];
    authValid = true;
    authUserId = 'user-1';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── snoozeTaskAction ────────────────────────────────────────────

  describe('snoozeTaskAction', () => {
    test('writes new override row + returns {ok:true} (happy path, no prior override)', async () => {
      const { snoozeTaskAction } = await loadActions();

      // PB preflight getOne on tasks returns home_id.
      mockGetOne.mockResolvedValue({ id: 'task-1', home_id: 'home-1' });
      // Batch.send returns a single result: the new override.
      currentBatchSendResult = [
        {
          status: 200,
          body: { id: 'override-new', snooze_until: '2026-05-01T00:00:00.000Z' },
        },
      ];

      const result = await snoozeTaskAction({
        task_id: 'task-1',
        snooze_until: '2026-05-01T00:00:00.000Z',
      });

      expect(result).toEqual({
        ok: true,
        override: {
          id: 'override-new',
          snooze_until: '2026-05-01T00:00:00.000Z',
        },
      });

      // Exactly one batch op (create); no consumption of prior.
      expect(currentBatchOps).toHaveLength(1);
      expect(currentBatchOps[0].collection).toBe('schedule_overrides');
      expect(currentBatchOps[0].verb).toBe('create');
      expect(currentBatchOps[0].payload).toMatchObject({
        task_id: 'task-1',
        snooze_until: '2026-05-01T00:00:00.000Z',
        consumed_at: null,
        created_by_id: 'user-1',
      });

      // Membership gate was called.
      expect(mockAssertMembership).toHaveBeenCalledWith(
        expect.anything(),
        'home-1',
      );
      // revalidatePath fired for the home route.
      expect(mockRevalidatePath).toHaveBeenCalledWith('/h/home-1');
    });

    test('atomically consumes prior active override (D-02 atomic-replace-active)', async () => {
      const { snoozeTaskAction } = await loadActions();

      mockGetOne.mockResolvedValue({ id: 'task-1', home_id: 'home-1' });

      // Prior active override exists.
      mockGetActiveOverride.mockResolvedValue({
        id: 'override-prior',
        task_id: 'task-1',
        snooze_until: '2026-04-25T00:00:00.000Z',
        consumed_at: null,
        created_by_id: 'user-1',
        created: '2026-04-20T00:00:00.000Z',
      });

      currentBatchSendResult = [
        {
          status: 200,
          body: { id: 'override-new', snooze_until: '2026-05-01T00:00:00.000Z' },
        },
        {
          status: 200,
          body: { id: 'override-prior', consumed_at: '2026-04-22T00:00:00.000Z' },
        },
      ];

      const result = await snoozeTaskAction({
        task_id: 'task-1',
        snooze_until: '2026-05-01T00:00:00.000Z',
      });

      expect(result).toHaveProperty('ok', true);

      // TWO batch ops: one create (new) + one update (consume prior).
      expect(currentBatchOps).toHaveLength(2);

      // Op 0: create new override.
      expect(currentBatchOps[0]).toMatchObject({
        collection: 'schedule_overrides',
        verb: 'create',
      });
      expect(currentBatchOps[0].payload).toMatchObject({
        task_id: 'task-1',
        consumed_at: null,
      });

      // Op 1: consume the prior override.
      expect(currentBatchOps[1]).toMatchObject({
        collection: 'schedule_overrides',
        verb: 'update',
        id: 'override-prior',
      });
      expect(currentBatchOps[1].payload).toHaveProperty('consumed_at');
      expect(
        typeof currentBatchOps[1].payload.consumed_at === 'string' &&
          (currentBatchOps[1].payload.consumed_at as string).length > 0,
      ).toBe(true);
      // ISO shape.
      expect(currentBatchOps[1].payload.consumed_at).toEqual(
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      );

      // The atomic-replace pattern used getActiveOverride to pre-fetch.
      expect(mockGetActiveOverride).toHaveBeenCalledWith(
        expect.anything(),
        'task-1',
      );
    });

    test('returns {ok:false, formError:"Not signed in"} when !authStore.isValid', async () => {
      const { snoozeTaskAction } = await loadActions();
      authValid = false;

      const result = await snoozeTaskAction({
        task_id: 'task-1',
        snooze_until: '2026-05-01T00:00:00.000Z',
      });

      expect(result).toEqual({ ok: false, formError: 'Not signed in' });
      // No batch op should have been created.
      expect(currentBatchOps).toHaveLength(0);
    });

    test('returns {ok:false, formError:"Missing task id"} for empty task_id', async () => {
      const { snoozeTaskAction } = await loadActions();

      const result = await snoozeTaskAction({
        task_id: '',
        snooze_until: '2026-05-01T00:00:00.000Z',
      });

      expect(result).toEqual({ ok: false, formError: 'Missing task id' });
      expect(currentBatchOps).toHaveLength(0);
    });

    test('returns {ok:false, formError:"Invalid snooze date"} for non-parseable input', async () => {
      const { snoozeTaskAction } = await loadActions();

      const result = await snoozeTaskAction({
        task_id: 'task-1',
        snooze_until: 'not-a-date',
      });

      expect(result).toEqual({ ok: false, formError: 'Invalid snooze date' });
      expect(currentBatchOps).toHaveLength(0);
    });
  });

  // ─── rescheduleTaskAction ────────────────────────────────────────

  describe('rescheduleTaskAction', () => {
    test('cycle mode sets next_due_smoothed + reschedule_marker (D-14)', async () => {
      const { rescheduleTaskAction } = await loadActions();

      mockGetOne.mockResolvedValue({
        id: 'task-1',
        home_id: 'home-1',
        schedule_mode: 'cycle',
      });
      mockUpdateTask.mockResolvedValue({ id: 'task-1' });

      const result = await rescheduleTaskAction({
        task_id: 'task-1',
        new_date: '2026-05-10T00:00:00.000Z',
      });

      expect(result).toHaveProperty('ok', true);
      expect(mockUpdateTask).toHaveBeenCalledTimes(1);
      const [collection, id, payload] = mockUpdateTask.mock.calls[0];
      expect(collection).toBe('tasks');
      expect(id).toBe('task-1');
      expect(payload).toEqual({
        next_due_smoothed: '2026-05-10T00:00:00.000Z',
        reschedule_marker: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
      // Regression guard: cycle path must NOT write anchor_date.
      expect(payload).not.toHaveProperty('anchor_date');
    });

    test('anchored mode sets anchor_date + reschedule_marker (D-14)', async () => {
      const { rescheduleTaskAction } = await loadActions();

      mockGetOne.mockResolvedValue({
        id: 'task-2',
        home_id: 'home-1',
        schedule_mode: 'anchored',
      });
      mockUpdateTask.mockResolvedValue({ id: 'task-2' });

      const result = await rescheduleTaskAction({
        task_id: 'task-2',
        new_date: '2026-06-01T00:00:00.000Z',
      });

      expect(result).toHaveProperty('ok', true);
      expect(mockUpdateTask).toHaveBeenCalledTimes(1);
      const [collection, id, payload] = mockUpdateTask.mock.calls[0];
      expect(collection).toBe('tasks');
      expect(id).toBe('task-2');
      expect(payload).toEqual({
        anchor_date: '2026-06-01T00:00:00.000Z',
        reschedule_marker: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
      // Regression guard: anchored path must NOT write next_due_smoothed.
      expect(payload).not.toHaveProperty('next_due_smoothed');
    });

    test('returns {ok:false} on membership rejection', async () => {
      const { rescheduleTaskAction } = await loadActions();

      mockGetOne.mockResolvedValue({
        id: 'task-1',
        home_id: 'home-other',
        schedule_mode: 'cycle',
      });
      mockAssertMembership.mockRejectedValueOnce(new Error('Not member'));

      const result = await rescheduleTaskAction({
        task_id: 'task-1',
        new_date: '2026-05-10T00:00:00.000Z',
      });

      expect(result).toEqual({
        ok: false,
        formError: 'You are not a member of this home',
      });
      // No task update should have occurred.
      expect(mockUpdateTask).not.toHaveBeenCalled();
    });
  });
});
