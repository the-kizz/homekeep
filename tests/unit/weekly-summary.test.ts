import { describe, test, expect } from 'vitest';
import { computeWeeklySummary } from '@/lib/weekly-summary';
import type { Task } from '@/lib/task-scheduling';
import type { CompletionRecord } from '@/lib/completions';
import type { Override } from '@/lib/schedule-overrides';

/**
 * 06-01 Task 2 RED→GREEN: computeWeeklySummary pure fn (D-12, GAME-03).
 *
 * Returns:
 *   {
 *     completionsCount: number,           // completions within current week
 *     coveragePercent:  number,           // round(computeCoverage * 100)
 *     topArea:          string,           // area with most completions this week
 *     mostNeglectedTask: {id,name,daysOverdue} | null  // largest daysOverdue
 *   }
 *
 * Tie-break rules (locked by tests):
 *   - topArea ties → alphabetical by name.
 *   - mostNeglected ties on daysOverdue → newer `created` wins.
 *
 * Empty-home invariant (D-06) flows through: zero tasks → coverage 100.
 *
 * 10-02 Plan: mechanical churn — every call now passes `new Map()` as the
 * 4th `overridesByTask` argument (before `now`), matching the family
 * convention in coverage / band-classification / area-coverage. D-14
 * regression gate. One new test asserts the override thread-through.
 */

type TaskWithArea = Task & { area_id: string; name: string };

function t(overrides: Partial<TaskWithArea> = {}): TaskWithArea {
  return {
    id: 't1',
    created: '2026-01-01T00:00:00.000Z',
    archived: false,
    frequency_days: 7,
    schedule_mode: 'cycle',
    anchor_date: null,
    area_id: 'a-kitchen',
    name: 'Wipe benches',
    ...overrides,
  };
}

function c(taskId: string, iso: string, userId = 'u1'): CompletionRecord {
  return {
    id: `c-${taskId}-${iso}`,
    task_id: taskId,
    completed_by_id: userId,
    completed_at: iso,
    notes: '',
    via: 'tap',
  };
}

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

const TZ_UTC = 'UTC';
const TZ_MELB = 'Australia/Melbourne';
const NOW = new Date('2026-04-22T12:00:00.000Z'); // Wed 22 Apr, week starts Sun 19 Apr

describe('computeWeeklySummary', () => {
  test('empty inputs → zero counts, coverage 100, no-area label, null neglected', () => {
    const result = computeWeeklySummary([], [], [], new Map(), NOW, TZ_UTC);
    expect(result).toEqual({
      completionsCount: 0,
      coveragePercent: 100,
      topArea: 'No area',
      mostNeglectedTask: null,
    });
  });

  test('3 this-week completions across 2 areas → topArea = area with 2', () => {
    const tasks = [
      t({ id: 't-kitchen-1', area_id: 'a-kitchen' }),
      t({ id: 't-kitchen-2', area_id: 'a-kitchen' }),
      t({ id: 't-bath-1', area_id: 'a-bath' }),
    ];
    const areas = [
      { id: 'a-kitchen', name: 'Kitchen' },
      { id: 'a-bath', name: 'Bathroom' },
    ];
    const completions = [
      c('t-kitchen-1', '2026-04-20T09:00:00.000Z'),
      c('t-kitchen-2', '2026-04-21T09:00:00.000Z'),
      c('t-bath-1', '2026-04-21T10:00:00.000Z'),
    ];
    const result = computeWeeklySummary(
      completions,
      tasks,
      areas,
      new Map(),
      NOW,
      TZ_UTC,
    );
    expect(result.completionsCount).toBe(3);
    expect(result.topArea).toBe('Kitchen');
  });

  test('topArea ties broken alphabetically by name', () => {
    const tasks = [
      t({ id: 't-k', area_id: 'a-kitchen' }),
      t({ id: 't-b', area_id: 'a-bath' }),
    ];
    const areas = [
      { id: 'a-kitchen', name: 'Kitchen' },
      { id: 'a-bath', name: 'Bathroom' },
    ];
    const completions = [
      c('t-k', '2026-04-20T09:00:00.000Z'),
      c('t-b', '2026-04-21T10:00:00.000Z'),
    ];
    const result = computeWeeklySummary(
      completions,
      tasks,
      areas,
      new Map(),
      NOW,
      TZ_UTC,
    );
    // Kitchen and Bathroom both have 1 completion — alphabetical → Bathroom.
    expect(result.topArea).toBe('Bathroom');
  });

  test('one overdue 1-day task with NO completion yields 50% when paired with one on-time 1-day task', () => {
    // Task a: freq=1, created 14 days ago, no completion → nextDue = created+1d = 13 days ago
    //         → overdueDays = 13, clamped health = max(0, 1 - 13/1) = 0
    // Task b: freq=1, created 14 days ago, completed today → nextDue = today+1d (future), health=1
    const createdIso = new Date(NOW.getTime() - 14 * 86400000).toISOString();
    const tasks = [
      t({ id: 'overdue', frequency_days: 1, created: createdIso }),
      t({ id: 'ontime', frequency_days: 1, created: createdIso }),
    ];
    const areas = [{ id: 'a-kitchen', name: 'Kitchen' }];
    const completions = [
      c('ontime', new Date(NOW.getTime() - 3600_000).toISOString()),
    ];
    const result = computeWeeklySummary(
      completions,
      tasks,
      areas,
      new Map(),
      NOW,
      TZ_UTC,
    );
    // (0 + 1) / 2 = 0.5 → 50%
    expect(result.coveragePercent).toBe(50);
  });

  test('mostNeglected = task with largest daysOverdue (14d beats 3d)', () => {
    const createdIso = new Date(NOW.getTime() - 60 * 86400000).toISOString();
    const tasks = [
      t({
        id: 'very-overdue',
        name: 'Clean gutters',
        frequency_days: 30,
        created: createdIso,
        // no completion → nextDue = created + 30 = 30 days ago → overdue=30
      }),
      t({
        id: 'slightly-overdue',
        name: 'Mow lawn',
        frequency_days: 14,
        created: createdIso,
        // no completion → nextDue = created + 14 = 46 days ago → overdue=46
        // But we want 3d overdue, so use a recent completion
      }),
    ];
    const areas = [{ id: 'a-kitchen', name: 'Kitchen' }];
    // Make slightly-overdue actually have small overdue by giving it a recent
    // completion (3d ago on 14d freq → overdue=0 actually). Tweak so it's
    // 3d overdue: completion = 17 days ago + freq=14 → nextDue = 3d ago.
    const completions = [
      c(
        'slightly-overdue',
        new Date(NOW.getTime() - 17 * 86400000).toISOString(),
      ),
    ];
    const result = computeWeeklySummary(
      completions,
      tasks,
      areas,
      new Map(),
      NOW,
      TZ_UTC,
    );
    expect(result.mostNeglectedTask?.id).toBe('very-overdue');
    expect(result.mostNeglectedTask?.name).toBe('Clean gutters');
    expect(result.mostNeglectedTask!.daysOverdue).toBeGreaterThanOrEqual(29);
  });

  test('mostNeglected tie on daysOverdue → newer `created` wins', () => {
    // Two tasks with identical overdue-ness; tie-break by newer created.
    const olderCreated = new Date(NOW.getTime() - 40 * 86400000).toISOString();
    const newerCreated = new Date(NOW.getTime() - 20 * 86400000).toISOString();
    const tasks = [
      t({
        id: 'older',
        name: 'Older',
        frequency_days: 10,
        created: olderCreated,
      }),
      t({
        id: 'newer',
        name: 'Newer',
        frequency_days: 10,
        created: newerCreated,
      }),
    ];
    // Both: no completion → nextDue = created + 10d → overdue = ~30d and ~10d.
    // That's NOT a tie. Force the tie by giving both completions at the same
    // "days ago" relative to their frequency.
    const completions = [
      c('older', new Date(NOW.getTime() - 15 * 86400000).toISOString()), // overdue=5
      c('newer', new Date(NOW.getTime() - 15 * 86400000).toISOString()), // overdue=5
    ];
    const areas = [{ id: 'a-kitchen', name: 'Kitchen' }];
    const result = computeWeeklySummary(
      completions,
      tasks,
      areas,
      new Map(),
      NOW,
      TZ_UTC,
    );
    expect(result.mostNeglectedTask?.id).toBe('newer');
  });

  test('no tasks → mostNeglectedTask null + coverage 100', () => {
    const result = computeWeeklySummary(
      [],
      [],
      [{ id: 'a', name: 'Kitchen' }],
      new Map(),
      NOW,
      TZ_UTC,
    );
    expect(result.mostNeglectedTask).toBeNull();
    expect(result.coveragePercent).toBe(100);
  });

  test('completionsCount EXCLUDES completions from last week (just before weekStart)', () => {
    // Week starts Sun 19 Apr 00:00 UTC. A completion at Sat 18 Apr 23:00 UTC
    // is in LAST week and must not count.
    const tasks = [t({ id: 't-kitchen-1', area_id: 'a-kitchen' })];
    const areas = [{ id: 'a-kitchen', name: 'Kitchen' }];
    const completions = [
      c('t-kitchen-1', '2026-04-18T23:00:00.000Z'), // last week
      c('t-kitchen-1', '2026-04-20T09:00:00.000Z'), // this week
    ];
    const result = computeWeeklySummary(
      completions,
      tasks,
      areas,
      new Map(),
      NOW,
      TZ_UTC,
    );
    expect(result.completionsCount).toBe(1);
  });

  test('DST-safe week boundary (Melbourne, early April 2026)', () => {
    // Australia ends DST 3am Sun 5 Apr 2026. Test with `now` on Mon 6 Apr
    // 13:00 AEST. Week starts Sun 5 Apr 00:00 AEST (= Sat 4 Apr 14:00 UTC).
    const now = new Date('2026-04-06T03:00:00.000Z');
    const tasks = [t({ id: 't-k', area_id: 'a-k' })];
    const areas = [{ id: 'a-k', name: 'Kitchen' }];
    const completions = [
      c('t-k', '2026-04-05T10:00:00.000Z'), // Sun 5 Apr 20:00 AEDT/AEST
    ];
    const result = computeWeeklySummary(
      completions,
      tasks,
      areas,
      new Map(),
      now,
      TZ_MELB,
    );
    expect(result.completionsCount).toBe(1);
  });
});

// ─── Phase 10: override thread-through (SNZE-09 coverage + neglected) ───

describe('computeWeeklySummary with override', () => {
  test('W-OV-1: snoozed overdue task stops being most-neglected + stops pulling coverage down', () => {
    // Single task, no completions, 60d old, freq=30 → overdue=30d.
    // Without override: mostNeglectedTask set, coveragePercent clamped low.
    // With active override snooze_until = NOW + 7d: override wins in
    // computeNextDue, task moves to "due in 7d" → overdueDays=0 → not
    // neglected, and health=1.0 → coveragePercent=100.
    const createdIso = new Date(NOW.getTime() - 60 * 86400000).toISOString();
    const tasks = [
      t({
        id: 't-snoozed',
        name: 'Dust bookshelves',
        frequency_days: 30,
        created: createdIso,
        area_id: 'a-study',
      }),
    ];
    const areas = [{ id: 'a-study', name: 'Study' }];
    const completions: CompletionRecord[] = [];

    // Baseline (no override): neglected set, coverage 0%.
    const baseline = computeWeeklySummary(
      completions,
      tasks,
      areas,
      new Map(),
      NOW,
      TZ_UTC,
    );
    expect(baseline.mostNeglectedTask?.id).toBe('t-snoozed');
    expect(baseline.coveragePercent).toBe(0);

    // With override: neglected null, coverage 100%.
    const snoozeUntil = new Date(NOW.getTime() + 7 * 86400000).toISOString();
    const overrides = new Map<string, Override>();
    overrides.set(
      't-snoozed',
      makeOverride({ task_id: 't-snoozed', snooze_until: snoozeUntil }),
    );
    const withOverride = computeWeeklySummary(
      completions,
      tasks,
      areas,
      overrides,
      NOW,
      TZ_UTC,
    );
    expect(withOverride.mostNeglectedTask).toBeNull();
    expect(withOverride.coveragePercent).toBe(100);
  });
});
