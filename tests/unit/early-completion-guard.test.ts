import { describe, test, expect } from 'vitest';
import { shouldWarnEarly } from '@/lib/early-completion-guard';

/**
 * 03-01 Task 2 RED→GREEN: shouldWarnEarly pure function (Pattern 9, D-07).
 *
 * Warn iff elapsed < 0.25 * frequency_days.
 * Reference: lastCompletion.completed_at ?? task.created.
 *
 * ≥6 cases per plan <behavior>:
 *  - No completion + just-created → warn (elapsed ~= 0).
 *  - Completion 1d ago, freq=7 → warn (1 < 1.75).
 *  - Completion 5d ago, freq=7 → no warn (5 > 1.75).
 *  - Exact 25% boundary → no warn (strict <).
 *  - Never completed, created 10d ago, freq=7 → no warn.
 *  - Never completed, created 1h ago, freq=90 → warn.
 */

describe('shouldWarnEarly', () => {
  // v1.2.1 PATCH2-07: never-completed tasks now bypass the guard.
  // Previously the guard referenced `task.created`, which warned on every
  // first-completion of a fresh task. The new rule: warn only when there
  // was a PRIOR completion and the user is re-completing too soon.
  test('v1.2.1 PATCH2-07: no completion + task just created → NO warn (was warn pre-v1.2.1)', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const task = {
      created: '2026-04-20T11:59:59.000Z', // 1s ago
      frequency_days: 7,
    };
    expect(shouldWarnEarly(task, null, now)).toBe(false);
  });

  test('completion 1d ago + freq=7 (threshold=1.75) → warn (1 < 1.75)', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const task = { created: '2026-04-01T00:00:00.000Z', frequency_days: 7 };
    const last = { completed_at: '2026-04-19T12:00:00.000Z' };
    expect(shouldWarnEarly(task, last, now)).toBe(true);
  });

  test('completion 5d ago + freq=7 (threshold=1.75) → no warn (5 >= 1.75)', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const task = { created: '2026-04-01T00:00:00.000Z', frequency_days: 7 };
    const last = { completed_at: '2026-04-15T12:00:00.000Z' };
    expect(shouldWarnEarly(task, last, now)).toBe(false);
  });

  test('completion exactly at 25% boundary (elapsed=1.75, freq=7) → no warn (strict <)', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    // 1.75 days = 1d 18h
    const last = { completed_at: '2026-04-18T18:00:00.000Z' };
    const task = { created: '2026-04-01T00:00:00.000Z', frequency_days: 7 };
    expect(shouldWarnEarly(task, last, now)).toBe(false);
  });

  test('never completed + task created 10d ago + freq=7 (threshold=1.75) → no warn', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const task = { created: '2026-04-10T12:00:00.000Z', frequency_days: 7 };
    expect(shouldWarnEarly(task, null, now)).toBe(false);
  });

  test('v1.2.1 PATCH2-07: never completed + created 1h ago + freq=90 → NO warn (was warn pre-v1.2.1)', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const task = { created: '2026-04-20T11:00:00.000Z', frequency_days: 90 };
    expect(shouldWarnEarly(task, null, now)).toBe(false);
  });

  test('completion 10 days ago + freq=30 (threshold=7.5) → no warn (10 >= 7.5)', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const task = { created: '2026-03-01T00:00:00.000Z', frequency_days: 30 };
    const last = { completed_at: '2026-04-10T12:00:00.000Z' };
    expect(shouldWarnEarly(task, last, now)).toBe(false);
  });

  test('daily task (freq=1): completed 1h ago → warn (0.04d < 0.25d)', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const task = { created: '2026-04-01T00:00:00.000Z', frequency_days: 1 };
    const last = { completed_at: '2026-04-20T11:00:00.000Z' };
    expect(shouldWarnEarly(task, last, now)).toBe(true);
  });
});
