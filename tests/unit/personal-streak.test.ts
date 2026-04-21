import { describe, test, expect } from 'vitest';
import { computePersonalStreak } from '@/lib/personal-streak';
import type { CompletionRecord } from '@/lib/completions';

/**
 * 05-01 Task 2 RED→GREEN: computePersonalStreak pure fn (D-08, PERS-03).
 *
 * Formula:
 *   Starting from the calendar week containing `now` (in the given IANA
 *   timezone), count consecutive weeks backward in which the user had
 *   ≥1 completion. Stop at the first week with zero.
 *
 * Timezone handling uses the same DST-safe idiom as band-classification.ts:
 *   localWeekStart = fromZonedTime(startOfWeek(toZonedTime(now, tz)), tz)
 * date-fns' default startOfWeek is Sunday; SPEC §8.4 uses Sunday-start for
 * the history range selector too, so both align.
 *
 * Callers must pre-filter completions to the user of interest — this fn
 * trusts its input and counts ALL supplied rows. Edge case 5 encodes that
 * contract.
 */

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

const TZ_UTC = 'UTC';
const TZ_MELB = 'Australia/Melbourne';

describe('computePersonalStreak', () => {
  test('empty completions → 0', () => {
    const now = new Date('2026-04-20T12:00:00.000Z'); // Monday
    expect(computePersonalStreak([], now, TZ_UTC)).toBe(0);
  });

  test('single completion this week (this week only) → 1', () => {
    const now = new Date('2026-04-22T12:00:00.000Z'); // Wed 22 Apr
    // Same week as now (Sun 19 Apr start, Sat 25 Apr end)
    const rows = [c('t1', '2026-04-21T09:00:00.000Z')];
    expect(computePersonalStreak(rows, now, TZ_UTC)).toBe(1);
  });

  test('this-week + last-week → 2', () => {
    const now = new Date('2026-04-22T12:00:00.000Z');
    const rows = [
      c('t1', '2026-04-21T09:00:00.000Z'), // this week
      c('t1', '2026-04-15T09:00:00.000Z'), // last week (Wed 15 Apr)
    ];
    expect(computePersonalStreak(rows, now, TZ_UTC)).toBe(2);
  });

  test('gap in the middle (weeks 0, 1, 3) → 2 (streak broke at week-2)', () => {
    const now = new Date('2026-04-22T12:00:00.000Z');
    const rows = [
      c('t1', '2026-04-22T09:00:00.000Z'), // week 0 (this week)
      c('t1', '2026-04-15T09:00:00.000Z'), // week 1 (last week)
      // week 2 gap (5-11 Apr) — no completion
      c('t1', '2026-04-02T09:00:00.000Z'), // week 3 — irrelevant, streak broken
    ];
    expect(computePersonalStreak(rows, now, TZ_UTC)).toBe(2);
  });

  test('continuous 5-week run → 5', () => {
    const now = new Date('2026-04-22T12:00:00.000Z');
    const rows = [
      c('t1', '2026-04-21T09:00:00.000Z'), // week 0
      c('t1', '2026-04-14T09:00:00.000Z'), // week 1
      c('t1', '2026-04-07T09:00:00.000Z'), // week 2
      c('t1', '2026-03-31T09:00:00.000Z'), // week 3
      c('t1', '2026-03-24T09:00:00.000Z'), // week 4
    ];
    expect(computePersonalStreak(rows, now, TZ_UTC)).toBe(5);
  });

  test('multiple completions in the same week count as one week (not double-counted)', () => {
    const now = new Date('2026-04-22T12:00:00.000Z');
    const rows = [
      c('t1', '2026-04-22T09:00:00.000Z'),
      c('t2', '2026-04-21T09:00:00.000Z'),
      c('t3', '2026-04-20T09:00:00.000Z'),
    ];
    expect(computePersonalStreak(rows, now, TZ_UTC)).toBe(1);
  });

  test('only completion is 2 weeks ago (current + last week empty) → 0', () => {
    const now = new Date('2026-04-22T12:00:00.000Z');
    const rows = [c('t1', '2026-04-05T09:00:00.000Z')]; // 2 weeks ago
    expect(computePersonalStreak(rows, now, TZ_UTC)).toBe(0);
  });

  test('trusts pre-filter — counts every input row regardless of completed_by_id', () => {
    // The function is fed whatever the caller passed; it does NOT re-filter
    // by user. If two users' completions slipped through, the function still
    // counts the set of weeks they cover.
    const now = new Date('2026-04-22T12:00:00.000Z');
    const rows = [
      c('t1', '2026-04-22T09:00:00.000Z', 'u1'),
      c('t2', '2026-04-15T09:00:00.000Z', 'u2'),
    ];
    expect(computePersonalStreak(rows, now, TZ_UTC)).toBe(2);
  });

  test('timezone-aware week boundary — Melbourne vs UTC differ when now is UTC Saturday morning', () => {
    // 2026-04-25 14:00 UTC = 2026-04-26 00:00 Melbourne (Sunday start of
    // NEW week in Melbourne) — a completion at 2026-04-25 23:59 UTC
    // (= 2026-04-26 09:59 Melbourne) sits in the current Melbourne week.
    // In UTC it would sit in last week (Saturday).
    const now = new Date('2026-04-25T14:00:00.000Z');
    const completionInBoth = c('t1', '2026-04-25T23:59:00.000Z');
    // Melbourne: completion is in current week (Sun 26 Apr).
    expect(computePersonalStreak([completionInBoth], now, TZ_MELB)).toBe(1);
  });

  test('DST end boundary (Melbourne 5 Apr 2026) — streak continues across 25h week', () => {
    // Australia ends DST early Sunday 5 April 2026 (3am → 2am). A streak
    // spanning the DST transition must not double-count or miss the week.
    const now = new Date('2026-04-06T03:00:00.000Z'); // Monday 6 Apr 13:00 Melb
    const rows = [
      c('t1', '2026-04-05T10:00:00.000Z'), // inside week-containing-DST-end (Melb Sun 20:00)
      c('t1', '2026-03-30T10:00:00.000Z'), // previous week (Melb Mon 21:00)
    ];
    // Both weeks count; 25h-long DST Sunday does not create a phantom 3rd.
    expect(computePersonalStreak(rows, now, TZ_MELB)).toBe(2);
  });

  test('returns 0 when every completion is older than the current week and last week', () => {
    const now = new Date('2026-04-22T12:00:00.000Z');
    const rows = [
      c('t1', '2026-01-01T09:00:00.000Z'),
      c('t1', '2025-12-15T09:00:00.000Z'),
    ];
    expect(computePersonalStreak(rows, now, TZ_UTC)).toBe(0);
  });
});
