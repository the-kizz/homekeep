import { describe, test, expect } from 'vitest';
import {
  reduceLatestByTask,
  type CompletionRecord,
} from '@/lib/completions';

/**
 * 03-01 Task 2 RED→GREEN: reduceLatestByTask pure reducer (Pattern 2).
 *
 * The reducer takes a flat completions array and returns a Map keyed
 * by task_id containing the MOST RECENT completion per task. Input
 * order must not matter (a clock-skew-reordered array must still
 * pick the correct "latest").
 *
 * ≥5 cases per plan <behavior>.
 */

function makeCompletion(overrides: Partial<CompletionRecord>): CompletionRecord {
  return {
    id: 'c-default',
    task_id: 't1',
    completed_by_id: 'u1',
    completed_at: '2026-04-20T12:00:00.000Z',
    notes: '',
    via: 'tap',
    ...overrides,
  };
}

describe('reduceLatestByTask', () => {
  test('empty array returns an empty Map', () => {
    const m = reduceLatestByTask([]);
    expect(m.size).toBe(0);
  });

  test('single completion → Map of size 1', () => {
    const c = makeCompletion({ id: 'c1' });
    const m = reduceLatestByTask([c]);
    expect(m.size).toBe(1);
    expect(m.get('t1')?.id).toBe('c1');
  });

  test('two completions for same task — keeps the LATER completed_at', () => {
    const older = makeCompletion({
      id: 'c-old',
      completed_at: '2026-04-18T10:00:00.000Z',
    });
    const newer = makeCompletion({
      id: 'c-new',
      completed_at: '2026-04-20T10:00:00.000Z',
    });
    const m = reduceLatestByTask([older, newer]);
    expect(m.size).toBe(1);
    expect(m.get('t1')?.id).toBe('c-new');
  });

  test('out-of-order input — later completion first — still keeps latest', () => {
    const older = makeCompletion({
      id: 'c-old',
      completed_at: '2026-04-18T10:00:00.000Z',
    });
    const newer = makeCompletion({
      id: 'c-new',
      completed_at: '2026-04-20T10:00:00.000Z',
    });
    // Newer appears FIRST in array; reducer must still pick it.
    const m = reduceLatestByTask([newer, older]);
    expect(m.get('t1')?.id).toBe('c-new');
  });

  test('multiple tasks — each gets its own latest', () => {
    const completions: CompletionRecord[] = [
      makeCompletion({
        id: 'c-t1-old',
        task_id: 't1',
        completed_at: '2026-04-15T00:00:00.000Z',
      }),
      makeCompletion({
        id: 'c-t1-new',
        task_id: 't1',
        completed_at: '2026-04-20T00:00:00.000Z',
      }),
      makeCompletion({
        id: 'c-t2-only',
        task_id: 't2',
        completed_at: '2026-04-18T00:00:00.000Z',
      }),
      makeCompletion({
        id: 'c-t3-old',
        task_id: 't3',
        completed_at: '2026-04-10T00:00:00.000Z',
      }),
      makeCompletion({
        id: 'c-t3-new',
        task_id: 't3',
        completed_at: '2026-04-19T00:00:00.000Z',
      }),
    ];
    const m = reduceLatestByTask(completions);
    expect(m.size).toBe(3);
    expect(m.get('t1')?.id).toBe('c-t1-new');
    expect(m.get('t2')?.id).toBe('c-t2-only');
    expect(m.get('t3')?.id).toBe('c-t3-new');
  });

  test('exact-tie timestamps — keeps the first one encountered (strict >)', () => {
    // Deterministic behavior: when completed_at is identical, the reducer
    // uses strict `>` so the second record does NOT displace the first.
    const first = makeCompletion({
      id: 'c-first',
      completed_at: '2026-04-20T12:00:00.000Z',
    });
    const second = makeCompletion({
      id: 'c-second',
      completed_at: '2026-04-20T12:00:00.000Z',
    });
    const m = reduceLatestByTask([first, second]);
    expect(m.get('t1')?.id).toBe('c-first');
  });
});
