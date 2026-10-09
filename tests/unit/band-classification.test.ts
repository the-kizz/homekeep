import { describe, test, expect } from 'vitest';
import { computeTaskBands } from '@/lib/band-classification';
import type { Task } from '@/lib/task-scheduling';
import type { CompletionRecord } from '@/lib/completions';
import type { Override } from '@/lib/schedule-overrides';

/**
 * 03-01 Task 2 RED→GREEN: computeTaskBands pure function (Pattern 7, D-04/D-05).
 *
 * ≥10 cases per plan <behavior>:
 *  - Empty inputs → {overdue, thisWeek, horizon} all empty.
 *  - Archived tasks are excluded from ALL bands.
 *  - Cycle/anchored classification lands tasks in the correct band.
 *  - Timezone-aware boundary (Melbourne vs LA) — Pitfall 2 canonical case.
 *  - Sort orders: overdue by daysDelta ASC (most negative first),
 *    thisWeek / horizon by nextDue ASC.
 *
 * 10-02 Plan: mechanical churn — every call now passes `new Map()` as the
 * 3rd `overridesByTask` argument (D-14 regression gate). A new describe
 * block at the bottom covers SNZE-09 band-movement behavior.
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

describe('computeTaskBands', () => {
  test('empty inputs → all empty bands', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const bands = computeTaskBands([], new Map(), new Map(), now, 'UTC');
    expect(bands.overdue).toEqual([]);
    expect(bands.thisWeek).toEqual([]);
    expect(bands.horizon).toEqual([]);
  });

  test('archived task is excluded from every band', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const t = makeTask({
      id: 'archived-task',
      archived: true,
      created: '2026-03-01T00:00:00.000Z',
      frequency_days: 7,
    });
    const bands = computeTaskBands([t], new Map(), new Map(), now, 'UTC');
    expect(bands.overdue).toHaveLength(0);
    expect(bands.thisWeek).toHaveLength(0);
    expect(bands.horizon).toHaveLength(0);
  });

  test('cycle task never completed, freq=7, created 10 days ago → overdue', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const t = makeTask({
      id: 't-overdue',
      created: '2026-04-10T12:00:00.000Z', // 10 days ago
      frequency_days: 7,
    });
    const bands = computeTaskBands([t], new Map(), new Map(), now, 'UTC');
    expect(bands.overdue).toHaveLength(1);
    expect(bands.thisWeek).toHaveLength(0);
    expect(bands.horizon).toHaveLength(0);
    expect(bands.overdue[0].id).toBe('t-overdue');
  });

  test('cycle task completed 5 days ago, freq=7 → thisWeek (due in +2d)', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const t = makeTask({
      id: 't-thisweek',
      frequency_days: 7,
    });
    const latest = new Map<string, CompletionRecord>();
    latest.set(
      't-thisweek',
      makeCompletion('t-thisweek', '2026-04-15T12:00:00.000Z'),
    );
    const bands = computeTaskBands([t], latest, new Map(), now, 'UTC');
    expect(bands.overdue).toHaveLength(0);
    expect(bands.thisWeek).toHaveLength(1);
    expect(bands.horizon).toHaveLength(0);
    expect(bands.thisWeek[0].id).toBe('t-thisweek');
  });

  test('cycle task completed today, freq=30 → horizon (due +30d)', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const t = makeTask({
      id: 't-horizon',
      frequency_days: 30,
    });
    const latest = new Map<string, CompletionRecord>();
    latest.set(
      't-horizon',
      makeCompletion('t-horizon', '2026-04-20T10:00:00.000Z'),
    );
    const bands = computeTaskBands([t], latest, new Map(), now, 'UTC');
    expect(bands.overdue).toHaveLength(0);
    expect(bands.thisWeek).toHaveLength(0);
    expect(bands.horizon).toHaveLength(1);
    expect(bands.horizon[0].id).toBe('t-horizon');
  });

  test('anchored task with future anchor → horizon when anchor > now + 7d', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const t = makeTask({
      id: 't-anchored',
      schedule_mode: 'anchored',
      anchor_date: '2026-06-01T00:00:00.000Z', // ~6 weeks out
      frequency_days: 30,
    });
    const bands = computeTaskBands([t], new Map(), new Map(), now, 'UTC');
    expect(bands.overdue).toHaveLength(0);
    expect(bands.thisWeek).toHaveLength(0);
    expect(bands.horizon).toHaveLength(1);
  });

  test('Melbourne timezone — task due at 2026-04-20T14:30Z is tomorrow-local → thisWeek not overdue', () => {
    // Pitfall 2 canonical case. now = 2026-04-20T13:30Z (Melbourne local
    // 2026-04-20 23:30). A cycle task with next due computed from a
    // lastCompletion 6 days ago at 14:30Z so its next-due lands at
    // 2026-04-20T14:30Z (Melbourne local 2026-04-21 00:30). In Melbourne
    // that is TOMORROW — must land in thisWeek, NOT overdue.
    const now = new Date('2026-04-20T13:30:00.000Z');
    const t = makeTask({
      id: 't-mel',
      frequency_days: 7,
      schedule_mode: 'cycle',
    });
    // Last completed 6d and 23h before the target next-due, so the next-due lands
    // at 2026-04-20T14:30Z exactly (lastCompletion + 7d = 14:30Z).
    const latest = new Map<string, CompletionRecord>();
    latest.set('t-mel', makeCompletion('t-mel', '2026-04-13T14:30:00.000Z'));
    const bands = computeTaskBands([t], latest, new Map(), now, 'Australia/Melbourne');
    // Under Melbourne (UTC+10, no DST in autumn), the local day at now is
    // 2026-04-20; next-due 2026-04-20T14:30Z is 2026-04-21 00:30 local —
    // which is STRICTLY AFTER local midnight today, so thisWeek.
    expect(bands.overdue).toHaveLength(0);
    expect(bands.thisWeek).toHaveLength(1);
    expect(bands.horizon).toHaveLength(0);
  });

  test('America/Los_Angeles timezone — same task / clock would land in same band structure (timezone math DST-safe)', () => {
    // Complement to Melbourne test: under LA (UTC-7 in April), now
    // 2026-04-20T13:30Z is local 2026-04-20 06:30 → today = 2026-04-20.
    // nextDue 2026-04-20T14:30Z is local 2026-04-20 07:30 → same day,
    // so still thisWeek (>= local midnight today and < +7d).
    const now = new Date('2026-04-20T13:30:00.000Z');
    const t = makeTask({
      id: 't-la',
      frequency_days: 7,
      schedule_mode: 'cycle',
    });
    const latest = new Map<string, CompletionRecord>();
    latest.set('t-la', makeCompletion('t-la', '2026-04-13T14:30:00.000Z'));
    const bands = computeTaskBands([t], latest, new Map(), now, 'America/Los_Angeles');
    expect(bands.overdue).toHaveLength(0);
    expect(bands.thisWeek).toHaveLength(1);
    expect(bands.horizon).toHaveLength(0);
  });

  test('overdue sort — worst first (most-negative daysDelta first)', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    // Task A: created 12 days ago, freq=7 → overdue by ~5 days
    const taskA = makeTask({
      id: 't-A',
      created: '2026-04-08T12:00:00.000Z',
      frequency_days: 7,
    });
    // Task B: created 9 days ago, freq=7 → overdue by ~2 days
    const taskB = makeTask({
      id: 't-B',
      created: '2026-04-11T12:00:00.000Z',
      frequency_days: 7,
    });
    const bands = computeTaskBands([taskB, taskA], new Map(), new Map(), now, 'UTC');
    expect(bands.overdue).toHaveLength(2);
    // Worst (A, -5d-ish) must come first, B (-2d-ish) second.
    expect(bands.overdue[0].id).toBe('t-A');
    expect(bands.overdue[1].id).toBe('t-B');
  });

  test('thisWeek sort — soonest first (ASC by nextDue)', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    // Task DUE_SOON: completed 6 days ago, freq=7 → due in +1d
    const soon = makeTask({
      id: 't-soon',
      frequency_days: 7,
    });
    // Task DUE_LATER: completed 4 days ago, freq=7 → due in +3d
    const later = makeTask({
      id: 't-later',
      frequency_days: 7,
    });
    const latest = new Map<string, CompletionRecord>();
    latest.set('t-soon', makeCompletion('t-soon', '2026-04-14T12:00:00.000Z'));
    latest.set(
      't-later',
      makeCompletion('t-later', '2026-04-16T12:00:00.000Z'),
    );
    const bands = computeTaskBands([later, soon], latest, new Map(), now, 'UTC');
    expect(bands.thisWeek).toHaveLength(2);
    expect(bands.thisWeek[0].id).toBe('t-soon');
    expect(bands.thisWeek[1].id).toBe('t-later');
  });

  test('horizon sort — soonest first (ASC by nextDue)', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const t1 = makeTask({
      id: 't-30d',
      frequency_days: 30,
    });
    const t2 = makeTask({
      id: 't-90d',
      frequency_days: 90,
    });
    const latest = new Map<string, CompletionRecord>();
    latest.set('t-30d', makeCompletion('t-30d', '2026-04-20T10:00:00.000Z'));
    latest.set('t-90d', makeCompletion('t-90d', '2026-04-20T10:00:00.000Z'));
    const bands = computeTaskBands([t2, t1], latest, new Map(), now, 'UTC');
    expect(bands.horizon).toHaveLength(2);
    expect(bands.horizon[0].id).toBe('t-30d');
    expect(bands.horizon[1].id).toBe('t-90d');
  });

  test('mixed bands from one tasks array', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const overdueTask = makeTask({
      id: 't-overdue',
      created: '2026-04-05T00:00:00.000Z',
      frequency_days: 7,
    });
    const thisWeekTask = makeTask({
      id: 't-thisweek',
      frequency_days: 7,
    });
    const horizonTask = makeTask({
      id: 't-horizon',
      frequency_days: 30,
    });
    const archivedTask = makeTask({
      id: 't-archived',
      archived: true,
    });

    const latest = new Map<string, CompletionRecord>();
    latest.set(
      't-thisweek',
      makeCompletion('t-thisweek', '2026-04-16T12:00:00.000Z'),
    );
    latest.set(
      't-horizon',
      makeCompletion('t-horizon', '2026-04-20T00:00:00.000Z'),
    );

    const bands = computeTaskBands(
      [overdueTask, thisWeekTask, horizonTask, archivedTask],
      latest,
      new Map(),
      now,
      'UTC',
    );

    expect(bands.overdue.map((t) => t.id)).toEqual(['t-overdue']);
    expect(bands.thisWeek.map((t) => t.id)).toEqual(['t-thisweek']);
    expect(bands.horizon.map((t) => t.id)).toEqual(['t-horizon']);
  });
});

// ─── Phase 10, D-06 / D-08 / D-09: override band-movement (SNZE-09) ─────

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

describe('computeTaskBands with override (SNZE-09 band movement)', () => {
  test('B-OV-1: snoozed overdue task moves OUT of overdue → thisWeek or horizon', () => {
    // Without override: task created 30d ago, freq=7 → overdue band.
    // With override snooze_until = now+3d → thisWeek band (< now+7d).
    const now = new Date('2026-04-20T12:00:00.000Z');
    const t = makeTask({
      id: 't-snoozed',
      created: '2026-03-21T12:00:00.000Z', // 30d ago
      frequency_days: 7,
    });

    // Sanity baseline: without override → overdue.
    const withoutOverride = computeTaskBands(
      [t],
      new Map(),
      new Map(),
      now,
      'UTC',
    );
    expect(withoutOverride.overdue).toHaveLength(1);
    expect(withoutOverride.thisWeek).toHaveLength(0);

    // With override pointing 3 days out → thisWeek.
    const snoozeUntil = new Date(now.getTime() + 3 * 86400000).toISOString();
    const overrides = new Map<string, Override>();
    overrides.set(
      't-snoozed',
      makeOverride({ task_id: 't-snoozed', snooze_until: snoozeUntil }),
    );
    const withOverride = computeTaskBands(
      [t],
      new Map(),
      overrides,
      now,
      'UTC',
    );
    expect(withOverride.overdue).toHaveLength(0);
    expect(withOverride.thisWeek).toHaveLength(1);
    expect(withOverride.horizon).toHaveLength(0);
  });

  test('B-OV-2: snoozed overdue task with far-future snooze → horizon band', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const t = makeTask({
      id: 't-snoozed-far',
      created: '2026-03-21T12:00:00.000Z',
      frequency_days: 7,
    });
    // Snooze 30 days out → horizon (> now + 7d).
    const snoozeUntil = new Date(now.getTime() + 30 * 86400000).toISOString();
    const overrides = new Map<string, Override>();
    overrides.set(
      't-snoozed-far',
      makeOverride({ task_id: 't-snoozed-far', snooze_until: snoozeUntil }),
    );
    const bands = computeTaskBands([t], new Map(), overrides, now, 'UTC');
    expect(bands.overdue).toHaveLength(0);
    expect(bands.thisWeek).toHaveLength(0);
    expect(bands.horizon).toHaveLength(1);
  });

  test('B-OV-3: consumed override does NOT move task out of overdue', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const t = makeTask({
      id: 't-still-overdue',
      created: '2026-03-21T12:00:00.000Z',
      frequency_days: 7,
    });
    const overrides = new Map<string, Override>();
    overrides.set(
      't-still-overdue',
      makeOverride({
        task_id: 't-still-overdue',
        snooze_until: new Date(now.getTime() + 30 * 86400000).toISOString(),
        consumed_at: new Date(now.getTime() - 3600_000).toISOString(),
      }),
    );
    const bands = computeTaskBands([t], new Map(), overrides, now, 'UTC');
    expect(bands.overdue).toHaveLength(1);
  });
});
