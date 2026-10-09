import { describe, test, expect } from 'vitest';
import { taskSchema } from '@/lib/schemas/task';
import {
  effectivePreferredDays,
  narrowToPreferredDays,
  isInActiveWindow,
  nextWindowOpenDate,
} from '@/lib/task-scheduling';

/**
 * 11-01 Plan Task 3 — pure helper matrix for PREF + SEAS (OOFT-03,
 * PREF-01/02/04, SEAS-01/04) plus zod cross-field refinement cases.
 * ~18 cases. No PB, no clocks.
 *
 * File created by Plan 11-01; extended by Plan 11-02 with branch-
 * composition cases against the live computeNextDue signature once
 * the OOFT / seasonal branches land.
 */

describe('effectivePreferredDays (PREF-01)', () => {
  test('null → any', () => {
    expect(effectivePreferredDays({ preferred_days: null })).toBe('any');
  });
  test('undefined → any', () => {
    expect(effectivePreferredDays({ preferred_days: undefined })).toBe('any');
  });
  test('weekend passthrough', () => {
    expect(effectivePreferredDays({ preferred_days: 'weekend' })).toBe('weekend');
  });
  test('weekday passthrough', () => {
    expect(effectivePreferredDays({ preferred_days: 'weekday' })).toBe('weekday');
  });
});

describe('narrowToPreferredDays (PREF-02 / PREF-03 / PREF-04)', () => {
  // 2026-04-11 = Saturday, 2026-04-12 = Sunday, 2026-04-13 = Monday,
  // 2026-04-14 = Tuesday, 2026-04-15 = Wednesday (UTC-day basis).
  const sat = new Date('2026-04-11T00:00:00.000Z');
  const sun = new Date('2026-04-12T00:00:00.000Z');
  const mon = new Date('2026-04-13T00:00:00.000Z');
  const tue = new Date('2026-04-14T00:00:00.000Z');
  const wed = new Date('2026-04-15T00:00:00.000Z');

  test('any — identity (copy, not same reference)', () => {
    const input = [sat, mon, wed];
    const out = narrowToPreferredDays(input, 'any');
    expect(out).toEqual(input);
    expect(out).not.toBe(input); // shallow copy
  });

  test('narrow to weekend keeps Sat/Sun drops M-F (PREF-02)', () => {
    const out = narrowToPreferredDays([sat, sun, mon, tue], 'weekend');
    expect(out).toEqual([sat, sun]);
  });

  test('narrow to weekday drops Sat/Sun keeps M-F (PREF-02)', () => {
    const out = narrowToPreferredDays([sat, sun, mon, tue], 'weekday');
    expect(out).toEqual([mon, tue]);
  });

  test('narrow empty result when no match — PREF-03 caller-widens contract', () => {
    const out = narrowToPreferredDays([mon, tue, wed], 'weekend');
    expect(out).toEqual([]);
  });

  test('narrow identity — filter never produces earlier date (PREF-04)', () => {
    const input = [mon, tue, wed];
    const out = narrowToPreferredDays(input, 'weekday');
    // Every date in output is present in input (subset invariant) — filter
    // cannot synthesize dates, so result is guaranteed >= input's earliest.
    out.forEach((d) => {
      expect(input.some((i) => i.getTime() === d.getTime())).toBe(true);
    });
  });
});

describe('isInActiveWindow — non-wrap (from <= to)', () => {
  // Apr-Sep window (active_from=4, active_to=9).
  test('month=5 (May) → true', () => {
    expect(isInActiveWindow(5, 4, 9)).toBe(true);
  });
  test('month=3 (Mar) → false', () => {
    expect(isInActiveWindow(3, 4, 9)).toBe(false);
  });
  test('month=9 (Sep) boundary → true', () => {
    expect(isInActiveWindow(9, 4, 9)).toBe(true);
  });
  test('month=10 (Oct) just past → false', () => {
    expect(isInActiveWindow(10, 4, 9)).toBe(false);
  });
  test('single-month window (from===to)', () => {
    expect(isInActiveWindow(6, 6, 6)).toBe(true);
    expect(isInActiveWindow(7, 6, 6)).toBe(false);
  });
});

describe('isInActiveWindow — wrap (from > to, SEAS-04 / T-11-04)', () => {
  // Oct-Mar window (active_from=10, active_to=3).
  test('month=1 (Jan) wrap mid-winter → true', () => {
    expect(isInActiveWindow(1, 10, 3)).toBe(true);
  });
  test('month=3 (Mar) boundary → true', () => {
    expect(isInActiveWindow(3, 10, 3)).toBe(true);
  });
  test('month=4 (Apr) just past → false', () => {
    expect(isInActiveWindow(4, 10, 3)).toBe(false);
  });
  test('month=10 (Oct) boundary → true', () => {
    expect(isInActiveWindow(10, 10, 3)).toBe(true);
  });
  test('month=12 (Dec) mid-wrap → true', () => {
    expect(isInActiveWindow(12, 10, 3)).toBe(true);
  });
  test('month=7 (Jul) mid-dormant → false', () => {
    expect(isInActiveWindow(7, 10, 3)).toBe(false);
  });
});

describe('isInActiveWindow — degenerate', () => {
  test('from null → true (defense-in-depth)', () => {
    expect(isInActiveWindow(6, null, 9)).toBe(true);
  });
  test('to null → true (defense-in-depth)', () => {
    expect(isInActiveWindow(6, 4, null)).toBe(true);
  });
});

describe('nextWindowOpenDate', () => {
  test('now before window opens same year — targets same year from-month', () => {
    // Now = April 15, 2026 UTC; window Oct-Mar (from=10); home tz UTC.
    const now = new Date('2026-04-15T12:00:00.000Z');
    const result = nextWindowOpenDate(now, 10, 3, 'UTC');
    // nowMonth=4 < from=10 → same calendar year. Oct 1, 2026 00:00 UTC.
    expect(result.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  test('now after window opens this year — targets next year from-month', () => {
    // Now = November 1, 2026 UTC; window Oct-Mar (from=10).
    const now = new Date('2026-11-01T00:00:00.000Z');
    const result = nextWindowOpenDate(now, 10, 3, 'UTC');
    // nowMonth=11 >= from=10 → next year.
    expect(result.toISOString()).toBe('2027-10-01T00:00:00.000Z');
  });

  // The result must depend only on the timezone argument, never on the
  // host's local zone (run this file under a non-UTC TZ to exercise it).
  test('anchors to home-tz midnight regardless of host tz — Perth', () => {
    const now = new Date('2026-04-15T12:00:00Z');
    expect(nextWindowOpenDate(now, 10, 3, 'Australia/Perth').toISOString()).toBe(
      '2026-09-30T16:00:00.000Z',
    );
  });

  test('anchors to home-tz midnight regardless of host tz — New York', () => {
    const now = new Date('2026-02-01T00:00:00Z');
    expect(nextWindowOpenDate(now, 4, 9, 'America/New_York').toISOString()).toBe(
      '2026-04-01T04:00:00.000Z',
    );
  });
});

describe('taskSchema — Phase 11 zod refinements (OOFT-03, SEAS-01, T-11-01)', () => {
  const baseInput = {
    home_id: 'h1',
    area_id: 'a1',
    name: 'Test task',
    schedule_mode: 'cycle' as const,
    anchor_date: null,
  };

  test('zod OOFT — rejects one-off without due_date (D-01, T-11-01)', () => {
    const result = taskSchema.safeParse({
      ...baseInput,
      frequency_days: null,
      due_date: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === 'due_date');
      expect(issue).toBeDefined();
    }
  });

  test('zod OOFT — accepts one-off with due_date', () => {
    const result = taskSchema.safeParse({
      ...baseInput,
      frequency_days: null,
      due_date: '2026-05-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  test('zod OOFT — accepts past due_date (D-22 "I forgot this")', () => {
    const result = taskSchema.safeParse({
      ...baseInput,
      frequency_days: null,
      due_date: '2020-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  test('zod paired months — rejects one-set-one-null (D-11)', () => {
    const result = taskSchema.safeParse({
      ...baseInput,
      frequency_days: 7,
      active_from_month: 10,
      active_to_month: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path[0] === 'active_from_month',
      );
      expect(issue).toBeDefined();
    }
  });

  test('zod paired months — accepts both set', () => {
    const result = taskSchema.safeParse({
      ...baseInput,
      frequency_days: 7,
      active_from_month: 10,
      active_to_month: 3,
    });
    expect(result.success).toBe(true);
  });

  test('zod paired months — accepts both null', () => {
    const result = taskSchema.safeParse({
      ...baseInput,
      frequency_days: 7,
      active_from_month: null,
      active_to_month: null,
    });
    expect(result.success).toBe(true);
  });

  test('zod anchored+OOFT — rejected (refine 3, defense-in-depth)', () => {
    const result = taskSchema.safeParse({
      ...baseInput,
      frequency_days: null,
      due_date: '2026-05-01T00:00:00.000Z',
      schedule_mode: 'anchored',
      anchor_date: '2026-05-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path[0] === 'schedule_mode',
      );
      expect(issue).toBeDefined();
    }
  });
});

describe('Phase 14 (SEAS-08, D-04): anchored-warning projection math', () => {
  // Projection math verified against isInActiveWindow. The form's
  // AnchoredWarningAlert inlines the same projection loop (6 cycles
  // = anchor + k×freq for k=0..5), counts dormant, and shows the
  // amber alert iff the dormant ratio is STRICTLY > 0.5 (D-04).
  // These tests lock the two threshold-boundary scenarios that the
  // UI component would render under.

  function projectDormantRatio(
    anchorIso: string,
    freqDays: number,
    from: number,
    to: number,
  ): number {
    // Mirror of AnchoredWarningAlert's inlined math (bounded to 6
    // projections per D-04, O(1)). Kept as a test-local helper
    // rather than exported from the form component — projection is
    // a UI concern; the MATH it depends on (isInActiveWindow)
    // already has its own test coverage upstream.
    const anchor = new Date(anchorIso);
    let dormantCount = 0;
    for (let k = 0; k < 6; k++) {
      const projected = new Date(anchor.getTime() + k * freqDays * 86400000);
      const month = projected.getUTCMonth() + 1;
      if (!isInActiveWindow(month, from, to)) dormantCount++;
    }
    return dormantCount / 6;
  }

  test('anchor=2026-07-15, freq=365, window=Oct-Mar → all 6 projections in July (dormant) → ratio=1.0 → warning shown', () => {
    // anchor + k*365 days stays in July every cycle → 100% dormant
    // against an Oct-Mar window. Ratio strictly > 0.5 → warning.
    const ratio = projectDormantRatio('2026-07-15', 365, 10, 3);
    expect(ratio).toBe(1.0);
    expect(ratio > 0.5).toBe(true);
  });

  test('anchor=2026-11-15, freq=30, window=Oct-Mar → projections span Nov→Apr → at most 1/6 dormant → ratio<=0.5 → no warning', () => {
    // Projections: Nov 15, Dec 15, Jan 14, Feb 13, Mar 15, Apr 14.
    // Only the last (Apr) falls outside the Oct-Mar window → 1/6 ≈
    // 0.167. Ratio <= 0.5 → no warning (D-04 threshold is STRICTLY
    // greater than 50%).
    const ratio = projectDormantRatio('2026-11-15', 30, 10, 3);
    expect(ratio).toBeLessThanOrEqual(0.5);
    expect(ratio > 0.5).toBe(false);
  });
});
