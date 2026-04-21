import { describe, test, expect } from 'vitest';
import { detectAreaCelebration } from '@/lib/area-celebration';
import type { Task } from '@/lib/task-scheduling';
import type { CompletionRecord } from '@/lib/completions';

/**
 * 06-01 Task 2 RED→GREEN: detectAreaCelebration pure fn (D-13, GAME-04).
 *
 * Contract: returns true IFF the area's coverage crossed strictly below 1.0
 * BEFORE the mutation AND is exactly 1.0 AFTER. Every other combination
 * returns false — critically the "already at 100% before" case that must
 * NOT spam the user with celebrations every time they re-complete a task
 * in an already-healthy area.
 */

const NOW = new Date('2026-04-22T12:00:00.000Z');

function t(overrides: Partial<Task> = {}): Task {
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

function c(taskId: string, iso: string): CompletionRecord {
  return {
    id: `c-${taskId}-${iso}`,
    task_id: taskId,
    completed_by_id: 'u1',
    completed_at: iso,
    notes: '',
    via: 'tap',
  };
}

describe('detectAreaCelebration', () => {
  test('empty area (zero tasks) → false (no crossover, 1.0 is the baseline)', () => {
    expect(
      detectAreaCelebration(
        [],
        new Map<string, CompletionRecord>(),
        new Map<string, CompletionRecord>(),
        NOW,
      ),
    ).toBe(false);
  });

  test('<100 before → 100 after → TRUE (the canonical celebration)', () => {
    // Two tasks. Before: only t1 complete; t2 overdue → coverage < 1.
    // After: both complete → coverage = 1.
    const tasks = [
      t({ id: 't1', frequency_days: 7 }),
      t({ id: 't2', frequency_days: 7 }),
    ];
    const today = NOW.toISOString();
    const before = new Map<string, CompletionRecord>([
      ['t1', c('t1', today)],
      // t2: missing → overdue → health=0
    ]);
    const after = new Map<string, CompletionRecord>([
      ['t1', c('t1', today)],
      ['t2', c('t2', today)],
    ]);
    expect(detectAreaCelebration(tasks, before, after, NOW)).toBe(true);
  });

  test('already 100 before → stays 100 after → FALSE (anti-spam)', () => {
    const tasks = [
      t({ id: 't1', frequency_days: 7 }),
      t({ id: 't2', frequency_days: 7 }),
    ];
    const earlier = new Date(NOW.getTime() - 3_600_000).toISOString();
    const today = NOW.toISOString();
    const before = new Map<string, CompletionRecord>([
      ['t1', c('t1', earlier)],
      ['t2', c('t2', earlier)],
    ]);
    // One of them was re-completed — area stays healthy.
    const after = new Map<string, CompletionRecord>([
      ['t1', c('t1', today)],
      ['t2', c('t2', earlier)],
    ]);
    expect(detectAreaCelebration(tasks, before, after, NOW)).toBe(false);
  });

  test('<100 before → still <100 after → FALSE (no crossover)', () => {
    const tasks = [
      t({ id: 't1', frequency_days: 7 }),
      t({ id: 't2', frequency_days: 7 }),
      t({ id: 't3', frequency_days: 7 }),
    ];
    const today = NOW.toISOString();
    const before = new Map<string, CompletionRecord>([
      ['t1', c('t1', today)],
    ]);
    const after = new Map<string, CompletionRecord>([
      ['t1', c('t1', today)],
      ['t2', c('t2', today)], // still missing t3 → < 1.0
    ]);
    expect(detectAreaCelebration(tasks, before, after, NOW)).toBe(false);
  });

  test('single-task area: overdue before → completed today → TRUE', () => {
    // Task created 15d ago, freq=7 → nextDue = 8d ago → overdue=8 → health=0.
    const createdIso = new Date(NOW.getTime() - 15 * 86400000).toISOString();
    const tasks = [t({ id: 't1', frequency_days: 7, created: createdIso })];
    const before = new Map<string, CompletionRecord>();
    const after = new Map<string, CompletionRecord>([
      ['t1', c('t1', NOW.toISOString())],
    ]);
    expect(detectAreaCelebration(tasks, before, after, NOW)).toBe(true);
  });

  test('multi-task: already-healthy task + the OTHER just completed crosses to 100 → TRUE', () => {
    const tasks = [
      t({ id: 't-healthy', frequency_days: 7 }),
      t({ id: 't-overdue', frequency_days: 7 }),
    ];
    const today = NOW.toISOString();
    const earlier = new Date(NOW.getTime() - 3 * 86400000).toISOString();
    const before = new Map<string, CompletionRecord>([
      ['t-healthy', c('t-healthy', earlier)],
      // t-overdue absent
    ]);
    const after = new Map<string, CompletionRecord>([
      ['t-healthy', c('t-healthy', earlier)],
      ['t-overdue', c('t-overdue', today)],
    ]);
    expect(detectAreaCelebration(tasks, before, after, NOW)).toBe(true);
  });

  test('already 100; new completion on DIFFERENT task in same healthy area → FALSE', () => {
    const tasks = [
      t({ id: 't1', frequency_days: 7 }),
      t({ id: 't2', frequency_days: 7 }),
    ];
    const earlier = new Date(NOW.getTime() - 3 * 86400000).toISOString();
    const today = NOW.toISOString();
    const before = new Map<string, CompletionRecord>([
      ['t1', c('t1', earlier)],
      ['t2', c('t2', earlier)],
    ]);
    const after = new Map<string, CompletionRecord>([
      ['t1', c('t1', today)], // re-completed; area was already healthy
      ['t2', c('t2', earlier)],
    ]);
    expect(detectAreaCelebration(tasks, before, after, NOW)).toBe(false);
  });

  test('partial recovery (0.5 → 0.75) → FALSE', () => {
    const tasks = [
      t({ id: 't1', frequency_days: 7 }),
      t({ id: 't2', frequency_days: 7 }),
      t({ id: 't3', frequency_days: 7 }),
      t({ id: 't4', frequency_days: 7 }),
    ];
    const today = NOW.toISOString();
    const before = new Map<string, CompletionRecord>([
      ['t1', c('t1', today)],
      ['t2', c('t2', today)],
    ]);
    const after = new Map<string, CompletionRecord>([
      ['t1', c('t1', today)],
      ['t2', c('t2', today)],
      ['t3', c('t3', today)], // 3/4 healthy
    ]);
    expect(detectAreaCelebration(tasks, before, after, NOW)).toBe(false);
  });
});
