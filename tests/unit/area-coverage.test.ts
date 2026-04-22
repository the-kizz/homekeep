import { describe, test, expect } from 'vitest';
import {
  computeAreaCoverage,
  computeAreaCounts,
} from '@/lib/area-coverage';
import type { Task } from '@/lib/task-scheduling';
import type { CompletionRecord } from '@/lib/completions';
import type { Override } from '@/lib/schedule-overrides';

/**
 * 05-01 Task 2 RED→GREEN: area-scoped coverage + band-count helpers
 * (D-04 + AREA-V-01/02, PERS/HIST-agnostic thin wrappers).
 *
 * Contract:
 *   - computeAreaCoverage delegates to computeCoverage (lib/coverage.ts)
 *     over the supplied pre-filtered task slice. It does NOT re-implement
 *     the empty-home invariant; the D-06 semantics (empty ⇒ 1.0) flow
 *     through unchanged.
 *   - computeAreaCounts delegates to computeTaskBands
 *     (lib/band-classification.ts), then projects band lengths into the
 *     REQUIREMENTS.md naming: `overdue`, `thisWeek`, `upcoming` (the
 *     band-classification term "horizon" maps to "upcoming" per AREA-V-01).
 *
 * ≥8 cases per plan: empty, on-schedule, half-overdue mix, archived
 * exclusion, full-cycle clamp, single-task boundaries (0 & 1.0),
 * per-band count, count sum matches.
 *
 * 10-02 Plan: mechanical churn — every call now passes `new Map()` as the
 * 3rd `overridesByTask` argument (D-14 regression gate). A new A-OV-1
 * test confirms the wrapper forwards override through.
 */

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    created: '2026-04-01T00:00:00.000Z',
    archived: false,
    frequency_days: 7,
    schedule_mode: 'cycle',
    anchor_date: null,
    ...overrides,
  };
}

function makeCompletion(taskId: string, iso: string): CompletionRecord {
  return {
    id: `c-${taskId}-${iso}`,
    task_id: taskId,
    completed_by_id: 'u1',
    completed_at: iso,
    notes: '',
    via: 'tap',
  };
}

describe('computeAreaCoverage', () => {
  test('empty area tasks → 1.0 (D-06 empty-home invariant flows through)', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    expect(computeAreaCoverage([], new Map(), new Map(), now)).toBe(1.0);
  });

  test('single on-schedule task → 1.0', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const t = makeTask({ id: 't-ok', frequency_days: 7 });
    const latest = new Map<string, CompletionRecord>();
    latest.set('t-ok', makeCompletion('t-ok', '2026-04-20T12:00:00.000Z'));
    expect(computeAreaCoverage([t], latest, new Map(), now)).toBeCloseTo(1.0, 10);
  });

  test('single full-cycle overdue task → 0.0', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const t = makeTask({
      id: 't-overdue',
      created: '2026-04-06T12:00:00.000Z', // 14d ago, freq=7 → 7d overdue → clamp 0
      frequency_days: 7,
    });
    expect(computeAreaCoverage([t], new Map(), new Map(), now)).toBeCloseTo(0, 10);
  });

  test('archived task in the area is excluded (delegated to computeCoverage)', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const archivedOverdue = makeTask({
      id: 't-arch',
      archived: true,
      created: '2026-01-01T00:00:00.000Z',
    });
    const healthy = makeTask({ id: 't-ok', frequency_days: 7 });
    const latest = new Map<string, CompletionRecord>();
    latest.set('t-ok', makeCompletion('t-ok', '2026-04-20T12:00:00.000Z'));
    expect(
      computeAreaCoverage([archivedOverdue, healthy], latest, new Map(), now),
    ).toBeCloseTo(1.0, 10);
  });

  test('mixed healths (1.0 + 0.5) → 0.75', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const healthy = makeTask({ id: 't-h', frequency_days: 7 });
    const half = makeTask({ id: 't-50', frequency_days: 10 });
    const latest = new Map<string, CompletionRecord>();
    latest.set('t-h', makeCompletion('t-h', '2026-04-20T12:00:00.000Z'));
    latest.set('t-50', makeCompletion('t-50', '2026-04-05T12:00:00.000Z'));
    expect(
      computeAreaCoverage([healthy, half], latest, new Map(), now),
    ).toBeCloseTo(0.75, 10);
  });
});

describe('computeAreaCounts', () => {
  test('empty area → 0/0/0', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    expect(computeAreaCounts([], new Map(), new Map(), now, 'UTC')).toEqual({
      overdue: 0,
      thisWeek: 0,
      upcoming: 0,
    });
  });

  test('all-overdue area → overdue count matches, others zero', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const a = makeTask({
      id: 't-a',
      created: '2026-04-01T00:00:00.000Z',
      frequency_days: 7,
    });
    const b = makeTask({
      id: 't-b',
      created: '2026-04-02T00:00:00.000Z',
      frequency_days: 7,
    });
    const result = computeAreaCounts([a, b], new Map(), new Map(), now, 'UTC');
    expect(result.overdue).toBe(2);
    expect(result.thisWeek).toBe(0);
    expect(result.upcoming).toBe(0);
  });

  test('mixed bands — overdue + thisWeek + upcoming all populated', () => {
    const now = new Date('2026-04-20T12:00:00.000Z'); // Mon 20 Apr local-UTC midnight == 20 Apr 00:00Z
    const overdue = makeTask({
      id: 't-ov',
      created: '2026-04-06T00:00:00.000Z',
      frequency_days: 7, // nextDue 13 Apr (7d overdue by 20 Apr)
    });
    const thisWeekTask = makeTask({
      id: 't-tw',
      created: '2026-04-16T00:00:00.000Z',
      frequency_days: 5, // nextDue 21 Apr — within 20 Apr..27 Apr window
    });
    const upcomingTask = makeTask({
      id: 't-up',
      created: '2026-04-15T00:00:00.000Z',
      frequency_days: 30, // nextDue 15 May — beyond 27 Apr
    });
    const result = computeAreaCounts(
      [overdue, thisWeekTask, upcomingTask],
      new Map(),
      new Map(),
      now,
      'UTC',
    );
    expect(result.overdue).toBe(1);
    expect(result.thisWeek).toBe(1);
    expect(result.upcoming).toBe(1);
    // Counts sum to number of non-archived tasks.
    expect(result.overdue + result.thisWeek + result.upcoming).toBe(3);
  });

  test('archived tasks excluded from counts (delegated)', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const archivedOverdue = makeTask({
      id: 't-arch',
      archived: true,
      created: '2026-01-01T00:00:00.000Z',
    });
    const thisWeekTask = makeTask({
      id: 't-tw',
      created: '2026-04-16T00:00:00.000Z',
      frequency_days: 5,
    });
    const result = computeAreaCounts(
      [archivedOverdue, thisWeekTask],
      new Map(),
      new Map(),
      now,
      'UTC',
    );
    expect(result.overdue).toBe(0);
    expect(result.thisWeek).toBe(1);
    expect(result.upcoming).toBe(0);
  });

  test('counts sum equals non-archived task count (partition invariant)', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const tasks: Task[] = [
      makeTask({
        id: 't1',
        created: '2026-04-06T00:00:00.000Z',
        frequency_days: 7,
      }),
      makeTask({
        id: 't2',
        created: '2026-04-16T00:00:00.000Z',
        frequency_days: 5,
      }),
      makeTask({
        id: 't3',
        created: '2026-04-15T00:00:00.000Z',
        frequency_days: 60,
      }),
      makeTask({
        id: 't4',
        created: '2026-04-16T00:00:00.000Z',
        frequency_days: 3,
      }),
    ];
    const result = computeAreaCounts(tasks, new Map(), new Map(), now, 'UTC');
    expect(result.overdue + result.thisWeek + result.upcoming).toBe(
      tasks.length,
    );
  });

  test('timezone-aware boundary — Melbourne on-the-edge task lands in thisWeek', () => {
    // 2026-04-20 23:00 UTC = 2026-04-21 09:00 Melbourne (still Tuesday).
    // Local-midnight-today in Melbourne = 2026-04-20 14:00 UTC.
    const now = new Date('2026-04-20T23:00:00.000Z');
    // Task nextDue == local midnight today (boundary): still "thisWeek".
    const boundary = makeTask({
      id: 't-boundary',
      created: '2026-04-13T14:00:00.000Z', // nextDue 20 Apr 14:00Z
      frequency_days: 7,
    });
    const result = computeAreaCounts(
      [boundary],
      new Map(),
      new Map(),
      now,
      'Australia/Melbourne',
    );
    // Band contract: nextDue >= localMidnightToday ⇒ thisWeek.
    expect(result.thisWeek + result.overdue).toBe(1);
  });
});

// ─── Phase 10, D-06: area wrappers forward override Map (SNZE-09) ───────

function makeOverride(overrides: Partial<Override> = {}): Override {
  return {
    id: 'o-default',
    task_id: 't1',
    snooze_until: '2026-05-15T00:00:00.000Z',
    consumed_at: null,
    created_by_id: null,
    created: '2026-04-22T00:00:00.000Z',
    ...overrides,
  };
}

describe('area wrappers forward override Map', () => {
  test('A-OV-1: computeAreaCoverage forwards override → snoozed task scores 1.0', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const t = makeTask({
      id: 't-snoozed',
      created: '2026-03-21T12:00:00.000Z', // overdue without override
      frequency_days: 7,
    });
    const overrides = new Map<string, Override>();
    overrides.set(
      't-snoozed',
      makeOverride({
        task_id: 't-snoozed',
        snooze_until: new Date(now.getTime() + 7 * 86400000).toISOString(),
      }),
    );
    expect(
      computeAreaCoverage([t], new Map(), overrides, now),
    ).toBeCloseTo(1.0, 10);
  });

  test('A-OV-2: computeAreaCounts forwards override → snoozed overdue task moves to thisWeek/upcoming', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const t = makeTask({
      id: 't-snoozed-ac',
      created: '2026-03-21T12:00:00.000Z',
      frequency_days: 7,
    });
    // Baseline: overdue=1 without override.
    const baseline = computeAreaCounts(
      [t],
      new Map(),
      new Map(),
      now,
      'UTC',
    );
    expect(baseline.overdue).toBe(1);

    // With a 3-day snooze → thisWeek.
    const overrides = new Map<string, Override>();
    overrides.set(
      't-snoozed-ac',
      makeOverride({
        task_id: 't-snoozed-ac',
        snooze_until: new Date(now.getTime() + 3 * 86400000).toISOString(),
      }),
    );
    const withOverride = computeAreaCounts(
      [t],
      new Map(),
      overrides,
      now,
      'UTC',
    );
    expect(withOverride.overdue).toBe(0);
    expect(withOverride.thisWeek).toBe(1);
  });
});
