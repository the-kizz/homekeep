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
 * Phase 23 SEC-04 — updateTask cross-verifies area_id belongs to the
 * task's home.
 *
 * Threat: a user who is a member of BOTH home A (which owns the task)
 * AND home B (a separate home) could previously forge an update with
 * `area_id = <area in home B>`. PB's tasks.updateRule gates the update
 * by membership (which the user has for home A) but does NOT enforce
 * the cross-table invariant area_id.home_id == task.home_id.
 *
 * Fix (lib/actions/tasks.ts updateTask): after fetching the task's
 * previous home_id for the assignee-diff path, also fetch the target
 * area and compare area.home_id against task.home_id. Mismatch yields
 * a friendly formError and the PB update never runs.
 *
 * Mock contract mirrors tests/unit/actions/tasks-tcsem.test.ts — PB
 * client stub returns whatever the test's getOne/getFullList/update
 * mocks produce; we assert on update call count + action return shape.
 */

const mockAssertMembership = vi.fn().mockResolvedValue(undefined);
const mockUpdate = vi.fn();
const mockGetOne = vi.fn();
const mockGetFullList = vi.fn();
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
      update: (...args: unknown[]) => mockUpdate(_name, ...args),
    }),
  }),
}));

vi.mock('@/lib/pocketbase-admin', () => ({
  createAdminClient: async () => ({}),
}));

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

async function loadUpdateTask() {
  return (await import('@/lib/actions/tasks')).updateTask;
}

function baseFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const defaults: Record<string, string> = {
    home_id: 'home-A-1234567890',
    area_id: 'area-A-1234567890',
    name: 'Vacuum living room',
    description: '',
    frequency_days: '14',
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

describe('updateTask SEC-04 cross-home area_id guard', () => {
  beforeEach(() => {
    mockAssertMembership.mockReset().mockResolvedValue(undefined);
    mockUpdate.mockReset().mockResolvedValue({ id: 'task-1' });
    mockGetOne.mockReset();
    mockGetFullList.mockReset().mockResolvedValue([]);
    mockRevalidatePath.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('rejects update when area_id belongs to a different home', async () => {
    // prev task in home A, forged area_id resolves to an area in home B.
    mockGetOne.mockImplementation(
      async (collection: string, id: string) => {
        if (collection === 'tasks') {
          return {
            id,
            home_id: 'home-A-1234567890',
            assigned_to_id: '',
            name: 'Vacuum living room',
          };
        }
        if (collection === 'areas') {
          return { id, home_id: 'home-B-OTHERHOMExx' };
        }
        return { id };
      },
    );

    const updateTask = await loadUpdateTask();
    const result = await updateTask(
      'task-1',
      { ok: false },
      baseFormData({ area_id: 'area-B-OTHERHOMExx' }),
    );

    expect(result).toEqual({
      ok: false,
      formError: 'Selected area does not belong to this home',
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('rejects update when area_id 404s (forged id)', async () => {
    mockGetOne.mockImplementation(
      async (collection: string, _id: string) => {
        if (collection === 'tasks') {
          return {
            id: 'task-1',
            home_id: 'home-A-1234567890',
            assigned_to_id: '',
            name: 'Vacuum living room',
          };
        }
        if (collection === 'areas') {
          throw new Error('not found');
        }
        return {};
      },
    );

    const updateTask = await loadUpdateTask();
    const result = await updateTask(
      'task-1',
      { ok: false },
      baseFormData({ area_id: 'area-forged-xyzxyz' }),
    );

    expect(result).toEqual({
      ok: false,
      formError: 'Selected area does not belong to this home',
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('happy path: area_id belongs to the same home → update proceeds', async () => {
    mockGetOne.mockImplementation(
      async (collection: string, id: string) => {
        if (collection === 'tasks') {
          return {
            id,
            home_id: 'home-A-1234567890',
            assigned_to_id: '',
            name: 'Vacuum living room',
          };
        }
        if (collection === 'areas') {
          return { id, home_id: 'home-A-1234567890' };
        }
        return { id };
      },
    );

    const updateTask = await loadUpdateTask();
    const result = await updateTask(
      'task-1',
      { ok: false },
      baseFormData({ area_id: 'area-A-DIFFERENTxx' }),
    );

    expect(result).toEqual({ ok: true });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const [collection, taskId, patch] = mockUpdate.mock.calls[0];
    expect(collection).toBe('tasks');
    expect(taskId).toBe('task-1');
    expect((patch as Record<string, unknown>).area_id).toBe(
      'area-A-DIFFERENTxx',
    );
  });
});
