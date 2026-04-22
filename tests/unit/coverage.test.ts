import { describe, test, expect } from 'vitest';
import { computeCoverage } from '@/lib/coverage';
import type { Task } from '@/lib/task-scheduling';
import type { CompletionRecord } from '@/lib/completions';
import type { Override } from '@/lib/schedule-overrides';

/**
 * 03-01 Task 2 RED→GREEN: computeCoverage pure function (Pattern 8, D-06).
 *
 * Coverage = mean(per-task health) across non-archived tasks.
 * Per-task health = clamp(1 - max(0, (now - nextDue)/frequency_days), 0, 1).
 *
 * ≥8 cases per plan <behavior>:
 *  - Empty / all-archived → 1.0 (empty-home invariant D-06).
 *  - On-schedule task → health = 1.0 → coverage 1.0.
 *  - Full-cycle overdue → health = 0 → coverage 0.
 *  - Half-cycle overdue → health = 0.5.
 *  - Mix of healthy and overdue → correct mean.
 *  - Archived tasks are ignored.
 *  - Rounding / arithmetic sanity on three equal-weight tasks.
 *
 * 10-02 Plan: mechanical churn — every call now passes `new Map()` as the
 * 3rd `overridesByTask` argument (D-14 regression gate). A new describe
 * block at the bottom covers SNZE-09: a snoozed overdue task contributes
 * 1.0 health (snooze makes it not-yet-overdue).
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

describe('computeCoverage', () => {
  test('empty tasks array → 1.0 (empty-home invariant D-06)', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    expect(computeCoverage([], new Map(), new Map(), now)).toBe(1.0);
  });

  test('all tasks archived → 1.0 (no active tasks)', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const t = makeTask({ id: 't-a', archived: true });
    expect(computeCoverage([t], new Map(), new Map(), now)).toBe(1.0);
  });

  test('single on-schedule task (completed today) → 1.0', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const t = makeTask({ id: 't-healthy', frequency_days: 7 });
    const latest = new Map<string, CompletionRecord>();
    latest.set(
      't-healthy',
      makeCompletion('t-healthy', '2026-04-20T12:00:00.000Z'),
    );
    expect(computeCoverage([t], latest, new Map(), now)).toBeCloseTo(1.0, 10);
  });

  test('single task never completed, created 14d ago, freq=7 → health clamps to 0 → coverage 0', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const t = makeTask({
      id: 't-zero',
      created: '2026-04-06T12:00:00.000Z', // 14d ago; due 14d ago → 7d overdue, overdueRatio = 7/7 = 1 → clamps to 0.
      frequency_days: 7,
    });
    expect(computeCoverage([t], new Map(), new Map(), now)).toBeCloseTo(0, 10);
  });

  test('single task, freq=10, overdueDays=5 → health = 0.5', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    // Need nextDue = now - 5d = 2026-04-15T12:00Z. Use cycle mode with
    // lastCompletion = nextDue - 10d = 2026-04-05T12:00Z.
    const t = makeTask({
      id: 't-half',
      frequency_days: 10,
    });
    const latest = new Map<string, CompletionRecord>();
    latest.set('t-half', makeCompletion('t-half', '2026-04-05T12:00:00.000Z'));
    const cov = computeCoverage([t], latest, new Map(), now);
    expect(cov).toBeCloseTo(0.5, 10);
  });

  test('two tasks — one healthy + one 50% overdue → coverage 0.75', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const healthy = makeTask({
      id: 't-h',
      frequency_days: 7,
    });
    const half = makeTask({
      id: 't-50',
      frequency_days: 10,
    });
    const latest = new Map<string, CompletionRecord>();
    // Healthy: completed today → health 1.0
    latest.set('t-h', makeCompletion('t-h', '2026-04-20T12:00:00.000Z'));
    // Half-overdue: lastCompletion at now - 15d, freq=10 → nextDue at now-5d → overdueDays=5, ratio=0.5, health=0.5
    latest.set('t-50', makeCompletion('t-50', '2026-04-05T12:00:00.000Z'));
    const cov = computeCoverage([healthy, half], latest, new Map(), now);
    expect(cov).toBeCloseTo(0.75, 10);
  });

  test('one archived + one healthy → coverage is 1.0 (archived ignored)', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const archivedOverdue = makeTask({
      id: 't-arch',
      archived: true,
      created: '2026-01-01T00:00:00.000Z',
    });
    const healthy = makeTask({
      id: 't-ok',
      frequency_days: 7,
    });
    const latest = new Map<string, CompletionRecord>();
    latest.set('t-ok', makeCompletion('t-ok', '2026-04-20T12:00:00.000Z'));
    expect(
      computeCoverage([archivedOverdue, healthy], latest, new Map(), now),
    ).toBeCloseTo(1.0, 10);
  });

  test('three tasks with healths 1.0, 0.5, 0.0 → coverage = 0.5', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const tHealthy = makeTask({ id: 'th', frequency_days: 7 });
    const tHalf = makeTask({ id: 'thalf', frequency_days: 10 });
    const tZero = makeTask({
      id: 'tzero',
      frequency_days: 7,
      created: '2026-04-06T12:00:00.000Z', // 14d ago → full-cycle overdue → 0
    });
    const latest = new Map<string, CompletionRecord>();
    latest.set('th', makeCompletion('th', '2026-04-20T12:00:00.000Z'));
    latest.set('thalf', makeCompletion('thalf', '2026-04-05T12:00:00.000Z'));
    // tZero never completed.
    const cov = computeCoverage([tHealthy, tHalf, tZero], latest, new Map(), now);
    expect(cov).toBeCloseTo(0.5, 10);
  });

  test('clamps to 0 when overdueDays exceed frequency (e.g. 3x cycle overdue)', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const t = makeTask({
      id: 't-way-overdue',
      // Never completed, created 30d ago, freq=7 → nextDue = 23d ago,
      // overdueDays = 23, ratio = 23/7 ~= 3.29 → clamp to 0.
      created: '2026-03-21T12:00:00.000Z',
      frequency_days: 7,
    });
    expect(computeCoverage([t], new Map(), new Map(), now)).toBeCloseTo(0, 10);
  });

  test('early completion (before nextDue) → health clamps to 1.0 (no negative overdue)', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const t = makeTask({
      id: 't-early',
      frequency_days: 7,
    });
    const latest = new Map<string, CompletionRecord>();
    // Completed 1 day ago → nextDue = 6 days from now → overdueDays = max(0, -6) = 0
    latest.set('t-early', makeCompletion('t-early', '2026-04-19T12:00:00.000Z'));
    expect(computeCoverage([t], latest, new Map(), now)).toBeCloseTo(1.0, 10);
  });
});

// ─── Phase 10, D-06 / D-08 / D-09: override branch (SNZE-09) ────────────
//
// A snoozed overdue task must contribute 1.0 health to the coverage mean,
// not its pre-snooze overdue health. computeCoverage threads the override
// Map into computeNextDue which returns snooze_until, turning the task
// into "due in the future" relative to `now` — clamped to health=1.0.

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

describe('computeCoverage with override (SNZE-09)', () => {
  test('C-OV-1: snoozed overdue task contributes 1.0 health → coverage = 1.0', () => {
    // Without override: task created 30d ago, freq=7 → 23d overdue → health=0.
    // With override snooze_until = now+7d → next-due in the future → health=1.0.
    const now = new Date('2026-04-20T12:00:00.000Z');
    const t = makeTask({
      id: 't-snoozed',
      created: '2026-03-21T12:00:00.000Z', // 30d ago
      frequency_days: 7,
    });
    const snoozeUntil = new Date(now.getTime() + 7 * 86400000).toISOString();
    const overrides = new Map<string, Override>();
    overrides.set(
      't-snoozed',
      makeOverride({ task_id: 't-snoozed', snooze_until: snoozeUntil }),
    );
    expect(
      computeCoverage([t], new Map(), overrides, now),
    ).toBeCloseTo(1.0, 10);

    // Sanity: confirm that without the override, coverage is 0.
    expect(
      computeCoverage([t], new Map(), new Map(), now),
    ).toBeCloseTo(0, 10);
  });

  test('C-OV-2: consumed override does NOT resurrect (natural overdue health wins)', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const t = makeTask({
      id: 't-still-overdue',
      created: '2026-03-21T12:00:00.000Z', // 30d ago → full-cycle overdue → health=0
      frequency_days: 7,
    });
    const snoozeUntil = new Date(now.getTime() + 7 * 86400000).toISOString();
    const overrides = new Map<string, Override>();
    overrides.set(
      't-still-overdue',
      makeOverride({
        task_id: 't-still-overdue',
        snooze_until: snoozeUntil,
        consumed_at: new Date(now.getTime() - 3600_000).toISOString(),
      }),
    );
    expect(
      computeCoverage([t], new Map(), overrides, now),
    ).toBeCloseTo(0, 10);
  });

  test('C-OV-3: override with task_id not in overridesByTask falls through to natural', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const t = makeTask({ id: 't-untouched', frequency_days: 7 });
    const latest = new Map<string, CompletionRecord>();
    latest.set(
      't-untouched',
      makeCompletion('t-untouched', '2026-04-20T12:00:00.000Z'),
    );
    // overridesByTask has an entry for a DIFFERENT task id.
    const overrides = new Map<string, Override>();
    overrides.set(
      'other-task',
      makeOverride({ task_id: 'other-task' }),
    );
    expect(
      computeCoverage([t], latest, overrides, now),
    ).toBeCloseTo(1.0, 10);
  });
});

// ─── Phase 11, D-14 + SEAS-05: dormant filter ───────────────────────────
//
// Seasonal tasks whose active window does not include the current UTC
// month are excluded from the coverage mean — treated identically to
// archived tasks. "Lawn mowing is perfectly fine in winter."
// Year-round tasks (no active_from_month / active_to_month) are NOT
// affected — v1.0 row shape preserved.

describe('computeCoverage — dormant filter (D-14, SEAS-05)', () => {
  test('dormant seasonal task excluded from mean → coverage 1.0 (empty-home invariant)', () => {
    const now = new Date('2026-07-15T12:00:00.000Z'); // July — out of Oct-Mar
    const dormant = makeTask({
      id: 't-dormant',
      frequency_days: 30,
      active_from_month: 10, // Oct
      active_to_month: 3, // Mar (wrap)
    });
    // Only task is dormant → active list empty → 1.0 via empty-home invariant.
    expect(computeCoverage([dormant], new Map(), new Map(), now)).toBe(1.0);
  });

  test('year-round task (no window) NOT excluded — v1.0 shape preserved', () => {
    const now = new Date('2026-07-15T12:00:00.000Z');
    const yearRound = makeTask({
      id: 't-year',
      frequency_days: 7,
      // no active_from_month / active_to_month — v1.0 shape
    });
    const latest = new Map<string, CompletionRecord>();
    latest.set('t-year', makeCompletion('t-year', now.toISOString()));
    // On-schedule → health 1.0 → coverage 1.0
    expect(
      computeCoverage([yearRound], latest, new Map(), now),
    ).toBeCloseTo(1.0, 10);
  });

  test('mix: 1 dormant + 1 active-overdue → coverage reflects active-only mean (= 0)', () => {
    const now = new Date('2026-07-15T12:00:00.000Z');
    const dormant = makeTask({
      id: 't-dormant',
      frequency_days: 30,
      active_from_month: 10,
      active_to_month: 3,
    });
    const overdueYearRound = makeTask({
      id: 't-overdue',
      frequency_days: 7,
      // never completed, created 44d ago (2026-06-01) → nextDue = 2026-06-08
      // → 37d overdue → ratio 37/7 ≈ 5.3 → clamp 0
      created: '2026-06-01T00:00:00.000Z',
    });
    expect(
      computeCoverage([dormant, overdueYearRound], new Map(), new Map(), now),
    ).toBeCloseTo(0, 10);
  });

  test('in-window seasonal task included in mean (not excluded)', () => {
    const now = new Date('2026-11-15T12:00:00.000Z'); // November — in Oct-Mar wrap
    const inSeasonHealthy = makeTask({
      id: 't-in-season',
      frequency_days: 30,
      active_from_month: 10,
      active_to_month: 3,
    });
    const latest = new Map<string, CompletionRecord>();
    // Completed today → healthy
    latest.set(
      't-in-season',
      makeCompletion('t-in-season', now.toISOString()),
    );
    expect(
      computeCoverage([inSeasonHealthy], latest, new Map(), now),
    ).toBeCloseTo(1.0, 10);
  });
});

// ─── Phase 11, WR-01: OOFT division-by-null guard ───────────────────────
//
// OOFT tasks carry `frequency_days === null` (app-layer) or `0` (PB 0.37.1
// storage quirk) and reach computeCoverage via computeNextDue's OOFT
// branch returning `task.due_date` (a concrete Date) when the task has no
// completion yet. Dividing overdueDays by null/0 produces NaN (future due)
// or Infinity (past due) and corrupts the coverage mean. The WR-01 fix
// skips OOFT tasks in the per-task loop so they contribute no signal.

describe('computeCoverage — OOFT guard (WR-01)', () => {
  test('unborn OOFT (freq=null, future due_date) excluded from mean → 1.0 empty-home invariant', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const ooft = makeTask({
      id: 't-ooft',
      frequency_days: null as unknown as number,
      due_date: '2026-05-01T00:00:00.000Z',
    } as Partial<Task>);
    // Only task is an unborn OOFT → excluded → empty-home invariant → 1.0.
    // Without the fix this returns NaN.
    expect(computeCoverage([ooft], new Map(), new Map(), now)).toBe(1.0);
  });

  test('unborn OOFT (freq=0 PB storage quirk) excluded from mean → 1.0', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const ooft = makeTask({
      id: 't-ooft-zero',
      frequency_days: 0,
      due_date: '2026-05-01T00:00:00.000Z',
    } as Partial<Task>);
    expect(computeCoverage([ooft], new Map(), new Map(), now)).toBe(1.0);
  });

  test('unborn OOFT coexists with healthy recurring → mean of recurring only', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const healthy = makeTask({ id: 't-h', frequency_days: 7 });
    const ooft = makeTask({
      id: 't-o',
      frequency_days: null as unknown as number,
      due_date: '2026-05-01T00:00:00.000Z',
    } as Partial<Task>);
    const latest = new Map<string, CompletionRecord>();
    latest.set('t-h', makeCompletion('t-h', now.toISOString()));
    expect(
      computeCoverage([healthy, ooft], latest, new Map(), now),
    ).toBeCloseTo(1.0, 10);
  });

  test('unborn OOFT with PAST due_date coexists with overdue recurring → mean of recurring only (not Infinity)', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    // Recurring half-overdue — health 0.5
    const halfOverdue = makeTask({
      id: 't-half',
      frequency_days: 10,
    });
    // OOFT with past due_date — without the fix this makes 0/0=NaN or N/0=Inf
    const ooftPast = makeTask({
      id: 't-ooft-past',
      frequency_days: null as unknown as number,
      due_date: '2026-04-01T00:00:00.000Z',
    } as Partial<Task>);
    const latest = new Map<string, CompletionRecord>();
    latest.set('t-half', makeCompletion('t-half', '2026-04-05T12:00:00.000Z'));
    expect(
      computeCoverage([halfOverdue, ooftPast], latest, new Map(), now),
    ).toBeCloseTo(0.5, 10);
  });
});
