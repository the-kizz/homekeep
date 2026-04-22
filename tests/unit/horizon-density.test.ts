// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/conroyke56/homekeep

/**
 * Phase 16 Plan 01 Task 1 — Pure helpers unit tests (RED gate).
 *
 * Covers D-04 (strip-smoothed natural-baseline pattern) + D-10 (helper
 * signature + displacement threshold ≥1 day) + LVIZ-01/03/04 behavioral
 * contract for getIdealAndScheduled + computeMonthDensity.
 *
 * Deterministic fixtures:
 *   NOW = 2026-04-20T12:00:00Z
 *   TZ  = 'Australia/Perth' (UTC+08, no DST — matches Phase 14/15 precedent)
 */

import { describe, expect, test } from 'vitest';
import {
  getIdealAndScheduled,
  computeMonthDensity,
} from '@/lib/horizon-density';
import type { Task, Completion } from '@/lib/task-scheduling';

const NOW = new Date('2026-04-20T12:00:00Z');
const TZ = 'Australia/Perth';

// Helper to build a Task row with sensible defaults.
function mkTask(partial: Partial<Task> & { id: string }): Task {
  return {
    id: partial.id,
    created: partial.created ?? '2026-03-01T00:00:00Z',
    archived: partial.archived ?? false,
    frequency_days: partial.frequency_days ?? 14,
    schedule_mode: partial.schedule_mode ?? 'cycle',
    anchor_date: partial.anchor_date ?? null,
    due_date: partial.due_date ?? null,
    preferred_days: partial.preferred_days ?? null,
    active_from_month: partial.active_from_month ?? null,
    active_to_month: partial.active_to_month ?? null,
    next_due_smoothed: partial.next_due_smoothed ?? null,
    reschedule_marker: partial.reschedule_marker ?? null,
  };
}

describe('getIdealAndScheduled', () => {
  test('cycle task with next_due_smoothed different from natural returns displaced=true', () => {
    // lastCompletion = 2026-04-10 → natural ideal = 2026-04-24
    // next_due_smoothed = 2026-04-27 → diff = 3 days → displaced.
    const task = mkTask({
      id: 't1',
      frequency_days: 14,
      next_due_smoothed: '2026-04-27T00:00:00Z',
    });
    const last: Completion = { completed_at: '2026-04-10T00:00:00Z' };

    const result = getIdealAndScheduled(task, last, NOW, TZ);

    expect(result.ideal).not.toBeNull();
    expect(result.scheduled).not.toBeNull();
    expect(result.displaced).toBe(true);
    // Natural ideal = 2026-04-24 (lastCompleted + 14d)
    expect(result.ideal!.toISOString().slice(0, 10)).toBe('2026-04-24');
    // Scheduled = smoothed = 2026-04-27
    expect(result.scheduled!.toISOString().slice(0, 10)).toBe('2026-04-27');
  });

  test('cycle task with next_due_smoothed equal to natural returns displaced=false', () => {
    // natural ideal = 2026-04-10 + 14d = 2026-04-24 → smoothed matches.
    const task = mkTask({
      id: 't2',
      frequency_days: 14,
      next_due_smoothed: '2026-04-24T00:00:00Z',
    });
    const last: Completion = { completed_at: '2026-04-10T00:00:00Z' };

    const result = getIdealAndScheduled(task, last, NOW, TZ);

    expect(result.ideal).not.toBeNull();
    expect(result.scheduled).not.toBeNull();
    expect(result.displaced).toBe(false);
  });

  test('cycle task with next_due_smoothed null returns ideal === scheduled, displaced=false', () => {
    const task = mkTask({
      id: 't3',
      frequency_days: 14,
      next_due_smoothed: null,
    });
    const last: Completion = { completed_at: '2026-04-10T00:00:00Z' };

    const result = getIdealAndScheduled(task, last, NOW, TZ);

    expect(result.ideal).not.toBeNull();
    expect(result.scheduled).not.toBeNull();
    expect(result.ideal!.toISOString()).toBe(result.scheduled!.toISOString());
    expect(result.displaced).toBe(false);
  });

  test('anchored task (LOAD-06 bypass) — even if next_due_smoothed is set, scheduled === ideal', () => {
    // Anchored tasks consult the schedule_mode guard in computeNextDue —
    // the smoothed branch skips them by construction.
    const task = mkTask({
      id: 't4',
      schedule_mode: 'anchored',
      anchor_date: '2026-05-01T00:00:00Z',
      frequency_days: 30,
      next_due_smoothed: '2026-04-25T00:00:00Z', // arbitrary injected value
    });

    const result = getIdealAndScheduled(task, null, NOW, TZ);

    expect(result.ideal).not.toBeNull();
    expect(result.scheduled).not.toBeNull();
    // Both should land on the anchor date (May 1).
    expect(result.ideal!.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(result.scheduled!.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(result.displaced).toBe(false);
  });

  test('archived task returns ideal=null, scheduled=null, displaced=false', () => {
    const task = mkTask({
      id: 't5',
      archived: true,
      next_due_smoothed: '2026-04-27T00:00:00Z',
    });

    const result = getIdealAndScheduled(task, null, NOW, TZ);

    expect(result.ideal).toBeNull();
    expect(result.scheduled).toBeNull();
    expect(result.displaced).toBe(false);
  });

  test('dormant seasonal task (out-of-window, no prior-season completion) → null/null/false', () => {
    // active_from=10 (Oct), active_to=3 (Mar), NOW in April → dormant.
    // No completion = first-cycle = prior-season = wake-up branch returns
    // nextWindowOpenDate (NOT null). So for a TRUE dormant same-season
    // case, we need a completion *in* the current dormant window.
    // Setup: completion in April (dormant month) → prior-season check in
    // wasInPriorSeason returns true (lastMonth=4 not in 10..3 window),
    // so the wake-up branch fires → returns Oct 1 date (not null).
    //
    // To get a genuine null (same-season dormant), completion must be
    // IN the window and then now drifts out. active_from=4, active_to=9
    // (Apr-Sep), NOW in Oct, last completion in May → last in-window,
    // now out-of-window, same-season → null.
    const now = new Date('2026-10-15T12:00:00Z');
    const task = mkTask({
      id: 't6',
      active_from_month: 4,
      active_to_month: 9,
      frequency_days: 30,
    });
    const last: Completion = { completed_at: '2026-05-10T00:00:00Z' };

    const result = getIdealAndScheduled(task, last, now, TZ);

    expect(result.ideal).toBeNull();
    expect(result.scheduled).toBeNull();
    expect(result.displaced).toBe(false);
  });

  test('OOFT task (frequency_days=null) returns due_date for both ideal and scheduled, displaced=false', () => {
    const task = mkTask({
      id: 't7',
      frequency_days: null,
      due_date: '2026-05-15T00:00:00Z',
      next_due_smoothed: null,
    });

    const result = getIdealAndScheduled(task, null, NOW, TZ);

    expect(result.ideal).not.toBeNull();
    expect(result.scheduled).not.toBeNull();
    expect(result.ideal!.toISOString()).toBe('2026-05-15T00:00:00.000Z');
    expect(result.scheduled!.toISOString()).toBe('2026-05-15T00:00:00.000Z');
    expect(result.displaced).toBe(false);
  });
});

describe('computeMonthDensity', () => {
  test('returns Map<yyyy-MM, count> with tasks bucketed into their due month; excludes archived/dormant/null-schedulable', () => {
    // Tasks with varying next-due dates across April, May, June 2026.
    // lastCompletion-less tasks → computeNextDue from task.created + freq.
    const tasks: Task[] = [
      // Due 2026-04-29: created 2026-04-15 + 14d freq (no last completion)
      mkTask({
        id: 'a1',
        created: '2026-04-15T00:00:00Z',
        frequency_days: 14,
      }),
      // Due 2026-05-01: created 2026-04-01 + 30d
      mkTask({
        id: 'a2',
        created: '2026-04-01T00:00:00Z',
        frequency_days: 30,
      }),
      // Due 2026-05-15: created 2026-04-15 + 30d
      mkTask({
        id: 'a3',
        created: '2026-04-15T00:00:00Z',
        frequency_days: 30,
      }),
      // Due 2026-06-01: created 2026-05-02 + 30d
      mkTask({
        id: 'a4',
        created: '2026-05-02T00:00:00Z',
        frequency_days: 30,
      }),
      // Archived — should be excluded.
      mkTask({
        id: 'a5',
        archived: true,
        created: '2026-04-15T00:00:00Z',
        frequency_days: 14,
      }),
    ];

    const latestByTask = new Map<string, { completed_at: string }>();
    const density = computeMonthDensity(tasks, latestByTask, NOW, TZ);

    // 3 populated months: 2026-04 (a1), 2026-05 (a2+a3), 2026-06 (a4).
    expect(density.size).toBe(3);
    expect(density.get('2026-04')).toBe(1);
    expect(density.get('2026-05')).toBe(2);
    expect(density.get('2026-06')).toBe(1);
    // Archived not counted.
    expect(Array.from(density.values()).reduce((a, b) => a + b, 0)).toBe(4);
  });
});
