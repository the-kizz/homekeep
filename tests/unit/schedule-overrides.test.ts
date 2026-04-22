import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from 'vitest';
import {
  getActiveOverride,
  getActiveOverridesForHome,
  type Override,
} from '@/lib/schedule-overrides';
import { scheduleOverrideSchema } from '@/lib/schemas/schedule-override';

/**
 * 10-01 Task 2 — pure unit tests for lib/schedule-overrides + schema.
 *
 * These tests stub PocketBase surface via `vi.fn()` — zero PB I/O, zero
 * disposable-PB dependency. The integration contract (port 18098) lives
 * in `tests/unit/schedule-overrides-integration.test.ts`.
 *
 * Coverage (13 tests — letter-keyed to plan <behavior>):
 *   A: getActiveOverride returns null when PB rejects with 404 shape.
 *   B: getActiveOverride returns null on any thrown error (fail-open).
 *   C: getActiveOverride returns Override when PB resolves with a row.
 *   D: getActiveOverride calls pb.filter with { tid: <taskId> } (no concat).
 *   E: getActiveOverridesForHome returns empty Map on getFullList throwing.
 *   F: getActiveOverridesForHome returns empty Map when getFullList → [].
 *   G: getActiveOverridesForHome reduces 3 same-task rows → 1 entry.
 *   H: getActiveOverridesForHome reduces mixed 4 rows (2 per task) → 2 entries.
 *   I: getActiveOverridesForHome passes batch: 500 to getFullList.
 *   J: scheduleOverrideSchema rejects past snooze_until (-5 minutes).
 *   K: scheduleOverrideSchema accepts near-future snooze_until (+1 hour).
 *   L: scheduleOverrideSchema rejects non-ISO string (Number.isNaN).
 *   M: scheduleOverrideSchema rejects empty task_id.
 */

// ─── Mock PB shape ─────────────────────────────────────────────────────

type CollectionStub = {
  getFirstListItem: Mock;
  getFullList: Mock;
};

type PbStub = {
  filter: Mock;
  collection: Mock;
  _coll: CollectionStub;
  _filterCalls: Array<{ expr: string; args: unknown }>;
};

function makePbStub(): PbStub {
  const coll: CollectionStub = {
    getFirstListItem: vi.fn(),
    getFullList: vi.fn(),
  };
  const filterCalls: Array<{ expr: string; args: unknown }> = [];
  const pb: PbStub = {
    filter: vi.fn((expr: string, args: unknown) => {
      filterCalls.push({ expr, args });
      // Mirror PB SDK behavior (returns the bound expression string); the
      // helpers only consume the return value as the filter parameter.
      return expr;
    }),
    collection: vi.fn(() => coll),
    _coll: coll,
    _filterCalls: filterCalls,
  };
  return pb;
}

function makeOverride(overrides: Partial<Override> = {}): Override {
  return {
    id: 'o-default',
    task_id: 't1',
    snooze_until: '2026-05-01T00:00:00.000Z',
    consumed_at: null,
    created_by_id: 'u1',
    created: '2026-04-22T10:00:00.000Z',
    ...overrides,
  };
}

// ─── getActiveOverride (A-D) ──────────────────────────────────────────

describe('getActiveOverride', () => {
  test('A: returns null when PB rejects with 404-shaped error', async () => {
    const pb = makePbStub();
    // Mimic ClientResponseError shape (status: 404).
    pb._coll.getFirstListItem.mockRejectedValue({
      status: 404,
      message: 'not found',
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getActiveOverride(pb as any, 't1');
    expect(result).toBeNull();
  });

  test('B: returns null on any thrown error (fail-open)', async () => {
    const pb = makePbStub();
    pb._coll.getFirstListItem.mockRejectedValue(new Error('network down'));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getActiveOverride(pb as any, 't1');
    expect(result).toBeNull();
  });

  test('C: returns Override object when PB resolves with a row', async () => {
    const pb = makePbStub();
    const row = makeOverride({ id: 'o-1', task_id: 't1' });
    pb._coll.getFirstListItem.mockResolvedValue(row);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getActiveOverride(pb as any, 't1');
    expect(result).toEqual(row);
    expect(result?.id).toBe('o-1');
  });

  test('D: calls pb.filter with { tid: <taskId> } (parameterized, not concat)', async () => {
    const pb = makePbStub();
    pb._coll.getFirstListItem.mockResolvedValue(makeOverride());

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await getActiveOverride(pb as any, 'task-xyz-123');

    // Exactly one filter call; bound tid param (NOT string-concat).
    expect(pb._filterCalls).toHaveLength(1);
    expect(pb._filterCalls[0].expr).toContain('{:tid}');
    expect(pb._filterCalls[0].args).toEqual({ tid: 'task-xyz-123' });

    // Sanity: getFirstListItem was called with the filter string and a sort.
    const call = pb._coll.getFirstListItem.mock.calls[0];
    expect(call[0]).toContain('{:tid}'); // our stub returns expr unchanged
    expect(call[1]).toEqual({ sort: '-created' });
  });
});

// ─── getActiveOverridesForHome (E-I) ──────────────────────────────────

describe('getActiveOverridesForHome', () => {
  test('E: returns empty Map when getFullList throws', async () => {
    const pb = makePbStub();
    pb._coll.getFullList.mockRejectedValue(new Error('PB down'));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = await getActiveOverridesForHome(pb as any, 'h1');
    expect(m).toBeInstanceOf(Map);
    expect(m.size).toBe(0);
  });

  test('F: returns empty Map when getFullList resolves with []', async () => {
    const pb = makePbStub();
    pb._coll.getFullList.mockResolvedValue([]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = await getActiveOverridesForHome(pb as any, 'h1');
    expect(m.size).toBe(0);
  });

  test('G: reduces 3 rows for same task_id to 1 entry (newest wins via first-in)', async () => {
    const pb = makePbStub();
    // Sort `-created` means newest first; helper keeps FIRST entry.
    const newest = makeOverride({
      id: 'o-newest',
      task_id: 't1',
      created: '2026-04-22T12:00:00.000Z',
    });
    const middle = makeOverride({
      id: 'o-middle',
      task_id: 't1',
      created: '2026-04-22T11:00:00.000Z',
    });
    const oldest = makeOverride({
      id: 'o-oldest',
      task_id: 't1',
      created: '2026-04-22T10:00:00.000Z',
    });
    pb._coll.getFullList.mockResolvedValue([newest, middle, oldest]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = await getActiveOverridesForHome(pb as any, 'h1');
    expect(m.size).toBe(1);
    expect(m.get('t1')?.id).toBe('o-newest');
  });

  test('H: reduces 4 mixed rows (2 tasks, 2 rows each) → 2-entry Map, newest per task', async () => {
    const pb = makePbStub();
    const t1New = makeOverride({
      id: 'o-t1-new',
      task_id: 't1',
      created: '2026-04-22T12:00:00.000Z',
    });
    const t1Old = makeOverride({
      id: 'o-t1-old',
      task_id: 't1',
      created: '2026-04-22T10:00:00.000Z',
    });
    const t2New = makeOverride({
      id: 'o-t2-new',
      task_id: 't2',
      created: '2026-04-22T11:30:00.000Z',
    });
    const t2Old = makeOverride({
      id: 'o-t2-old',
      task_id: 't2',
      created: '2026-04-22T09:00:00.000Z',
    });
    // Sort '-created' so newest first (t1New, t2New, t1Old, t2Old).
    pb._coll.getFullList.mockResolvedValue([t1New, t2New, t1Old, t2Old]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = await getActiveOverridesForHome(pb as any, 'h1');
    expect(m.size).toBe(2);
    expect(m.get('t1')?.id).toBe('o-t1-new');
    expect(m.get('t2')?.id).toBe('o-t2-new');
  });

  test('I: passes batch: 500 to getFullList', async () => {
    const pb = makePbStub();
    pb._coll.getFullList.mockResolvedValue([]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await getActiveOverridesForHome(pb as any, 'h1');

    // Single filter call with the home-id parameterized binding.
    expect(pb._filterCalls).toHaveLength(1);
    expect(pb._filterCalls[0].expr).toContain('{:hid}');
    expect(pb._filterCalls[0].args).toEqual({ hid: 'h1' });

    // getFullList received an options object including `batch: 500`.
    const call = pb._coll.getFullList.mock.calls[0];
    const opts = call[0] as { batch?: number; sort?: string };
    expect(opts.batch).toBe(500);
    expect(opts.sort).toBe('-created');
  });
});

// ─── scheduleOverrideSchema (J-M) ─────────────────────────────────────

describe('scheduleOverrideSchema', () => {
  beforeEach(() => {
    // Stabilise Date.now() for the refine's clock-skew arithmetic.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-22T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('J: rejects snooze_until = now - 5 minutes (clearly past, beyond fudge)', () => {
    const pastIso = new Date(
      Date.now() - 5 * 60 * 1000,
    ).toISOString();

    expect(() =>
      scheduleOverrideSchema.parse({
        task_id: 't1',
        snooze_until: pastIso,
      }),
    ).toThrow();

    // Also verify safeParse returns success:false with the error on
    // snooze_until path (I: refine path routing).
    const result = scheduleOverrideSchema.safeParse({
      task_id: 't1',
      snooze_until: pastIso,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['snooze_until']);
    }
  });

  test('K: accepts snooze_until = now + 1 hour', () => {
    const futureIso = new Date(
      Date.now() + 60 * 60 * 1000,
    ).toISOString();

    const result = scheduleOverrideSchema.parse({
      task_id: 't1',
      snooze_until: futureIso,
    });
    expect(result.task_id).toBe('t1');
    expect(result.snooze_until).toBe(futureIso);
  });

  test('L: rejects non-ISO string (Number.isNaN(Date.getTime()) guard)', () => {
    const result = scheduleOverrideSchema.safeParse({
      task_id: 't1',
      snooze_until: 'not-a-date',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      // Refine routes the error to snooze_until (Test I behavior).
      expect(result.error.issues[0].path).toEqual(['snooze_until']);
    }
  });

  test('M: rejects empty task_id', () => {
    const futureIso = new Date(
      Date.now() + 60 * 60 * 1000,
    ).toISOString();

    const result = scheduleOverrideSchema.safeParse({
      task_id: '',
      snooze_until: futureIso,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      // task_id error is a direct field-level min(1), path === ['task_id'].
      const taskIdError = result.error.issues.find(
        (i) => i.path[0] === 'task_id',
      );
      expect(taskIdError).toBeDefined();
    }
  });

  test('N: accepts snooze_until = now + 30 seconds (at the clock-skew boundary)', () => {
    // Within-fudge boundary: now + 30s. CLOCK_SKEW_SECS = 30 means the
    // threshold is now - 30s, and snooze > threshold must hold — a +30s
    // snooze trivially exceeds the negative-skew threshold.
    const nearFutureIso = new Date(Date.now() + 30 * 1000).toISOString();

    const result = scheduleOverrideSchema.parse({
      task_id: 't1',
      snooze_until: nearFutureIso,
    });
    expect(result.snooze_until).toBe(nearFutureIso);
  });
});
