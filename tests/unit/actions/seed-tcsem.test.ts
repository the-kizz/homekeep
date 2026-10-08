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
import { AREA_COLORS, AREA_ICONS } from '@/lib/area-palette';

/**
 * batchCreateSeedTasks unit tests (PB + ancillary modules mocked).
 *
 * Covers: schema rejection, batch shape (N creates + 1 homes.update),
 * cohort distribution through the load map, per-seed placement fallback,
 * the first-due stagger, library defaults for omitted overrides, seasonal
 * months by hemisphere, task/area quotas, and suggested-area resolution
 * (create once, reuse by name, fall back to Whole Home over quota).
 *
 * batchOps records every batch.collection(name).method(args) call;
 * areaCreates records direct (non-batch) areas.create calls.
 */

// ─── Module-level mock refs ──────────────────────────────────────────────
const mockAssertMembership = vi.fn().mockResolvedValue(undefined);
const mockGetFullList = vi.fn();
const mockGetOne = vi.fn();
const mockGetList = vi.fn();
const mockCreate = vi.fn();
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
      getList: (...args: unknown[]) => mockGetList(name, ...args),
      create: (...args: unknown[]) => mockCreate(name, ...args),
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
const AREA_ID = 'area1234567890x'; // 15 chars — the Whole Home area
const WHOLE_HOME = {
  id: AREA_ID,
  name: 'Whole Home',
  is_whole_home_system: true,
  sort_order: 0,
};

type Area =
  | { kind: 'existing'; id: string }
  | {
      kind: 'suggested';
      key: 'kitchen' | 'bathroom' | 'living' | 'yard' | 'whole_home';
    };

function makeSelection(
  overrides: Partial<{
    seed_id: string;
    name: string;
    frequency_days: number;
    area: Area;
  }> = {},
) {
  return {
    seed_id: SEED_LIBRARY[0].id, // real library id
    name: 'Test seed',
    frequency_days: 30,
    area: { kind: 'existing', id: AREA_ID } as Area,
    ...overrides,
  };
}

let homeTimezone = 'UTC';
let homeAreas: Array<Record<string, unknown>> = [];
let existingTaskCount = 0;
let areaCreates: Array<Record<string, unknown>> = [];

function taskCreates() {
  return batchOps
    .filter((o) => o.collection === 'tasks' && o.method === 'create')
    .map((o) => o.args[0] as Record<string, unknown>);
}

describe('batchCreateSeedTasks', () => {
  beforeEach(() => {
    batchOps = [];
    mockAssertMembership.mockReset().mockResolvedValue(undefined);
    mockGetFullList.mockReset();
    mockGetOne.mockReset();
    mockGetList.mockReset();
    mockCreate.mockReset();
    mockRevalidatePath.mockReset();
    mockPlaceNextDue.mockReset();
    mockComputeFirstIdealDate.mockReset();
    mockComputeHouseholdLoad.mockReset();
    mockBatchSend.mockReset().mockResolvedValue([]);

    // Default PB responses:
    //   - areas.getFullList → one area matching AREA_ID
    //   - tasks.getFullList → empty (fresh home)
    //   - homes.getOne → timezone=UTC
    homeTimezone = 'UTC';
    homeAreas = [WHOLE_HOME];
    existingTaskCount = 0;
    areaCreates = [];
    delete process.env.MAX_TASKS_PER_HOME;
    delete process.env.MAX_AREAS_PER_HOME;

    mockGetFullList.mockImplementation(async (name: string) => {
      if (name === 'areas') return homeAreas;
      if (name === 'tasks') {
        return Array.from({ length: existingTaskCount }, (_, i) => ({
          id: `task${String(i).padStart(11, '0')}`,
          created: new Date().toISOString(),
          archived: false,
          frequency_days: 7,
          schedule_mode: 'cycle',
          anchor_date: null,
        }));
      }
      return [];
    });
    mockGetList.mockImplementation(async (name: string) => {
      if (name === 'tasks') return { totalItems: existingTaskCount, items: [] };
      if (name === 'areas') {
        return {
          totalItems: homeAreas.filter((a) => !a.is_whole_home_system).length,
          items: [],
        };
      }
      return { totalItems: 0, items: [] };
    });
    mockCreate.mockImplementation(
      async (name: string, body: Record<string, unknown>) => {
        if (name !== 'areas') throw new Error(`unexpected create on ${name}`);
        const id = `newarea${String(areaCreates.length).padStart(8, '0')}`;
        const row = { id, ...body };
        areaCreates.push(row);
        homeAreas = [...homeAreas, row];
        return row;
      },
    );
    mockGetOne.mockImplementation(async (name: string, id: string) => {
      if (name === 'homes') return { id, timezone: homeTimezone };
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
    mockPlaceNextDue.mockImplementation(
      (task, lastCompletion, load: Map<string, number>) => {
        // baseISO = lastCompletion.completed_at (synthetic); naturalIdeal =
        // baseISO + freq = firstIdeal. Spread placements by load map
        // density — each subsequent call sees a denser map and lands on
        // a different -2..+2 day offset.
        const baseIso = (lastCompletion as { completed_at: string })
          .completed_at;
        const freq = (task as { frequency_days: number }).frequency_days;
        const natural = new Date(baseIso).getTime() + freq * 86400000;
        const spread = load.size; // grows as threading adds entries
        const offset = (spread % 5) - 2; // -2..+2 day spread
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
    if (result.ok) {
      expect(result.count).toEqual(1);
      expect(result.areasCreated).toEqual(0);
    }

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

  test('seasonal months follow the home hemisphere (UTC → north: aircon Apr–Sep)', async () => {
    const fn = await loadBatchCreateSeedTasks();
    const result = await fn({
      home_id: HOME_ID,
      selections: [makeSelection({ seed_id: 'seed-service-ac', frequency_days: 365 })],
    });
    expect(result.ok).toBe(true);
    const [body] = taskCreates();
    expect(body.active_from_month).toBe(4);
    expect(body.active_to_month).toBe(9);
  });

  test('seasonal months follow the home hemisphere (Australia/Perth → south)', async () => {
    homeTimezone = 'Australia/Perth';
    const fn = await loadBatchCreateSeedTasks();
    const result = await fn({
      home_id: HOME_ID,
      selections: [
        makeSelection({ seed_id: 'seed-service-ac' }),
        makeSelection({ seed_id: 'seed-service-heater' }),
        makeSelection({ seed_id: 'seed-wipe-benches' }),
      ],
    });
    expect(result.ok).toBe(true);
    const [ac, heater, benches] = taskCreates();
    expect([ac.active_from_month, ac.active_to_month]).toEqual([10, 3]);
    expect([heater.active_from_month, heater.active_to_month]).toEqual([4, 9]);
    expect([benches.active_from_month, benches.active_to_month]).toEqual(['', '']);
  });

  test('client-supplied seasonal months are ignored', async () => {
    const fn = await loadBatchCreateSeedTasks();
    await fn({
      home_id: HOME_ID,
      selections: [
        {
          ...makeSelection({ seed_id: 'seed-wipe-benches' }),
          active_from_month: 1,
          active_to_month: 2,
        } as ReturnType<typeof makeSelection>,
      ],
    });
    const [body] = taskCreates();
    expect(body.active_from_month).toBe('');
    expect(body.active_to_month).toBe('');
  });

  test('omitted name / frequency_days fall back to the library defaults', async () => {
    const seed = SEED_LIBRARY.find((s) => s.id === 'seed-clean-oven')!;
    const fn = await loadBatchCreateSeedTasks();
    const result = await fn({
      home_id: HOME_ID,
      selections: [
        { seed_id: seed.id, area: { kind: 'suggested', key: 'whole_home' } },
      ],
    });
    expect(result.ok).toBe(true);
    const [body] = taskCreates();
    expect(body.name).toBe(seed.name);
    expect(body.frequency_days).toBe(seed.frequency_days);
    expect(body.area_id).toBe(AREA_ID);
  });

  test('name override over 100 chars → formError, nothing written', async () => {
    const fn = await loadBatchCreateSeedTasks();
    const result = await fn({
      home_id: HOME_ID,
      selections: [makeSelection({ name: 'x'.repeat(101) })],
    });
    expect(result.ok).toBe(false);
    expect(mockBatchSend).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('unknown seed id → formError', async () => {
    const fn = await loadBatchCreateSeedTasks();
    const result = await fn({
      home_id: HOME_ID,
      selections: [makeSelection({ seed_id: 'seed-not-real' })],
    });
    expect(result).toEqual({ ok: false, formError: 'Unknown seed' });
  });

  test('existing area id from another home → formError', async () => {
    const fn = await loadBatchCreateSeedTasks();
    const result = await fn({
      home_id: HOME_ID,
      selections: [makeSelection({ area: { kind: 'existing', id: 'otherhomearea12' } })],
    });
    expect(result).toEqual({ ok: false, formError: 'Invalid area selected' });
    expect(mockBatchSend).not.toHaveBeenCalled();
  });

  test('495 existing tasks + 10 selections → task-limit formError, nothing written', async () => {
    existingTaskCount = 495;
    const fn = await loadBatchCreateSeedTasks();
    const selections = Array.from({ length: 10 }, (_, i) =>
      makeSelection({ seed_id: SEED_LIBRARY[i].id, area: { kind: 'suggested', key: 'kitchen' } }),
    );
    const result = await fn({ home_id: HOME_ID, selections });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.formError).toMatch(/task limit/);
    expect(mockBatchSend).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('home already at the task limit → task-limit formError', async () => {
    existingTaskCount = 500;
    const fn = await loadBatchCreateSeedTasks();
    const result = await fn({ home_id: HOME_ID, selections: [makeSelection()] });
    expect(result).toEqual({
      ok: false,
      formError: 'This home has reached its task limit',
    });
  });

  test('suggested areas are created once each, from the palette, after the current max sort_order', async () => {
    homeAreas = [WHOLE_HOME, { id: 'garageareaxxxxx', name: 'Garage', is_whole_home_system: false, sort_order: 4 }];
    const fn = await loadBatchCreateSeedTasks();
    const result = await fn({
      home_id: HOME_ID,
      selections: [
        makeSelection({ seed_id: 'seed-wipe-benches', area: { kind: 'suggested', key: 'kitchen' } }),
        makeSelection({ seed_id: 'seed-clean-sink', area: { kind: 'suggested', key: 'kitchen' } }),
        makeSelection({ seed_id: 'seed-clean-toilet', area: { kind: 'suggested', key: 'bathroom' } }),
        makeSelection({ seed_id: 'seed-test-rcd', area: { kind: 'suggested', key: 'whole_home' } }),
      ],
    });
    expect(result).toEqual({ ok: true, count: 4, areasCreated: 2 });
    expect(areaCreates.map((a) => a.name)).toEqual(['Kitchen', 'Bathroom']);
    expect(areaCreates.map((a) => a.sort_order)).toEqual([5, 6]);
    for (const a of areaCreates) {
      expect(a.scope).toBe('location');
      expect(a.is_whole_home_system).toBe(false);
      expect(AREA_ICONS as readonly string[]).toContain(a.icon);
      expect(AREA_COLORS as readonly string[]).toContain(a.color);
    }
    const [benches, sink, toilet, rcd] = taskCreates();
    expect(benches.area_id).toBe(areaCreates[0].id);
    expect(sink.area_id).toBe(areaCreates[0].id);
    expect(toilet.area_id).toBe(areaCreates[1].id);
    expect(rcd.area_id).toBe(AREA_ID);
  });

  test('a same-named existing area is reused (case-insensitive)', async () => {
    homeAreas = [WHOLE_HOME, { id: 'mykitchenareaxx', name: 'kitchen ', is_whole_home_system: false, sort_order: 1 }];
    const fn = await loadBatchCreateSeedTasks();
    const result = await fn({
      home_id: HOME_ID,
      selections: [makeSelection({ area: { kind: 'suggested', key: 'kitchen' } })],
    });
    expect(result).toEqual({ ok: true, count: 1, areasCreated: 0 });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(taskCreates()[0].area_id).toBe('mykitchenareaxx');
  });

  test('over the area quota → seeds land on Whole Home and areasCreated stays honest', async () => {
    process.env.MAX_AREAS_PER_HOME = '1';
    const fn = await loadBatchCreateSeedTasks();
    const result = await fn({
      home_id: HOME_ID,
      selections: [
        makeSelection({ seed_id: 'seed-wipe-benches', area: { kind: 'suggested', key: 'kitchen' } }),
        makeSelection({ seed_id: 'seed-clean-toilet', area: { kind: 'suggested', key: 'bathroom' } }),
      ],
    });
    expect(result).toEqual({ ok: true, count: 2, areasCreated: 1 });
    const [benches, toilet] = taskCreates();
    expect(benches.area_id).toBe(areaCreates[0].id);
    expect(toilet.area_id).toBe(AREA_ID);
  });

  test('first-due stagger: seed i is anchored (i % 4) quarter-cycles back; f ≤ 3 keeps the natural default', async () => {
    const fn = await loadBatchCreateSeedTasks();
    const selections = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeSelection({ seed_id: SEED_LIBRARY[i].id, frequency_days: 40 }),
      ),
      makeSelection({ seed_id: SEED_LIBRARY[5].id, frequency_days: 3 }),
    ];
    const before = Date.now();
    await fn({ home_id: HOME_ID, selections });

    const anchors = mockPlaceNextDue.mock.calls.map((c) =>
      new Date((c[1] as { completed_at: string }).completed_at).getTime(),
    );
    const daysBack = anchors.map((t) => Math.round((before - t) / 86400000) + 0);
    expect(daysBack.slice(0, 5)).toEqual([0, 10, 20, 30, 0]);
    // f=3: computeFirstIdealDate (mocked: now + 1 day) minus 3 days.
    expect(daysBack[5]).toBe(2);
    expect(mockComputeFirstIdealDate).toHaveBeenCalledTimes(1);
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
