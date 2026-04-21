import { describe, test, expect } from 'vitest';
import { computeHouseholdStreak } from '@/lib/household-streak';
import type { CompletionRecord } from '@/lib/completions';

/**
 * 06-01 Task 2 RED→GREEN: computeHouseholdStreak pure fn (D-10, GAME-01).
 *
 * Contract: consecutive weeks back from the current week in which the
 * household had ≥1 completion by ANY member. Caller passes the union of
 * all members' completions — the function does NOT inspect completed_by_id.
 * Mirrors computePersonalStreak's algorithm; only the input contract differs.
 */

function c(
  taskId: string,
  iso: string,
  userId = 'u1',
): CompletionRecord {
  return {
    id: `c-${taskId}-${iso}-${userId}`,
    task_id: taskId,
    completed_by_id: userId,
    completed_at: iso,
    notes: '',
    via: 'tap',
  };
}

const TZ_UTC = 'UTC';
const TZ_MELB = 'Australia/Melbourne';

describe('computeHouseholdStreak', () => {
  test('empty completions → 0', () => {
    const now = new Date('2026-04-22T12:00:00.000Z');
    expect(computeHouseholdStreak([], now, TZ_UTC)).toBe(0);
  });

  test('single completion this week by any member → 1', () => {
    const now = new Date('2026-04-22T12:00:00.000Z');
    const rows = [c('t1', '2026-04-21T09:00:00.000Z', 'alice')];
    expect(computeHouseholdStreak(rows, now, TZ_UTC)).toBe(1);
  });

  test('this + last + 2-weeks-ago (continuous) → 3', () => {
    const now = new Date('2026-04-22T12:00:00.000Z');
    const rows = [
      c('t1', '2026-04-21T09:00:00.000Z'), // week 0
      c('t1', '2026-04-15T09:00:00.000Z'), // week 1
      c('t1', '2026-04-07T09:00:00.000Z'), // week 2
    ];
    expect(computeHouseholdStreak(rows, now, TZ_UTC)).toBe(3);
  });

  test('gap breaks streak (this + 2-weeks-ago, no last week) → 1', () => {
    const now = new Date('2026-04-22T12:00:00.000Z');
    const rows = [
      c('t1', '2026-04-21T09:00:00.000Z'), // week 0
      // week 1 gap
      c('t1', '2026-04-07T09:00:00.000Z'), // week 2 (irrelevant)
    ];
    expect(computeHouseholdStreak(rows, now, TZ_UTC)).toBe(1);
  });

  test('only last-week completion (current week empty) → 0', () => {
    const now = new Date('2026-04-22T12:00:00.000Z');
    const rows = [c('t1', '2026-04-15T09:00:00.000Z')];
    expect(computeHouseholdStreak(rows, now, TZ_UTC)).toBe(0);
  });

  test('4-week streak by 3 different members (any member counts)', () => {
    const now = new Date('2026-04-22T12:00:00.000Z');
    const rows = [
      c('t1', '2026-04-21T09:00:00.000Z', 'alice'), // week 0
      c('t2', '2026-04-15T09:00:00.000Z', 'bob'),   // week 1
      c('t3', '2026-04-07T09:00:00.000Z', 'carol'), // week 2
      c('t4', '2026-04-01T09:00:00.000Z', 'alice'), // week 3
    ];
    expect(computeHouseholdStreak(rows, now, TZ_UTC)).toBe(4);
  });

  test('DST boundary (Melbourne AEDT→AEST early April 2026) — single completion → 1', () => {
    // Australia ends DST 3am Sun 5 Apr 2026. Test with a completion on that
    // 25h-long Sunday and `now` on the Monday — week-offset must be 0.
    const now = new Date('2026-04-06T03:00:00.000Z'); // Mon 6 Apr ≈ 13:00 AEST
    const rows = [c('t1', '2026-04-05T10:00:00.000Z')]; // Sun 5 Apr ≈ 20:00 AEDT/AEST
    expect(computeHouseholdStreak(rows, now, TZ_MELB)).toBe(1);
  });

  test('future-dated completion ignored (streak 0 if it is the only row)', () => {
    const now = new Date('2026-04-22T12:00:00.000Z');
    const rows = [c('t1', '2026-04-30T09:00:00.000Z')]; // 8 days in the future
    expect(computeHouseholdStreak(rows, now, TZ_UTC)).toBe(0);
  });

  test('multiple completions same week by same OR different members count as one week', () => {
    const now = new Date('2026-04-22T12:00:00.000Z');
    const rows = [
      c('t1', '2026-04-22T09:00:00.000Z', 'alice'),
      c('t2', '2026-04-21T09:00:00.000Z', 'bob'),
      c('t3', '2026-04-20T09:00:00.000Z', 'alice'),
    ];
    expect(computeHouseholdStreak(rows, now, TZ_UTC)).toBe(1);
  });
});
