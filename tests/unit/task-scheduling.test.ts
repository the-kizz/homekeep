import { describe, test, expect } from 'vitest';
import { addDays } from 'date-fns';
import {
  computeNextDue,
  normalizeMonth,
  type Task,
} from '@/lib/task-scheduling';
import {
  computeHouseholdLoad,
  placeNextDue,
} from '@/lib/load-smoothing';
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

  test('frequency 0 treated as OOFT marker (PB 0.37.1 cleared-NumberField storage reality)', () => {
    // Plan 11-03 integration finding: PB 0.37.1 stores a cleared
    // NumberField as `0` on the wire (not null), even after the D-02
    // `required: false` flip on the existing frequency_days field.
    // computeNextDue's OOFT branch therefore treats `0` the same as
    // `null` — both route to the OOFT branch where a no-completion task
    // returns its due_date (or null if unset). The app-layer zod schema
    // (tests/unit/schemas/task.test.ts) still rejects `0` at form-
    // submission time — this test locks the scheduler-runtime semantic
    // only, which is what flows through from PB storage. Without this
    // permissive runtime behavior, computeCoverage would throw whenever
    // iterating sibling tasks that happen to include an OOFT (Plan 11-03
    // Scenario 2 diagnostic).
    const task = makeTask({ frequency_days: 0 });
    const result = computeNextDue(
      task,
      null,
      new Date('2026-04-10T00:00:00.000Z'),
      undefined,
    );
    // No due_date on the fixture → OOFT with no target date → null.
    expect(result).toBeNull();
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

describe('branch composition matrix — LOAD-15 hard gate', () => {
  // Fixed reference point — 2026-05-01 UTC is a Friday.
  // (Verified by Plan 12-01 SUMMARY — prompt's original "Thursday" anchor
  // was corrected after NOW.getUTCDay() === 5 in Wave 1 test fixtures.)
  // This phase's anchor re-verifies: 2026-01-01 is Thu; Apr 30 is +119
  // → (119-1)%7=6 → Wed; May 1 = Fri. ✓
  const NOW = new Date('2026-05-01T00:00:00.000Z');
  const TZ = 'UTC';

  // Fixture builder — all Phase 11+12 fields pre-populated with null
  // defaults so test intent (which field matters) is explicit.
  function makeBranchTask(overrides: Partial<Task> = {}): Task {
    return {
      id: 't1',
      created: '2026-04-01T00:00:00.000Z',
      archived: false,
      frequency_days: 7,
      schedule_mode: 'cycle',
      anchor_date: null,
      due_date: null,
      preferred_days: null,
      active_from_month: null,
      active_to_month: null,
      next_due_smoothed: null,
      ...overrides,
    };
  }

  // ─── Branch precedence axis (Cases 1-6) ──────────────────────────────

  test('Case 1: archived wins over every other branch state', () => {
    const task = makeBranchTask({
      archived: true,
      next_due_smoothed: '2026-05-15T00:00:00.000Z',
      due_date: '2026-05-20T00:00:00.000Z',
      frequency_days: null,
    });
    const override: Override = {
      id: 'o1',
      task_id: 't1',
      snooze_until: '2026-05-10T00:00:00.000Z',
      consumed_at: null,
      created_by_id: 'u1',
      created: '2026-04-15T00:00:00.000Z',
    };
    expect(computeNextDue(task, null, NOW, override, TZ)).toBeNull();
  });

  test('Case 2: override wins over smoothed', () => {
    const task = makeBranchTask({
      next_due_smoothed: '2026-05-15T00:00:00.000Z',
    });
    const override: Override = {
      id: 'o1',
      task_id: 't1',
      snooze_until: '2026-05-20T00:00:00.000Z',
      consumed_at: null,
      created_by_id: 'u1',
      created: '2026-04-15T00:00:00.000Z',
    };
    const result = computeNextDue(task, null, NOW, override, TZ);
    expect(result?.toISOString()).toBe('2026-05-20T00:00:00.000Z');
  });

  test('Case 3: smoothed wins over seasonal-dormant (same-season)', () => {
    // In-window now (May in Apr-Sep window), in-window completion,
    // next_due_smoothed set → lastInPriorSeason=false → smoothed returns.
    const task = makeBranchTask({
      active_from_month: 4,
      active_to_month: 9,
      next_due_smoothed: '2026-05-15T00:00:00.000Z',
    });
    const completion = { completed_at: '2026-04-20T00:00:00.000Z' };
    const result = computeNextDue(task, completion, NOW, undefined, TZ);
    expect(result?.toISOString()).toBe('2026-05-15T00:00:00.000Z');
  });

  test('Case 4: seasonal-wakeup wins over smoothed (prior-season)', () => {
    // Oct-Mar window, no completion (first cycle = prior-season), stale
    // smoothed IGNORED — wake-up anchors to Oct 1 of this year (nowMonth
    // 5 < from 10 → same calendar year).
    const task = makeBranchTask({
      active_from_month: 10,
      active_to_month: 3,
      next_due_smoothed: '2026-05-15T00:00:00.000Z',
    });
    const result = computeNextDue(task, null, NOW, undefined, TZ);
    expect(result?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  test('Case 5: seasonal-dormant wins over OOFT', () => {
    // OOFT (freq=null) + seasonal window Oct-Mar + in-season (Jan)
    // completion + out-of-window now (July) → same-season dormant → null.
    const task = makeBranchTask({
      frequency_days: null,
      due_date: '2026-07-20T00:00:00.000Z',
      active_from_month: 10,
      active_to_month: 3,
    });
    const completion = { completed_at: '2026-01-10T00:00:00.000Z' };
    const july = new Date('2026-07-15T12:00:00.000Z');
    expect(computeNextDue(task, completion, july, undefined, TZ)).toBeNull();
  });

  test('Case 6: OOFT wins over cycle-natural', () => {
    const task = makeBranchTask({
      frequency_days: null,
      due_date: '2026-06-01T00:00:00.000Z',
    });
    const result = computeNextDue(task, null, NOW, undefined, TZ);
    expect(result?.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  // ─── Interaction axis (Cases 7-21) ───────────────────────────────────

  test('Case 7: override × smoothed × seasonal-dormant — override wins', () => {
    // Active override beats both smoothed AND dormant-seasonal (D-17).
    const task = makeBranchTask({
      next_due_smoothed: '2026-05-15T00:00:00.000Z',
      active_from_month: 10,
      active_to_month: 3,
    });
    const completion = { completed_at: '2026-01-10T00:00:00.000Z' };
    const override: Override = {
      id: 'o1',
      task_id: 't1',
      snooze_until: '2026-08-05T00:00:00.000Z',
      consumed_at: null,
      created_by_id: 'u1',
      created: '2026-07-20T00:00:00.000Z',
    };
    const july = new Date('2026-07-15T12:00:00.000Z');
    const result = computeNextDue(task, completion, july, override, TZ);
    expect(result?.toISOString()).toBe('2026-08-05T00:00:00.000Z');
  });

  test('Case 8: override × OOFT — override wins', () => {
    const task = makeBranchTask({
      frequency_days: null,
      due_date: '2026-06-01T00:00:00.000Z',
    });
    const override: Override = {
      id: 'o1',
      task_id: 't1',
      snooze_until: '2026-06-10T00:00:00.000Z',
      consumed_at: null,
      created_by_id: 'u1',
      created: '2026-05-15T00:00:00.000Z',
    };
    const result = computeNextDue(task, null, NOW, override, TZ);
    expect(result?.toISOString()).toBe('2026-06-10T00:00:00.000Z');
  });

  test('Case 9: smoothed × anchored (LOAD-06 bypass) — anchored wins', () => {
    // anchored + stale next_due_smoothed + anchor in past
    // → returns natural anchored date, NOT smoothed.
    // elapsed = May 1 − Jan 15 = 106 days. floor(106/30)+1 = 4 cycles.
    // Jan 15 + 4*30d = Jan 15 + 120d = May 15.
    const task = makeBranchTask({
      schedule_mode: 'anchored',
      anchor_date: '2026-01-15T00:00:00.000Z',
      frequency_days: 30,
      next_due_smoothed: '2026-05-20T00:00:00.000Z', // stale — must be ignored
    });
    const result = computeNextDue(task, null, NOW, undefined, TZ);
    expect(result?.toISOString()).toBe('2026-05-15T00:00:00.000Z');
    // Sanity: the smoothed date (May 20) is NOT what came back.
    expect(result?.toISOString()).not.toBe('2026-05-20T00:00:00.000Z');
  });

  test('Case 10: smoothed × PREF read-side (smoothed date falls on weekend)', () => {
    // 2026-05-09 is a Saturday. The smoother (Plan 12-01 T5) picks weekend
    // dates when preferred_days='weekend' on the WRITE side; this test
    // asserts the READ side returns the stored smoothed date verbatim.
    const task = makeBranchTask({
      preferred_days: 'weekend',
      next_due_smoothed: '2026-05-09T00:00:00.000Z',
    });
    const result = computeNextDue(task, null, NOW, undefined, TZ);
    expect(result?.toISOString()).toBe('2026-05-09T00:00:00.000Z');
    expect(result?.getUTCDay()).toBe(6); // Saturday
  });

  test('Case 11: smoothed × seasonal-wakeup first cycle — wakeup wins', () => {
    // Jun-Sep window, no completion → first cycle = prior-season.
    // Stale smoothed must be ignored; wake-up anchors to Jun 1 this year.
    const task = makeBranchTask({
      active_from_month: 6,
      active_to_month: 9,
      next_due_smoothed: '2026-05-15T00:00:00.000Z',
    });
    const result = computeNextDue(task, null, NOW, undefined, TZ);
    expect(result?.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  test('Case 12: smoothed × cycle-natural (v1.0 holdover NULL) — natural wins', () => {
    // cycle task + next_due_smoothed null (v1.0 row) + completion.
    // Apr 20 + 14d = May 4.
    const task = makeBranchTask({
      frequency_days: 14,
      next_due_smoothed: null,
    });
    const completion = { completed_at: '2026-04-20T00:00:00.000Z' };
    const result = computeNextDue(task, completion, NOW, undefined, TZ);
    expect(result?.toISOString()).toBe('2026-05-04T00:00:00.000Z');
  });

  test('Case 13: OOFT × archived (post-completion) — null', () => {
    const task = makeBranchTask({
      frequency_days: null,
      due_date: '2026-06-01T00:00:00.000Z',
      archived: true,
    });
    const completion = { completed_at: '2026-04-20T00:00:00.000Z' };
    expect(computeNextDue(task, completion, NOW, undefined, TZ)).toBeNull();
  });

  test('Case 14: OOFT contributes to load map but own smoothed stays null', () => {
    // computeHouseholdLoad includes OOFT's due_date.
    // placeNextDue called on OOFT throws (defense-in-depth from Plan 12-01).
    const ooft = makeBranchTask({
      id: 'ooft1',
      frequency_days: null,
      due_date: '2026-05-15T00:00:00.000Z',
    });
    const load = computeHouseholdLoad([ooft], new Map(), new Map(), NOW, 120, TZ);
    expect(load.get('2026-05-15')).toBe(1);
    // placeNextDue on OOFT throws per LOAD-09 defense-in-depth:
    expect(() => placeNextDue(ooft, null, load, NOW, { timezone: TZ })).toThrow(
      /LOAD-09/,
    );
  });

  test('Case 15: snoozed task contributes snooze_until to load map (LOAD-08)', () => {
    const task = makeBranchTask({ id: 'snoozed', frequency_days: 30 });
    const override: Override = {
      id: 'o1',
      task_id: 'snoozed',
      snooze_until: '2026-05-20T00:00:00.000Z',
      consumed_at: null,
      created_by_id: 'u1',
      created: '2026-04-15T00:00:00.000Z',
    };
    const overridesByTask = new Map<string, Override>([['snoozed', override]]);
    const load = computeHouseholdLoad(
      [task],
      new Map(),
      overridesByTask,
      NOW,
      120,
      TZ,
    );
    expect(load.get('2026-05-20')).toBe(1);
  });

  test('Case 16: anchored contributes natural date to load map (not smoothed)', () => {
    // anchored w/ stale smoothed; load map uses natural anchored date.
    // Same anchored arithmetic as Case 9 → May 15.
    const anchored = makeBranchTask({
      id: 'anch1',
      schedule_mode: 'anchored',
      anchor_date: '2026-01-15T00:00:00.000Z',
      frequency_days: 30,
      next_due_smoothed: '2026-05-20T00:00:00.000Z', // stale — must be ignored
    });
    const load = computeHouseholdLoad(
      [anchored],
      new Map(),
      new Map(),
      NOW,
      120,
      TZ,
    );
    expect(load.get('2026-05-15')).toBe(1);
    expect(load.get('2026-05-20')).toBeUndefined();
  });

  test('Case 17: post-completion — smoothed written via placement round-trips on read', () => {
    // Simulates Wave 3 batch: pre-completion smoothed is null; post
    // placement, smoothed = placedDate.toISOString(). Wave 2 read-side
    // picks up the freshly written date.
    const task = makeBranchTask({
      id: 't17',
      frequency_days: 7,
      next_due_smoothed: null,
    });
    const completion = { completed_at: '2026-04-30T00:00:00.000Z' };
    const load = new Map<string, number>();
    const placed = placeNextDue(task, completion, load, NOW, { timezone: TZ });
    // Natural ideal = Apr 30 + 7 = May 7. Empty load, no PREF → May 7.
    expect(placed.toISOString()).toBe('2026-05-07T00:00:00.000Z');

    // Simulate the batch write — spread a local copy for the read-side.
    const afterTask: Task = {
      ...task,
      next_due_smoothed: placed.toISOString(),
    };
    const read = computeNextDue(afterTask, completion, NOW, undefined, TZ);
    expect(read?.toISOString()).toBe(placed.toISOString());

    // Pre-completion read (stale task, smoothed still null) falls through
    // to natural cadence via the null-check in the smoothed branch:
    const pre = computeNextDue(task, completion, NOW, undefined, TZ);
    expect(pre?.toISOString()).toBe('2026-05-07T00:00:00.000Z');
  });

  test('Case 18: anchored bypass still contributes — map reflects anchored + cycle dates independently', () => {
    // Two tasks: anchored (bypass smoothing) + cycle (uses smoothed).
    // Load map must have BOTH dates, one for each task's contribution.
    const anchored = makeBranchTask({
      id: 'anch',
      schedule_mode: 'anchored',
      anchor_date: '2026-01-15T00:00:00.000Z',
      frequency_days: 30,
    });
    const cycle = makeBranchTask({
      id: 'cyc',
      frequency_days: 7,
      next_due_smoothed: '2026-05-09T00:00:00.000Z',
    });
    const load = computeHouseholdLoad(
      [anchored, cycle],
      new Map(),
      new Map(),
      NOW,
      120,
      TZ,
    );
    expect(load.get('2026-05-15')).toBe(1); // anchored natural
    expect(load.get('2026-05-09')).toBe(1); // cycle smoothed (Wave 2 reads it)
  });

  test('Case 19: seasonal-wakeup × anchored × PREF — seasonal wake-up fires (no smoothing, no PREF narrow)', () => {
    // Anchored + seasonal window Jun-Sep + preferred_days='weekend' all set.
    // The anchored-bypass guard skips the smoothed branch; the seasonal
    // branches STILL fire (they run after smoothed, regardless of mode),
    // and wake-up anchors to Jun 1 because no completion = prior-season.
    // Anchored "byte-identical v1.0" means no smoothing + no PREF narrowing
    // on the anchored cycle date — but the seasonal layer is independent.
    const task = makeBranchTask({
      schedule_mode: 'anchored',
      anchor_date: '2026-01-15T00:00:00.000Z',
      frequency_days: 30,
      active_from_month: 6,
      active_to_month: 9,
      preferred_days: 'weekend',
      next_due_smoothed: '2026-05-20T00:00:00.000Z',
    });
    const result = computeNextDue(task, null, NOW, undefined, TZ);
    expect(result?.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  test('Case 20: seasonal in-window past wake-up × smoothed — smoothed wins on second cycle', () => {
    // Apr-Sep window + completion in same season (Apr, in-window, <365d)
    // + in-window now (May 1) + next_due_smoothed set.
    // lastInPriorSeason=false (same season, 11d gap), so treatAsWakeup=false
    // → smoothed branch returns.
    const task = makeBranchTask({
      active_from_month: 4,
      active_to_month: 9,
      next_due_smoothed: '2026-05-25T00:00:00.000Z',
    });
    const completion = { completed_at: '2026-04-15T00:00:00.000Z' };
    const result = computeNextDue(task, completion, NOW, undefined, TZ);
    expect(result?.toISOString()).toBe('2026-05-25T00:00:00.000Z');
  });

  test('Case 21: empty-PREF-window widens forward to next weekend (PREF-03)', () => {
    // Completion Apr 29 (Wed) + freq=7 → naturalIdeal = May 6 (Wed).
    // tolerance=1 (options override) → candidates = [May 5 Tue, May 6 Wed,
    // May 7 Thu] — no weekends. PREF-03 widens forward from
    // naturalIdeal+tolerance=May 7:
    //   widen=1 → May 8 (Fri) → no match
    //   widen=2 → May 9 (Sat) → match → return May 9.
    const task = makeBranchTask({
      frequency_days: 7,
      preferred_days: 'weekend',
    });
    const completion = { completed_at: '2026-04-29T00:00:00.000Z' };
    const load = new Map<string, number>();
    const result = placeNextDue(task, completion, load, NOW, {
      tolerance: 1,
      preferredDays: 'weekend',
      timezone: TZ,
    });
    expect(result.toISOString()).toBe('2026-05-09T00:00:00.000Z');
    expect(result.getUTCDay()).toBe(6); // Saturday

    // Sanity: addDays / date-fns is used elsewhere; confirm Apr 29 was Wed.
    const completedAt = new Date('2026-04-29T00:00:00.000Z');
    expect(completedAt.getUTCDay()).toBe(3); // Wednesday
    expect(addDays(completedAt, 7).getUTCDay()).toBe(3); // May 6 also Wed
  });

  // ─── Phase 19 PATCH-01 regression — 0-vs-null storage reality ──────
  //
  // PB 0.37.1 round-trips a cleared NumberField as `0` on the wire.
  // Without normalizeMonth, (0, 0) diverges from (null, null) silently:
  // hasWindow evaluates true (0 != null), the seasonal branch fires
  // isInActiveWindow(month, 0, 0) which (pre-patch) returned
  // `month >= 0 && month <= 0` = false for every real month → the
  // task renders as same-season dormant (null) instead of year-round.

  test('Case 22 (PATCH-01): active_from=0, active_to=0 → natural cadence (fresh)', () => {
    const task = makeBranchTask({
      active_from_month: 0,
      active_to_month: 0,
      frequency_days: 7,
    });
    const result = computeNextDue(task, null, NOW, undefined, TZ);
    // base = task.created (2026-04-01) + 7 → 2026-04-08.
    expect(result?.toISOString()).toBe('2026-04-08T00:00:00.000Z');
  });

  // ─── Phase 19 PATCH-02 regression — fresh in-window guard ──────────
  //
  // Pre-patch the seasonal-wakeup branch fired unconditionally when
  // lastInPriorSeason was true. Fresh tasks have lastCompletion=null
  // which is definitionally prior-season, so a fresh task whose
  // CURRENT month was already in-window would render the NEXT year's
  // from-boundary (e.g. Nov fresh in 1..12 year-round-window → Jan 1
  // of next year) instead of the natural first cycle. PATCH-02 adds
  // a `&& !(inWindowNow && !lastCompletion)` guard.

  test('Case 23 (PATCH-02): active_from=1, active_to=12 fresh → natural first cycle', () => {
    // 1..12 = "every month active" = year-round via an explicit window.
    // nowMonth=5 (May, NOW=2026-05-01) is in-window, lastCompletion=null
    // → PATCH-02 guard suppresses wake-up (task is already awake);
    // natural cadence wins. Pre-patch this returned 2027-01-01.
    const task = makeBranchTask({
      active_from_month: 1,
      active_to_month: 12,
      frequency_days: 7,
    });
    const result = computeNextDue(task, null, NOW, undefined, TZ);
    expect(result?.toISOString()).toBe('2026-04-08T00:00:00.000Z');
  });

  test('Case 24 (PATCH-02): active_from=1, active_to=12 with completion → natural cycle', () => {
    // 1..12 year-round-via-explicit-window + in-window completion
    // (Apr 20, within 365d so same-season). lastInPriorSeason=false
    // → seasonal-dormant branch skipped (inWindowNow=true anyway) and
    // seasonal-wakeup branch skipped (!lastInPriorSeason) → falls
    // through to cycle. base = Apr 20 + 7 = Apr 27.
    const task = makeBranchTask({
      active_from_month: 1,
      active_to_month: 12,
      frequency_days: 7,
    });
    const completion = { completed_at: '2026-04-20T00:00:00.000Z' };
    const result = computeNextDue(task, completion, NOW, undefined, TZ);
    expect(result?.toISOString()).toBe('2026-04-27T00:00:00.000Z');
  });
});

// ─── Phase 19 PATCH-01 — normalizeMonth helper unit coverage ───────
describe('normalizeMonth helper (Phase 19 PATCH-01)', () => {
  test('0 → null (PB cleared-NumberField storage reality)', () => {
    expect(normalizeMonth(0)).toBeNull();
  });
  test('-1 → null (out of range low)', () => {
    expect(normalizeMonth(-1)).toBeNull();
  });
  test('13 → null (out of range high)', () => {
    expect(normalizeMonth(13)).toBeNull();
  });
  test("'foo' string → null (non-number type)", () => {
    expect(normalizeMonth('foo')).toBeNull();
  });
  test('1 → 1 (valid lower bound)', () => {
    expect(normalizeMonth(1)).toBe(1);
  });
  test('12 → 12 (valid upper bound)', () => {
    expect(normalizeMonth(12)).toBe(12);
  });
  test('null → null (passthrough)', () => {
    expect(normalizeMonth(null)).toBeNull();
  });
  test('undefined → null (passthrough)', () => {
    expect(normalizeMonth(undefined)).toBeNull();
  });
  test('3.5 non-integer → null', () => {
    expect(normalizeMonth(3.5)).toBeNull();
  });
});
