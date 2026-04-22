// @vitest-environment node
import {
  describe,
  test,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';
import { SEED_LIBRARY } from '@/lib/seed-library';

/**
 * Phase 13 Plan 13-01 Task 3 — batchCreateSeedTasks TCSEM unit tests.
 *
 * Mocks PB + ancillary modules. Asserts:
 *   (1) Empty selections → schema rejects (min 1); no batch sent.
 *   (2) Single seed freq=30 → batch has 2 ops (1 tasks.create with
 *       next_due_smoothed populated + 1 homes.update onboarded=true).
 *   (3) 5 same-freq seeds → batch has 6 ops; next_due_smoothed
 *       values distribute — Set.size of YYYY-MM-DD dates ≥ 4
 *       (cohort distribution invariant, TCSEM-05).
 *   (4) 10 mixed-freq seeds (5×freq=7, 5×freq=365) → batch has 11
 *       ops (10 tasks.create + 1 homes.update); each tasks.create
 *       has a non-empty next_due_smoothed ISO string.
 *   (5) Third-seed placement throws → console.warn called; third
 *       seed lands with next_due_smoothed=''; other 4 seeds still
 *       get valid smoothed dates; batch still sends atomically
 *       (D-06 per-seed best-effort).
 *   (6) Synthetic-completion audit — zero matches for the forbidden
 *       token trio (seed-staggered kickoff / acronym / underscore
 *       variant) in production code dirs (lib/ components/ pocketbase/
 *       app/). Tokens are constructed via string-concat in the test
 *       body to keep THIS file free of literal matches so future
 *       audits scoped to tests/ also come up clean.
 *
 * batchOps table records every batch.collection(name).method(args)
 * call for assertion. mockBatch is module-level; vi.mock factory
 * closes over it via the pb.createBatch() stub.
 */

// ─── Module-level mock refs ──────────────────────────────────────────────
const mockAssertMembership = vi.fn().mockResolvedValue(undefined);
const mockGetFullList = vi.fn();
const mockGetOne = vi.fn();
const mockRevalidatePath = vi.fn();
const mockPlaceNextDue = vi.fn();
const mockComputeFirstIdealDate = vi.fn();
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

vi.mock('@/lib/membership', () => ({
  assertMembership: (...args: unknown[]) => mockAssertMembership(...args),
}));

vi.mock('@/lib/pocketbase-server', () => ({
  createServerClient: async () => ({
    authStore: { isValid: true, record: { id: 'user-1' } },
    filter: (expr: string, params: Record<string, string>) =>
      expr.replace(/\{:(\w+)\}/g, (_, k) => `"${params[k]}"`),
    createBatch: () => mockBatch,
    collection: (name: string) => ({
      getOne: (...args: unknown[]) => mockGetOne(name, ...args),
      getFullList: (...args: unknown[]) => mockGetFullList(name, ...args),
    }),
  }),
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
    computeFirstIdealDate: (...args: unknown[]) =>
      mockComputeFirstIdealDate(...args),
    computeHouseholdLoad: (...args: unknown[]) =>
      mockComputeHouseholdLoad(...args),
    // Keep real isoDateKey so the threading-map integration uses the
    // same key format on write + lookup (Pitfall 7 — we're testing
    // that threading works, not re-testing isoDateKey itself).
  };
});

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

async function loadBatchCreateSeedTasks() {
  return (await import('@/lib/actions/seed')).batchCreateSeedTasks;
}

const HOME_ID = 'home1234567890x'; // 15 chars
const AREA_ID = 'area1234567890x'; // 15 chars

function makeSelection(
  overrides: Partial<{
    seed_id: string;
    name: string;
    frequency_days: number;
    area_id: string;
  }> = {},
) {
  return {
    seed_id: SEED_LIBRARY[0].id, // real library id
    name: 'Test seed',
    frequency_days: 30,
    area_id: AREA_ID,
    ...overrides,
  };
}

describe('batchCreateSeedTasks TCSEM (Phase 13 Plan 13-01 Task 3)', () => {
  beforeEach(() => {
    batchOps = [];
    mockAssertMembership.mockReset().mockResolvedValue(undefined);
    mockGetFullList.mockReset();
    mockGetOne.mockReset();
    mockRevalidatePath.mockReset();
    mockPlaceNextDue.mockReset();
    mockComputeFirstIdealDate.mockReset();
    mockComputeHouseholdLoad.mockReset();
    mockBatchSend.mockReset().mockResolvedValue([]);

    // Default PB responses:
    //   - areas.getFullList → one area matching AREA_ID
    //   - tasks.getFullList → empty (fresh home)
    //   - homes.getOne → timezone=UTC
    mockGetFullList.mockImplementation(async (name: string) => {
      if (name === 'areas') return [{ id: AREA_ID }];
      if (name === 'tasks') return [];
      return [];
    });
    mockGetOne.mockImplementation(async (name: string, id: string) => {
      if (name === 'homes') return { id, timezone: 'UTC' };
      return { id };
    });

    // Default: computeHouseholdLoad returns empty map.
    mockComputeHouseholdLoad.mockReturnValue(new Map());

    // Default: computeFirstIdealDate returns now + 7 days (freq=30 smart default).
    mockComputeFirstIdealDate.mockImplementation(
      (_mode, freq: number, _lastDone, now: Date) => {
        // Mirror real formula so synthetic lastCompletion math matches.
        if (freq <= 7) return new Date(now.getTime() + 1 * 86400000);
        if (freq <= 90) {
          return new Date(now.getTime() + Math.floor(freq / 4) * 86400000);
        }
        return new Date(now.getTime() + Math.floor(freq / 3) * 86400000);
      },
    );

    // Default: placeNextDue returns firstIdeal + a spread based on load Map
    // size, simulating the real distribution behavior. This makes Test 3
    // (5-seed distribution) pass — successive invocations see an updated
    // load map and spread across distinct dates.
    let call = 0;
    mockPlaceNextDue.mockImplementation(
      (task, lastCompletion, load: Map<string, number>, now: Date) => {
        // baseISO = lastCompletion.completed_at (synthetic); naturalIdeal =
        // baseISO + freq = firstIdeal. Spread placements by load map
        // density — each subsequent call sees a denser map and shifts
        // forward by (call % 7) days to distribute.
        const baseIso = (lastCompletion as { completed_at: string })
          .completed_at;
        const freq = (task as { frequency_days: number }).frequency_days;
        const natural = new Date(baseIso).getTime() + freq * 86400000;
        const spread = load.size; // grows as threading adds entries
        const offset = (spread % 5) - 2; // -2..+2 day spread
        void now;
        call += 1;
        return new Date(natural + offset * 86400000);
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('Test 1: empty selections → schema rejects, formError returned, no batch.send', async () => {
    const fn = await loadBatchCreateSeedTasks();
    const result = await fn({ home_id: HOME_ID, selections: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.formError).toMatch(/seed/i);
    }
    expect(mockBatchSend).not.toHaveBeenCalled();
    expect(batchOps).toHaveLength(0);
  });

  test('Test 2: single seed freq=30 → batch has 2 ops (1 create + 1 update); create has non-empty next_due_smoothed ISO', async () => {
    const fn = await loadBatchCreateSeedTasks();
    const result = await fn({
      home_id: HOME_ID,
      selections: [makeSelection({ frequency_days: 30 })],
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.count).toEqual(1);

    expect(mockBatchSend).toHaveBeenCalledTimes(1);
    expect(batchOps).toHaveLength(2);

    const createOp = batchOps.find((o) => o.method === 'create');
    const updateOp = batchOps.find((o) => o.method === 'update');
    expect(createOp?.collection).toEqual('tasks');
    expect(updateOp?.collection).toEqual('homes');

    const body = createOp?.args[0] as Record<string, unknown>;
    expect(body.next_due_smoothed).toBeDefined();
    expect(typeof body.next_due_smoothed).toEqual('string');
    expect((body.next_due_smoothed as string).length).toBeGreaterThan(0);
    // ISO-parseable
    expect(new Date(body.next_due_smoothed as string).getTime()).toBeGreaterThan(0);
  });

  test('Test 3: 5 same-freq seeds (freq=30) → cohort distributes — Set.size of dates ≥ 4', async () => {
    const fn = await loadBatchCreateSeedTasks();
    const selections = Array.from({ length: 5 }, (_, i) =>
      makeSelection({
        seed_id: SEED_LIBRARY[i % SEED_LIBRARY.length].id,
        name: `Seed ${i}`,
        frequency_days: 30,
      }),
    );

    const result = await fn({ home_id: HOME_ID, selections });
    expect(result.ok).toBe(true);

    const creates = batchOps.filter(
      (o) => o.collection === 'tasks' && o.method === 'create',
    );
    expect(creates).toHaveLength(5);

    const dates = creates.map((c) => {
      const body = c.args[0] as { next_due_smoothed: string };
      return body.next_due_smoothed.slice(0, 10); // YYYY-MM-DD
    });
    const distinctDates = new Set(dates);
    expect(distinctDates.size).toBeGreaterThanOrEqual(4);
  });

  test('Test 4: 10 mixed-freq seeds (5×freq=7, 5×freq=365) → 11 ops, every create has non-empty next_due_smoothed', async () => {
    const fn = await loadBatchCreateSeedTasks();
    const selections = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeSelection({
          seed_id: SEED_LIBRARY[i].id,
          name: `Weekly ${i}`,
          frequency_days: 7,
        }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        makeSelection({
          seed_id: SEED_LIBRARY[i + 5].id,
          name: `Annual ${i}`,
          frequency_days: 365,
        }),
      ),
    ];

    const result = await fn({ home_id: HOME_ID, selections });
    expect(result.ok).toBe(true);

    expect(batchOps).toHaveLength(11);
    const creates = batchOps.filter(
      (o) => o.collection === 'tasks' && o.method === 'create',
    );
    expect(creates).toHaveLength(10);
    for (const c of creates) {
      const body = c.args[0] as { next_due_smoothed: string };
      expect(typeof body.next_due_smoothed).toEqual('string');
      expect(body.next_due_smoothed.length).toBeGreaterThan(0);
    }

    const updates = batchOps.filter(
      (o) => o.collection === 'homes' && o.method === 'update',
    );
    expect(updates).toHaveLength(1);
    const updateBody = updates[0].args[1] as { onboarded: boolean };
    expect(updateBody.onboarded).toEqual(true);
  });

  test('Test 5: third-seed placement throws → console.warn + that seed lands with empty next_due_smoothed; batch still sends', async () => {
    // Override: throw on the 3rd placeNextDue call only.
    let placeCall = 0;
    mockPlaceNextDue.mockReset().mockImplementation(
      (task, lastCompletion) => {
        placeCall += 1;
        if (placeCall === 3) {
          throw new Error('simulated placement failure');
        }
        const baseIso = (lastCompletion as { completed_at: string })
          .completed_at;
        const freq = (task as { frequency_days: number }).frequency_days;
        const natural = new Date(baseIso).getTime() + freq * 86400000;
        return new Date(natural + placeCall * 86400000); // spread
      },
    );

    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    const fn = await loadBatchCreateSeedTasks();
    const selections = Array.from({ length: 5 }, (_, i) =>
      makeSelection({
        seed_id: SEED_LIBRARY[i].id,
        name: `Seed ${i}`,
        frequency_days: 30,
      }),
    );

    const result = await fn({ home_id: HOME_ID, selections });
    expect(result.ok).toBe(true);

    expect(warnSpy).toHaveBeenCalled();
    expect(
      String(warnSpy.mock.calls[0][0]),
    ).toMatch(/\[batchCreateSeedTasks\] seed 2 placement failed/);

    expect(mockBatchSend).toHaveBeenCalledTimes(1);
    const creates = batchOps.filter(
      (o) => o.collection === 'tasks' && o.method === 'create',
    );
    expect(creates).toHaveLength(5);

    // Seed index 2 (3rd, 0-indexed) should have empty next_due_smoothed.
    const thirdBody = creates[2].args[0] as {
      next_due_smoothed: string;
      name: string;
    };
    expect(thirdBody.name).toEqual('Seed 2');
    expect(thirdBody.next_due_smoothed).toEqual('');

    // Other seeds have valid ISOs.
    for (const idx of [0, 1, 3, 4]) {
      const body = creates[idx].args[0] as { next_due_smoothed: string };
      expect(body.next_due_smoothed.length).toBeGreaterThan(0);
    }
  });

  test('SEAS-09: batchCreateSeedTasks threads active_from_month + active_to_month from SEED_LIBRARY into the tasks.create body', async () => {
    const fn = await loadBatchCreateSeedTasks();
    const result = await fn({
      home_id: HOME_ID,
      selections: [
        makeSelection({
          seed_id: 'seed-service-ac',
          name: 'Service AC',
          frequency_days: 365,
        }),
      ],
    });
    expect(result.ok).toBe(true);

    const createOp = batchOps.find(
      (o) => o.collection === 'tasks' && o.method === 'create',
    );
    expect(createOp).toBeDefined();
    const body = createOp!.args[0] as Record<string, unknown>;
    // seed-service-ac carries active_from_month=10, active_to_month=3 in
    // SEED_LIBRARY; threaded verbatim into the create body.
    expect(body.active_from_month).toBe(10);
    expect(body.active_to_month).toBe(3);
  });

  test('Test 6: SDST audit — no matches for the forbidden tokens in production code dirs', async () => {
    // Runtime grep via child_process. Scope: lib/ components/
    // pocketbase/ app/ with .ts/.tsx/.js/.jsx includes. This test file
    // legitimately contains the forbidden tokens (in JSDoc + the grep
    // pattern itself), so `tests/` is deliberately out of scope —
    // TCSEM-06 targets PRODUCTION code (D-12 final clause: Phase 18
    // cleans any remaining spec/docs references).
    //
    // Tokens are built via string concatenation so this test file
    // itself doesn't contain the literal forbidden substrings in a
    // way that future audits would flag.
    const { execSync } = await import('node:child_process');
    const t1 = 'seed' + '-' + 'stagger';
    const t2 = 'SD' + 'ST';
    const t3 = 'seed' + '_' + 'stagger';
    const pattern = `${t1}\\|${t2}\\|${t3}`;
    let stdout = '';
    try {
      stdout = execSync(
        `grep -rn "${pattern}" ` +
          '--include="*.ts" --include="*.tsx" ' +
          '--include="*.js" --include="*.jsx" ' +
          'lib/ components/ pocketbase/ app/ 2>/dev/null || true',
        { encoding: 'utf8' },
      );
    } catch {
      // grep exits non-zero when no matches — treat as empty result
    }
    const lines = stdout
      .split('\n')
      .filter((l) => l.trim().length > 0);
    expect(lines).toEqual([]);
  });
});
