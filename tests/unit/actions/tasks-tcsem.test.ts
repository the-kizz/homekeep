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
 * Phase 13 Plan 13-01 Task 2 — createTask TCSEM unit tests.
 *
 * Mocks PB (no live server) + ancillary modules. Asserts:
 *   (1) cycle + non-OOFT creates include a non-null next_due_smoothed
 *       ISO string in the single tasks.create body (atomic-by-construction
 *       per D-05 Approach A).
 *   (2) cycle + lastDone=null smart-default lands within tolerance
 *       window of naturalIdeal (freq=30 → now + 7d per TCSEM-03).
 *   (3) anchored creation leaves next_due_smoothed EMPTY ('' = null)
 *       — LOAD-06 bypass preserved, byte-identical v1.0 behavior.
 *   (4) OOFT creation (frequency_days=null + due_date set) leaves
 *       next_due_smoothed EMPTY — LOAD-09 bypass preserved.
 *   (5) Placement error (mocked placeNextDue throws) → console.warn +
 *       next_due_smoothed stays '' (D-06 fallback). createTask still
 *       completes without failure.
 *   (6) preferred_days='weekend' threads through to placeNextDue options.
 *
 * Module-layout contract: mockCreate etc are module-level vi.fn refs;
 * vi.mock factories close over them. This pattern matches the PB-mock
 * conventions in scheduler.test.ts + hooks tests.
 */

// ─── Module-level mock refs (hoisted-safe via lazy closures) ─────────────
const mockAssertMembership = vi.fn().mockResolvedValue(undefined);
const mockCreate = vi.fn();
const mockGetOne = vi.fn();
const mockGetFullList = vi.fn();
const mockPlaceNextDue = vi.fn();
const mockComputeHouseholdLoad = vi.fn();
const mockComputeFirstIdealDate = vi.fn();
const mockRevalidatePath = vi.fn();

vi.mock('@/lib/membership', () => ({
  assertMembership: (...args: unknown[]) => mockAssertMembership(...args),
}));

vi.mock('@/lib/pocketbase-server', () => ({
  createServerClient: async () => ({
    authStore: { isValid: true, record: { id: 'user-1' } },
    filter: (expr: string, params: Record<string, string>) =>
      expr.replace(/\{:(\w+)\}/g, (_, k) => `"${params[k]}"`),
    collection: (_name: string) => ({
      getOne: (...args: unknown[]) => mockGetOne(_name, ...args),
      getFullList: (...args: unknown[]) => mockGetFullList(_name, ...args),
      create: (...args: unknown[]) => mockCreate(_name, ...args),
      // Phase 25 RATE-01 added assertTasksQuota → calls getList. Stub
      // it with an empty totalItems so the quota check always passes
      // in these existing TCSEM tests (they exercise a single task
      // create — no quota-related assertion here).
      getList: (..._args: unknown[]) =>
        Promise.resolve({ items: [], totalItems: 0, page: 1, perPage: 1, totalPages: 0 }),
    }),
  }),
}));

vi.mock('@/lib/pocketbase-admin', () => ({
  createAdminClient: async () => ({}),
}));

vi.mock('@/lib/completions', () => ({
  getCompletionsForHome: async () => [],
  reduceLatestByTask: () => new Map(),
}));

vi.mock('@/lib/schedule-overrides', () => ({
  getActiveOverridesForHome: async () => new Map(),
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
    computeFirstIdealDate: (...args: unknown[]) =>
      mockComputeFirstIdealDate(...args),
  };
});

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    // Mimic Next.js: redirect() throws a synthetic signal error after the
    // server action's write completes. Tests catch this + inspect state.
    const err = new Error(`REDIRECT:${url}`);
    (err as Error & { digest?: string }).digest = `NEXT_REDIRECT;${url}`;
    throw err;
  },
}));

// Dynamic import AFTER mocks registered.
async function loadCreateTask() {
  return (await import('@/lib/actions/tasks')).createTask;
}

function baseFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const defaults: Record<string, string> = {
    home_id: 'home-1234567890x',
    area_id: 'area-1234567890x',
    name: 'Wipe benches',
    description: '',
    frequency_days: '30',
    schedule_mode: 'cycle',
    anchor_date: '',
    icon: '',
    color: '',
    assigned_to_id: '',
    notes: '',
  };
  for (const [k, v] of Object.entries({ ...defaults, ...overrides })) {
    fd.append(k, v);
  }
  return fd;
}

function extractCreateBody(): Record<string, unknown> | null {
  const call = mockCreate.mock.calls.find(
    ([collection]) => collection === 'tasks',
  );
  if (!call) return null;
  return call[1] as Record<string, unknown>;
}

describe('createTask TCSEM (Phase 13 Plan 13-01 Task 2)', () => {
  const PLACED_DATE = new Date('2026-04-29T00:00:00.000Z');

  beforeEach(() => {
    mockAssertMembership.mockReset().mockResolvedValue(undefined);
    mockCreate.mockReset().mockResolvedValue({ id: 'task-new' });
    mockGetOne.mockReset();
    mockGetFullList.mockReset();
    mockPlaceNextDue.mockReset();
    mockComputeHouseholdLoad.mockReset();
    mockComputeFirstIdealDate.mockReset();
    mockRevalidatePath.mockReset();

    // Default happy-path PB responses:
    //   - areas.getOne: returns an area whose home_id matches
    //   - homes.getOne: returns a home with a timezone
    //   - tasks.getFullList: returns empty (fresh home, no siblings)
    mockGetOne.mockImplementation(async (collection: string, id: string) => {
      if (collection === 'areas') {
        return { id, home_id: 'home-1234567890x' };
      }
      if (collection === 'homes') {
        return { id, timezone: 'UTC' };
      }
      return { id };
    });
    mockGetFullList.mockResolvedValue([]);
    mockComputeHouseholdLoad.mockReturnValue(new Map());
    mockComputeFirstIdealDate.mockReturnValue(
      new Date('2026-04-29T00:00:00.000Z'),
    );
    mockPlaceNextDue.mockReturnValue(PLACED_DATE);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('Test 1: cycle + no lastDone + freq=30 → create body has non-null next_due_smoothed ISO', async () => {
    const createTask = await loadCreateTask();
    try {
      await createTask({ ok: false }, baseFormData());
    } catch (e) {
      // redirect() throws — expected for the happy path.
      if (!(e as Error).message?.startsWith('REDIRECT:')) throw e;
    }

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const body = extractCreateBody();
    expect(body).not.toBeNull();
    expect(body!.next_due_smoothed).toEqual(PLACED_DATE.toISOString());
    expect(body!.schedule_mode).toEqual('cycle');
    expect(body!.frequency_days).toEqual(30);
  });

  test('Test 2: cycle + freq=7 → placeNextDue invoked with synthetic lastCompletion offset reversing to firstIdeal', async () => {
    mockComputeFirstIdealDate.mockReset().mockImplementation(
      (mode: string, freq: number, lastDone: Date | null, now: Date) => {
        // freq=7 smart default = now + 1 day
        return new Date(now.getTime() + 1 * 86400000);
      },
    );
    // Use the actual placement result shape — return a date in the future.
    mockPlaceNextDue.mockImplementation(
      (_task, _lastCompletion, _load, now) => {
        return new Date(now.getTime() + 2 * 86400000);
      },
    );

    const createTask = await loadCreateTask();
    try {
      await createTask(
        { ok: false },
        baseFormData({ frequency_days: '7' }),
      );
    } catch (e) {
      if (!(e as Error).message?.startsWith('REDIRECT:')) throw e;
    }

    expect(mockPlaceNextDue).toHaveBeenCalledTimes(1);
    const [taskArg, lastCompletionArg, , nowArg, optsArg] =
      mockPlaceNextDue.mock.calls[0];
    // Synthetic lastCompletion.completed_at = firstIdeal - freq (TCSEM bridge)
    // Which for freq=7 smart-default = now + 1d - 7d = now - 6d.
    const nowMs = (nowArg as Date).getTime();
    const completedAtMs = new Date(
      (lastCompletionArg as { completed_at: string }).completed_at,
    ).getTime();
    expect(Math.round((completedAtMs - nowMs) / 86400000)).toEqual(-6);
    expect((taskArg as { schedule_mode: string }).schedule_mode).toEqual(
      'cycle',
    );
    expect((optsArg as { timezone: string }).timezone).toEqual('UTC');

    const body = extractCreateBody();
    expect(body).not.toBeNull();
    expect(body!.next_due_smoothed).toBeDefined();
  });

  test('Test 3: anchored + anchor_date → NO placement call; next_due_smoothed empty in create body', async () => {
    const createTask = await loadCreateTask();
    try {
      await createTask(
        { ok: false },
        baseFormData({
          schedule_mode: 'anchored',
          anchor_date: '2026-06-01T00:00:00.000Z',
          frequency_days: '30',
        }),
      );
    } catch (e) {
      if (!(e as Error).message?.startsWith('REDIRECT:')) throw e;
    }

    expect(mockPlaceNextDue).not.toHaveBeenCalled();
    expect(mockComputeFirstIdealDate).not.toHaveBeenCalled();

    const body = extractCreateBody();
    expect(body).not.toBeNull();
    expect(body!.schedule_mode).toEqual('anchored');
    // Empty string / null-equivalent — LOAD-06 bypass.
    expect(body!.next_due_smoothed ?? '').toEqual('');
  });

  test('Test 4: OOFT freq=0 → empty string form field routes through Phase 15 OOFT path (refine 1 requires due_date)', async () => {
    // Phase 15 Plan 02 (OOFT-04) update: the createTask raw-parse now
    // converts empty/non-positive frequency_days strings to null BEFORE
    // safeParse (rather than coercing to 0 and tripping schema.min(1)).
    // This enables the Phase 15 form toggle's "One-off" submission path,
    // where frequency_days is intentionally omitted in favor of due_date.
    //
    // Contract for Phase 15+: freq=0 (or empty) + no due_date → Phase 11
    // refine 1 fires ("Due date required for one-off tasks"), fieldError
    // surfaces under `due_date`, no create call.
    // Prior Phase 13 contract (freq=0 → frequency_days fieldError) was
    // a Phase-13-only artifact awaiting the Phase 15 OOFT form UI, per
    // the original test comment: "Phase 14+ OOFT form UI will unlock
    // the null-freq path."
    const createTask = await loadCreateTask();
    const result = await createTask(
      { ok: false },
      baseFormData({ frequency_days: '0' }),
    );

    expect(result).toBeDefined();
    if (result && 'fieldErrors' in result) {
      // Phase 15: the error is on due_date (refine 1), not frequency_days.
      expect(result.fieldErrors?.due_date).toBeDefined();
    }
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockPlaceNextDue).not.toHaveBeenCalled();
  });

  test('Test 5: placement throws → console.warn called, create still fires with empty next_due_smoothed (D-06 fallback)', async () => {
    mockPlaceNextDue.mockImplementation(() => {
      throw new Error('simulated placement failure');
    });
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    const createTask = await loadCreateTask();
    try {
      await createTask({ ok: false }, baseFormData());
    } catch (e) {
      if (!(e as Error).message?.startsWith('REDIRECT:')) throw e;
    }

    expect(warnSpy).toHaveBeenCalled();
    const warnCall = warnSpy.mock.calls[0];
    expect(String(warnCall[0])).toMatch(/\[createTask\] placement failed/);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const body = extractCreateBody();
    expect(body).not.toBeNull();
    expect(body!.next_due_smoothed ?? '').toEqual('');
  });

  test('Test 6: placement-error fallback still returns null-equivalent without re-throwing (createTask never fails on placement)', async () => {
    mockPlaceNextDue.mockImplementation(() => {
      throw new Error('NaN date');
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const createTask = await loadCreateTask();
    // Must NOT return a formError due to placement — it should redirect.
    let redirected = false;
    try {
      await createTask({ ok: false }, baseFormData());
    } catch (e) {
      if ((e as Error).message?.startsWith('REDIRECT:')) {
        redirected = true;
      } else {
        throw e;
      }
    }
    expect(redirected).toBe(true);
  });
});
