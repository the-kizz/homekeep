import { describe, test, expect } from 'vitest';
import { addDays } from 'date-fns';
import { computeNextDue, type Task } from '@/lib/task-scheduling';
import type { Override } from '@/lib/schedule-overrides';

/**
 * 02-05 Task 1 RED → GREEN: computeNextDue pure function.
 *
 * Covers the 8 edge-case rows from RESEARCH §Pattern: Next-Due Computation
 * (lines 1204-1215) plus additional robustness cases for leap-year / DST /
 * invalid-frequency / archived / future completion.
 *
 * All tests use fixed Dates — never `new Date()` inside a test — so no CI
 * clock skew can cause flakiness. The implementation itself accepts `now`
 * as a parameter (testability guarantee).
 *
 * 10-02 Plan: mechanical churn — every pre-existing call now passes
 * `undefined` as the 4th `override?` argument (D-14 regression gate). A
 * new describe block at the bottom covers the override branch
 * (D-06 + D-10, SNZE-05).
 */

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    created: '2026-01-01T00:00:00.000Z',
    archived: false,
    frequency_days: 7,
    schedule_mode: 'cycle',
    anchor_date: null,
    ...overrides,
  };
}

describe('computeNextDue — cycle mode', () => {
  test('never completed, created today, freq=7 → created+7d', () => {
    const created = new Date('2026-04-01T00:00:00.000Z');
    const task = makeTask({
      created: created.toISOString(),
      frequency_days: 7,
      schedule_mode: 'cycle',
    });
    const now = created;
    const result = computeNextDue(task, null, now, undefined);
    expect(result).toEqual(addDays(created, 7));
  });

  test('last completed 2 days ago, freq=7 → lastCompletion+7d (= now+5d)', () => {
    const now = new Date('2026-04-10T00:00:00.000Z');
    const completedAt = addDays(now, -2);
    const task = makeTask({
      created: '2026-03-01T00:00:00.000Z',
      frequency_days: 7,
      schedule_mode: 'cycle',
    });
    const result = computeNextDue(
      task,
      { completed_at: completedAt.toISOString() },
      now,
      undefined,
    );
    expect(result).toEqual(addDays(completedAt, 7));
  });
});

describe('computeNextDue — anchored mode', () => {
  test('anchor in future → returns the anchor itself', () => {
    const now = new Date('2026-04-10T00:00:00.000Z');
    const anchor = addDays(now, 10);
    const task = makeTask({
      schedule_mode: 'anchored',
      anchor_date: anchor.toISOString(),
      frequency_days: 7,
    });
    const result = computeNextDue(task, null, now, undefined);
    expect(result).toEqual(anchor);
  });

  test('anchor today, freq=7, now=anchor → anchor+7d', () => {
    const anchor = new Date('2026-04-10T00:00:00.000Z');
    const task = makeTask({
      schedule_mode: 'anchored',
      anchor_date: anchor.toISOString(),
      frequency_days: 7,
    });
    const result = computeNextDue(task, null, anchor, undefined);
    expect(result).toEqual(addDays(anchor, 7));
  });

  test('anchor 30d ago, freq=7 → next cycle strictly after now (floor(30/7)+1 = 5 → anchor+35d)', () => {
    const now = new Date('2026-04-10T00:00:00.000Z');
    const anchor = addDays(now, -30);
    const task = makeTask({
      schedule_mode: 'anchored',
      anchor_date: anchor.toISOString(),
      frequency_days: 7,
    });
    const result = computeNextDue(task, null, now, undefined);
    expect(result).toEqual(addDays(anchor, 35)); // = now+5d
  });

  test('anchor 90d ago, freq=30 → anchor+120d (floor(90/30)+1 = 4 cycles)', () => {
    const now = new Date('2026-06-10T00:00:00.000Z');
    const anchor = addDays(now, -90);
    const task = makeTask({
      schedule_mode: 'anchored',
      anchor_date: anchor.toISOString(),
      frequency_days: 30,
    });
    const result = computeNextDue(task, null, now, undefined);
    // floor(90/30) + 1 = 4 cycles from anchor → anchor+120d = now+30d
    expect(result).toEqual(addDays(anchor, 120));
  });

  test('anchor exactly one full cycle ago → next cycle is anchor+2*freq', () => {
    // Exact-boundary case flagged in RESEARCH edge-case table — when
    // elapsed == freq exactly, floor(elapsed/freq)+1 = 2, so the next
    // due is two cycles out (we strictly step PAST now).
    const now = new Date('2026-04-10T00:00:00.000Z');
    const anchor = addDays(now, -7);
    const task = makeTask({
      schedule_mode: 'anchored',
      anchor_date: anchor.toISOString(),
      frequency_days: 7,
    });
    const result = computeNextDue(task, null, now, undefined);
    expect(result).toEqual(addDays(anchor, 14)); // = now+7d
  });
});

describe('computeNextDue — edge cases', () => {
  test('archived task returns null', () => {
    const task = makeTask({ archived: true });
    expect(computeNextDue(task, null, new Date('2026-04-10T00:00:00.000Z'), undefined)).toBeNull();
  });

  test('frequency 0 throws', () => {
    const task = makeTask({ frequency_days: 0 });
    expect(() =>
      computeNextDue(task, null, new Date('2026-04-10T00:00:00.000Z'), undefined),
    ).toThrow();
  });

  test('frequency 1.5 throws', () => {
    const task = makeTask({ frequency_days: 1.5 });
    expect(() =>
      computeNextDue(task, null, new Date('2026-04-10T00:00:00.000Z'), undefined),
    ).toThrow();
  });

  test('negative frequency throws', () => {
    const task = makeTask({ frequency_days: -5 });
    expect(() =>
      computeNextDue(task, null, new Date('2026-04-10T00:00:00.000Z'), undefined),
    ).toThrow();
  });

  test('DST transition day (Europe/London 2026-03-29) — UTC math unaffected', () => {
    // Internal math uses UTC-equivalent instants via date-fns; DST is a
    // RENDERING concern (see NextDueDisplay / formatInTimeZone).
    const anchor = new Date('2026-03-28T00:00:00.000Z');
    const now = new Date('2026-04-01T00:00:00.000Z');
    const task = makeTask({
      schedule_mode: 'anchored',
      anchor_date: anchor.toISOString(),
      frequency_days: 7,
    });
    const result = computeNextDue(task, null, now, undefined);
    // anchor+7d = 2026-04-04, regardless of DST.
    expect(result).toEqual(addDays(anchor, 7));
  });

  test('leap year — Feb 29 2028 anchor math works', () => {
    const anchor = new Date('2028-02-29T00:00:00.000Z');
    const now = new Date('2028-03-15T00:00:00.000Z');
    const task = makeTask({
      schedule_mode: 'anchored',
      anchor_date: anchor.toISOString(),
      frequency_days: 30,
    });
    const result = computeNextDue(task, null, now, undefined);
    // 15 days elapsed < 30, so first cycle lands at anchor+30d = 2028-03-30.
    expect(result).toEqual(addDays(anchor, 30));
  });

  test('cycle mode with lastCompletion in the future is still completedAt+freq (documented behavior)', () => {
    // Phase 3 may disallow future completions via UI; for now, follow the
    // math. If a completion record has a completed_at in the future, we
    // still compute next_due = that + freq. Business layer must validate
    // completion timestamps separately.
    const now = new Date('2026-04-10T00:00:00.000Z');
    const completedAt = addDays(now, 2);
    const task = makeTask({
      schedule_mode: 'cycle',
      frequency_days: 7,
    });
    const result = computeNextDue(
      task,
      { completed_at: completedAt.toISOString() },
      now,
      undefined,
    );
    expect(result).toEqual(addDays(completedAt, 7));
  });
});

// ─── Phase 10, D-06 + D-10: override branch ─────────────────────────────
//
// The override branch is the FIRST short-circuit after the archived /
// frequency-validation gates. An active, unconsumed override whose
// `snooze_until` post-dates the last completion REPLACES the natural
// next-due. Falsy consumed_at (null / '' / undefined) counts as active
// per A2 from Plan 10-01. Phase 12 will insert a `next_due_smoothed`
// LOAD branch between override and the cycle/anchored natural branches
// — the tests below assert override precedence against natural, not
// against LOAD (which doesn't exist yet).

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

describe('computeNextDue override branch (Phase 10, D-06 + D-10)', () => {
  test('O1: override wins over natural cycle next-due', () => {
    // freq=7, completed 1 day ago → natural next_due = now+6d.
    // Active override snooze_until = now+30d → override wins.
    const now = new Date('2026-04-22T00:00:00.000Z');
    const completedAt = addDays(now, -1);
    const task = makeTask({ frequency_days: 7, schedule_mode: 'cycle' });
    const snoozeUntilDate = addDays(now, 30);
    const override = makeOverride({
      snooze_until: snoozeUntilDate.toISOString(),
      consumed_at: null,
    });
    const result = computeNextDue(
      task,
      { completed_at: completedAt.toISOString() },
      now,
      override,
    );
    expect(result).toEqual(snoozeUntilDate);
    // And explicitly NOT the natural next-due:
    expect(result?.getTime()).not.toBe(addDays(completedAt, 7).getTime());
  });

  test('O2: consumed override is ignored → natural next-due wins', () => {
    const now = new Date('2026-04-22T00:00:00.000Z');
    const completedAt = addDays(now, -1);
    const task = makeTask({ frequency_days: 7, schedule_mode: 'cycle' });
    const consumedAt = new Date(now.getTime() - 3600_000).toISOString(); // 1h ago
    const override = makeOverride({
      snooze_until: addDays(now, 30).toISOString(),
      consumed_at: consumedAt,
    });
    const result = computeNextDue(
      task,
      { completed_at: completedAt.toISOString() },
      now,
      override,
    );
    // Expect the natural next-due: completedAt + 7d.
    expect(result).toEqual(addDays(completedAt, 7));
  });

  test('O3: D-10 read-time filter — snooze <= last completion → override stale, falls through', () => {
    // lastCompletion.completed_at = 2026-04-15 (later than snooze).
    // Override snooze_until = 2026-04-10 (before completion) → STALE.
    // Result must be the natural next-due, not the stale override date.
    const now = new Date('2026-04-22T00:00:00.000Z');
    const task = makeTask({ frequency_days: 7, schedule_mode: 'cycle' });
    const completedAt = '2026-04-15T00:00:00.000Z';
    const override = makeOverride({
      snooze_until: '2026-04-10T00:00:00.000Z',
      consumed_at: null,
    });
    const result = computeNextDue(
      task,
      { completed_at: completedAt },
      now,
      override,
    );
    // Natural next-due = completedAt + 7d = 2026-04-22.
    expect(result).toEqual(addDays(new Date(completedAt), 7));
    // Explicitly NOT the stale snooze date.
    expect(result?.toISOString()).not.toBe('2026-04-10T00:00:00.000Z');
  });

  test('O4: D-10 read-time filter — snooze > last completion → override wins', () => {
    const now = new Date('2026-04-22T00:00:00.000Z');
    const task = makeTask({ frequency_days: 7, schedule_mode: 'cycle' });
    const completedAt = '2026-04-15T00:00:00.000Z';
    const override = makeOverride({
      snooze_until: '2026-05-01T00:00:00.000Z',
      consumed_at: null,
    });
    const result = computeNextDue(
      task,
      { completed_at: completedAt },
      now,
      override,
    );
    expect(result).toEqual(new Date('2026-05-01T00:00:00.000Z'));
  });

  test('O5: override with null lastCompletion → always wins (no stale check applies)', () => {
    const now = new Date('2026-04-22T00:00:00.000Z');
    const task = makeTask({ frequency_days: 7, schedule_mode: 'cycle' });
    const snoozeUntilDate = addDays(now, 10);
    const override = makeOverride({
      snooze_until: snoozeUntilDate.toISOString(),
      consumed_at: null,
    });
    const result = computeNextDue(task, null, now, override);
    expect(result).toEqual(snoozeUntilDate);
  });

  test('O6: archived task + override → null (archived short-circuit runs first)', () => {
    const now = new Date('2026-04-22T00:00:00.000Z');
    const task = makeTask({ archived: true, frequency_days: 7 });
    const override = makeOverride({
      snooze_until: addDays(now, 10).toISOString(),
      consumed_at: null,
    });
    const result = computeNextDue(task, null, now, override);
    expect(result).toBeNull();
  });

  test('O7: anchored mode + override → override wins over anchored natural', () => {
    const now = new Date('2026-04-22T00:00:00.000Z');
    const task = makeTask({
      schedule_mode: 'anchored',
      anchor_date: '2026-06-01T00:00:00.000Z', // future anchor → natural would be the anchor itself
      frequency_days: 7,
    });
    const override = makeOverride({
      snooze_until: '2026-05-15T00:00:00.000Z', // earlier than the anchor
      consumed_at: null,
    });
    const result = computeNextDue(task, null, now, override);
    expect(result).toEqual(new Date('2026-05-15T00:00:00.000Z'));
  });

  test('O8: override param = undefined → identical to v1.0 behavior', () => {
    const now = new Date('2026-04-22T00:00:00.000Z');
    const completedAt = addDays(now, -1);
    const task = makeTask({ frequency_days: 7, schedule_mode: 'cycle' });
    const withUndefined = computeNextDue(
      task,
      { completed_at: completedAt.toISOString() },
      now,
      undefined,
    );
    const withoutArg = computeNextDue(
      task,
      { completed_at: completedAt.toISOString() },
      now,
    );
    expect(withUndefined).toEqual(withoutArg);
    expect(withUndefined).toEqual(addDays(completedAt, 7));
  });

  test('O9 (bonus A2 coverage): empty-string consumed_at counts as active', () => {
    // PB 0.37.1 may return '' for a fresh optional DateField. The override
    // branch uses `!override.consumed_at` so '' → active.
    const now = new Date('2026-04-22T00:00:00.000Z');
    const task = makeTask({ frequency_days: 7, schedule_mode: 'cycle' });
    const snoozeUntilDate = addDays(now, 14);
    const override = makeOverride({
      snooze_until: snoozeUntilDate.toISOString(),
      // Force the empty-string shape by casting around the type narrowing.
      consumed_at: '' as unknown as string | null,
    });
    const result = computeNextDue(task, null, now, override);
    expect(result).toEqual(snoozeUntilDate);
  });
});

// ─── Phase 11, D-05 + OOFT-05: OOFT branch ──────────────────────────────
//
// One-off tasks carry `frequency_days === null` and a concrete `due_date`.
// computeNextDue OOFT branch:
//   - no completion → returns due_date (or null if due_date is null — defensive)
//   - any completion → returns null (the completeTaskAction batch archives the
//     task atomically, so a reachable "completed OOFT" is a race-window only;
//     return null keeps the task invisible to the scheduler)
//   - past due_date is legitimate (D-22: "I forgot this, do it ASAP")

describe('computeNextDue — OOFT branch (D-05, OOFT-05)', () => {
  test('unborn OOFT (frequency_days=null, no completion) → returns due_date', () => {
    const now = new Date('2026-04-15T12:00:00.000Z');
    const task = makeTask({
      frequency_days: null,
      due_date: '2026-05-01T00:00:00.000Z',
    });
    const result = computeNextDue(task, null, now, undefined);
    expect(result?.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  test('unborn OOFT with null due_date → returns null', () => {
    const now = new Date('2026-04-15T00:00:00.000Z');
    const task = makeTask({
      frequency_days: null,
      due_date: null,
    });
    expect(() => computeNextDue(task, null, now, undefined)).not.toThrow();
    expect(computeNextDue(task, null, now, undefined)).toBeNull();
  });

  test('completed OOFT → returns null (archive semantic / race safety)', () => {
    const now = new Date('2026-05-05T00:00:00.000Z');
    const task = makeTask({
      frequency_days: null,
      due_date: '2026-05-01T00:00:00.000Z',
    });
    const result = computeNextDue(
      task,
      { completed_at: '2026-05-01T12:00:00.000Z' },
      now,
      undefined,
    );
    expect(result).toBeNull();
  });

  test('OOFT with past due_date → returns due_date (D-22; appears overdue immediately)', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    const task = makeTask({
      frequency_days: null,
      due_date: '2026-04-01T00:00:00.000Z', // 2 months ago
    });
    const result = computeNextDue(task, null, now, undefined);
    expect(result?.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });
});

// ─── Phase 11, D-12 + SEAS-02: seasonal-dormant branch ──────────────────
//
// When a task has a seasonal window AND now is outside it AND a prior
// completion exists, return null (invisible to scheduler / coverage).
// No-prior-completion case falls through to the wake-up branch.

describe('computeNextDue — seasonal dormant (D-12, SEAS-02)', () => {
  test('out-of-window with prior completion → null (Oct-Mar wrap, now=July)', () => {
    const now = new Date('2026-07-15T12:00:00.000Z'); // July — dormant for Oct-Mar
    const task = makeTask({
      frequency_days: 30,
      active_from_month: 10, // Oct
      active_to_month: 3, // Mar (wrap)
    });
    const result = computeNextDue(
      task,
      { completed_at: '2026-01-10T00:00:00.000Z' }, // completed in Jan (prior season)
      now,
      undefined,
      'UTC',
    );
    expect(result).toBeNull();
  });

  test('in-window with prior in-season completion → cycle branch (not null)', () => {
    const now = new Date('2026-11-15T12:00:00.000Z'); // November — inside Oct-Mar wrap
    const task = makeTask({
      frequency_days: 30,
      active_from_month: 10,
      active_to_month: 3,
    });
    const result = computeNextDue(
      task,
      { completed_at: '2026-11-01T00:00:00.000Z' }, // completed 14d ago in-season
      now,
      undefined,
      'UTC',
    );
    // Falls through to cycle branch: 2026-11-01 + 30d = 2026-12-01
    expect(result).not.toBeNull();
    expect(result?.toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  test('out-of-window without prior completion → wake-up branch (not dormant)', () => {
    const now = new Date('2026-07-15T12:00:00.000Z'); // July, outside Apr-Sep? no, IN Apr-Sep
    // Use a different window to force out-of-window: Jan-Mar
    const task = makeTask({
      frequency_days: 30,
      active_from_month: 1, // Jan
      active_to_month: 3, // Mar
    });
    const result = computeNextDue(task, null, now, undefined, 'UTC');
    // No completion → wake-up branch fires, returning Jan 1 of next year.
    expect(result).not.toBeNull();
    expect(result?.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});

// ─── Phase 11, D-12 + SEAS-03: seasonal-wakeup branch ───────────────────
//
// When a task has a seasonal window AND (no completion OR last completion
// in prior season), return the first-day-of-from-month-at-midnight in
// home timezone.

describe('computeNextDue — seasonal wake-up (D-12, SEAS-03)', () => {
  test('no completion + Apr-Sep window, now=Feb (UTC) → Apr 1 00:00 UTC', () => {
    const now = new Date('2026-02-15T12:00:00.000Z');
    const task = makeTask({
      frequency_days: 30,
      active_from_month: 4, // Apr
      active_to_month: 9, // Sep
    });
    const result = computeNextDue(task, null, now, undefined, 'UTC');
    expect(result?.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  test('last completion 400d ago (prior season) → next window open', () => {
    const now = new Date('2026-02-15T12:00:00.000Z');
    const task = makeTask({
      frequency_days: 30,
      active_from_month: 4,
      active_to_month: 9,
    });
    // 400d ago = 2025-01-11 → out-of-window (Jan), so wasInPriorSeason = true.
    const result = computeNextDue(
      task,
      { completed_at: '2025-01-11T00:00:00.000Z' },
      now,
      undefined,
      'UTC',
    );
    expect(result?.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  test('last completion in same active season → falls through to cycle branch', () => {
    // Both last-completion and now are in April (in-window, same season).
    const now = new Date('2026-04-20T12:00:00.000Z');
    const task = makeTask({
      frequency_days: 30,
      active_from_month: 4,
      active_to_month: 9,
    });
    const result = computeNextDue(
      task,
      { completed_at: '2026-04-10T00:00:00.000Z' },
      now,
      undefined,
      'UTC',
    );
    // Cycle branch: 2026-04-10 + 30d = 2026-05-10.
    expect(result?.toISOString()).toBe('2026-05-10T00:00:00.000Z');
  });

  test('wrap window (Oct-Mar), no completion, now=July → Oct 1 of current year', () => {
    const now = new Date('2026-07-15T12:00:00.000Z');
    const task = makeTask({
      frequency_days: 30,
      active_from_month: 10, // Oct
      active_to_month: 3, // Mar (wrap)
    });
    const result = computeNextDue(task, null, now, undefined, 'UTC');
    // nowMonth=7 < from=10 → same year, Oct 1 2026.
    expect(result?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  test('home-tz: Australia/Perth (+8) April 15 UTC noon, Oct-Mar wrap → Oct 1 Perth midnight (= Sep 30 16:00 UTC)', () => {
    // Perth is UTC+8, no DST. April 15 UTC 12:00 = April 15 20:00 Perth → month=4.
    // With Oct-Mar wrap + July-like month 4: nowMonth=4 < from=10 → same year.
    // Oct 1 2026 00:00 Perth = Sep 30 2026 16:00 UTC.
    const now = new Date('2026-04-15T12:00:00.000Z');
    const task = makeTask({
      frequency_days: 30,
      active_from_month: 10,
      active_to_month: 3,
    });
    const result = computeNextDue(
      task,
      null,
      now,
      undefined,
      'Australia/Perth',
    );
    expect(result?.toISOString()).toBe('2026-09-30T16:00:00.000Z');
  });
});

// ─── Phase 11, D-16 + D-17: branch composition ──────────────────────────
//
// D-16 branch order: archived → freq-validation (null-safe) → override →
// seasonal-dormant → seasonal-wakeup → OOFT → cycle → anchored.
// D-17: override wins over dormancy — user intent beats inferred dormancy.

describe('computeNextDue — branch composition (D-16, D-17)', () => {
  test('override on dormant seasonal task → override wins (D-17)', () => {
    const now = new Date('2026-07-15T12:00:00.000Z'); // July — dormant for Oct-Mar
    const task = makeTask({
      frequency_days: 30,
      active_from_month: 10,
      active_to_month: 3,
    });
    const override: Override = {
      id: 'o1',
      task_id: 't1',
      snooze_until: '2026-08-01T00:00:00.000Z',
      consumed_at: null,
      created_by_id: 'u1',
      created: '2026-07-10T00:00:00.000Z',
    };
    const result = computeNextDue(
      task,
      { completed_at: '2026-01-10T00:00:00.000Z' },
      now,
      override,
      'UTC',
    );
    // Override precedence: returns snooze_until, not null.
    expect(result?.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  test('archived task with all Phase 11 fields set → still returns null (archived > everything)', () => {
    const now = new Date('2026-04-15T12:00:00.000Z');
    const task = makeTask({
      archived: true,
      frequency_days: null,
      due_date: '2026-05-01T00:00:00.000Z',
      active_from_month: 10,
      active_to_month: 3,
    });
    const result = computeNextDue(task, null, now, undefined, 'UTC');
    expect(result).toBeNull();
  });

  test('OOFT with null due_date and null completion → returns null (not throw; freq-guard null-safe)', () => {
    const now = new Date('2026-04-15T00:00:00.000Z');
    const task = makeTask({
      frequency_days: null,
      due_date: null,
    });
    expect(() => computeNextDue(task, null, now, undefined)).not.toThrow();
  });

  test('seasonal-dormant wins over OOFT when completion in prior season (hybrid task, degenerate)', () => {
    // A task with BOTH frequency_days=null AND a seasonal window is
    // not a documented product shape (OOFT and seasonal are orthogonal),
    // but defense-in-depth: dormant branch fires before OOFT branch,
    // so a completed dormant OOFT returns null via dormant, not via OOFT.
    const now = new Date('2026-07-15T12:00:00.000Z');
    const task = makeTask({
      frequency_days: null,
      due_date: '2026-05-01T00:00:00.000Z',
      active_from_month: 10,
      active_to_month: 3,
    });
    const result = computeNextDue(
      task,
      { completed_at: '2026-01-10T00:00:00.000Z' },
      now,
      undefined,
      'UTC',
    );
    expect(result).toBeNull();
  });
});
