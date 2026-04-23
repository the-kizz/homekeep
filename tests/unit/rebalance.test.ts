// @vitest-environment node
import { describe, test, expect } from 'vitest';

import type { Override } from '@/lib/schedule-overrides';
import type { Task } from '@/lib/task-scheduling';
import type { CompletionRecord } from '@/lib/completions';
import { classifyTasksForRebalance } from '@/lib/rebalance';

/**
 * Phase 17 Plan 17-01 Task 1 — classifyTasksForRebalance unit tests.
 *
 * Pure helper, no mocks. Constructs Task / Override / completion fixtures
 * inline. Covers:
 *
 *   Priority order (D-01 — first match wins):
 *     1. anchored      → schedule_mode === 'anchored'
 *     2. active_snooze → overridesByTask.has(task.id)
 *     3. from_now_on   → reschedule_marker truthy
 *     4. rebalanceable → everything else (cycle, no override, no marker,
 *                        non-OOFT, not dormant)
 *
 *   Exclusions (D-02 — excluded entirely):
 *     - archived tasks
 *     - OOFT tasks (frequency_days null OR 0)
 *     - dormant-seasonal tasks (computeNextDue returns null on a
 *       natural-only view)
 *
 *   Fixture IDs are 15-char PB record-id shape per 13-01 lesson.
 */

const TZ = 'UTC';
const NOW = new Date('2026-06-15T12:00:00.000Z'); // summer in UTC

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task1234567890a', // 15 chars
    created: '2026-01-01T00:00:00.000Z',
    archived: false,
    frequency_days: 30,
    schedule_mode: 'cycle',
    anchor_date: null,
    preferred_days: null,
    active_from_month: null,
    active_to_month: null,
    due_date: null,
    next_due_smoothed: null,
    reschedule_marker: null,
    ...overrides,
  };
}

function makeOverride(taskId: string): Override {
  return {
    id: 'ovr12345678901a',
    task_id: taskId,
    snooze_until: '2026-07-01T00:00:00.000Z',
    consumed_at: null,
    created_by_id: 'user1234567890a',
    created: '2026-06-10T00:00:00.000Z',
  };
}

function makeCompletion(taskId: string, completedAt: string): CompletionRecord {
  return {
    id: 'cmpl1234567890a',
    task_id: taskId,
    completed_by_id: 'user1234567890a',
    completed_at: completedAt,
    notes: '',
    via: 'tap',
  };
}

describe('classifyTasksForRebalance (Plan 17-01 Task 1)', () => {
  // ─── Priority order (D-01) ─────────────────────────────────────

  test('Test 1 (D-01.1): anchored beats override + marker — bucket = anchored', () => {
    const task = makeTask({
      id: 'task1111111111a',
      schedule_mode: 'anchored',
      anchor_date: '2026-08-01T00:00:00.000Z',
      reschedule_marker: '2026-06-01T00:00:00.000Z',
    });
    const overrides = new Map<string, Override>([
      [task.id, makeOverride(task.id)],
    ]);
    const latestByTask = new Map<string, CompletionRecord>();

    const buckets = classifyTasksForRebalance(
      [task],
      overrides,
      latestByTask,
      NOW,
      TZ,
    );

    expect(buckets.anchored).toHaveLength(1);
    expect(buckets.anchored[0].id).toBe(task.id);
    expect(buckets.active_snooze).toHaveLength(0);
    expect(buckets.from_now_on).toHaveLength(0);
    expect(buckets.rebalanceable).toHaveLength(0);
  });

  test('Test 2 (D-01.2): override beats marker — bucket = active_snooze', () => {
    const task = makeTask({
      id: 'task2222222222a',
      schedule_mode: 'cycle',
      reschedule_marker: '2026-06-01T00:00:00.000Z',
    });
    const overrides = new Map<string, Override>([
      [task.id, makeOverride(task.id)],
    ]);
    const latestByTask = new Map<string, CompletionRecord>();

    const buckets = classifyTasksForRebalance(
      [task],
      overrides,
      latestByTask,
      NOW,
      TZ,
    );

    expect(buckets.active_snooze).toHaveLength(1);
    expect(buckets.active_snooze[0].id).toBe(task.id);
    expect(buckets.from_now_on).toHaveLength(0);
    expect(buckets.rebalanceable).toHaveLength(0);
  });

  test('Test 3 (D-01.3): marker truthy → bucket = from_now_on', () => {
    const task = makeTask({
      id: 'task3333333333a',
      schedule_mode: 'cycle',
      reschedule_marker: '2026-06-01T00:00:00.000Z',
    });
    const buckets = classifyTasksForRebalance(
      [task],
      new Map(),
      new Map(),
      NOW,
      TZ,
    );

    expect(buckets.from_now_on).toHaveLength(1);
    expect(buckets.from_now_on[0].id).toBe(task.id);
    expect(buckets.rebalanceable).toHaveLength(0);
  });

  test('Test 4 (D-01.4): cycle + no override + no marker + active window → rebalanceable', () => {
    const task = makeTask({
      id: 'task4444444444a',
      schedule_mode: 'cycle',
      frequency_days: 30,
    });

    const buckets = classifyTasksForRebalance(
      [task],
      new Map(),
      new Map(),
      NOW,
      TZ,
    );

    expect(buckets.rebalanceable).toHaveLength(1);
    expect(buckets.rebalanceable[0].id).toBe(task.id);
    expect(buckets.anchored).toHaveLength(0);
    expect(buckets.active_snooze).toHaveLength(0);
    expect(buckets.from_now_on).toHaveLength(0);
  });

  // ─── Exclusions (D-02) ─────────────────────────────────────────

  test('Test 5 (D-02.1): archived=true → NOT in any bucket', () => {
    const task = makeTask({
      id: 'task5555555555a',
      archived: true,
    });
    const buckets = classifyTasksForRebalance(
      [task],
      new Map(),
      new Map(),
      NOW,
      TZ,
    );

    expect(buckets.anchored).toHaveLength(0);
    expect(buckets.active_snooze).toHaveLength(0);
    expect(buckets.from_now_on).toHaveLength(0);
    expect(buckets.rebalanceable).toHaveLength(0);
  });

  test('Test 6 (D-02.2): OOFT (frequency_days null or 0) → excluded', () => {
    const tNull = makeTask({
      id: 'task6aaaaaaaaaa',
      frequency_days: null,
    });
    const tZero = makeTask({
      id: 'task6bbbbbbbbbb',
      frequency_days: 0,
    });
    const buckets = classifyTasksForRebalance(
      [tNull, tZero],
      new Map(),
      new Map(),
      NOW,
      TZ,
    );

    expect(buckets.anchored).toHaveLength(0);
    expect(buckets.active_snooze).toHaveLength(0);
    expect(buckets.from_now_on).toHaveLength(0);
    expect(buckets.rebalanceable).toHaveLength(0);
  });

  test('Test 7 (D-02.3): dormant-seasonal → excluded from rebalanceable', () => {
    // active_from=10 (Oct), active_to=3 (Mar) — wrap window.
    // now = June 15 → outside window. Last completion in prior season
    // (Feb 2026 = in-window in prior season) → wasInPriorSeason returns
    // true (same-season check via daysSince>365 doesn't apply but month
    // gate fires: Feb was in-window; wrap through June wraps us out).
    //
    // Actually the priorSeason check: lastCompletion is in Feb 2026 (in
    // active window Oct-Mar). daysSince = ~133 days < 365. lastMonth=2
    // IS in window per isInActiveWindow. daysSince < 365 → NOT prior.
    // So lastInPriorSeason=false. inWindowNow=false (June not in Oct-Mar).
    // → same-season dormant → null.
    const task = makeTask({
      id: 'task7777777777a',
      schedule_mode: 'cycle',
      frequency_days: 30,
      active_from_month: 10,
      active_to_month: 3,
    });
    const latestByTask = new Map<string, CompletionRecord>([
      [task.id, makeCompletion(task.id, '2026-02-01T00:00:00.000Z')],
    ]);

    const buckets = classifyTasksForRebalance(
      [task],
      new Map(),
      latestByTask,
      NOW,
      TZ,
    );

    expect(buckets.rebalanceable).toHaveLength(0);
    expect(buckets.anchored).toHaveLength(0);
    expect(buckets.active_snooze).toHaveLength(0);
    expect(buckets.from_now_on).toHaveLength(0);
  });

  // ─── Priority composites ───────────────────────────────────────

  test('Test 8: marker + override → active_snooze (override beats marker, D-01 2 > 3)', () => {
    const task = makeTask({
      id: 'task8888888888a',
      schedule_mode: 'cycle',
      reschedule_marker: '2026-06-01T00:00:00.000Z',
    });
    const overrides = new Map<string, Override>([
      [task.id, makeOverride(task.id)],
    ]);
    const buckets = classifyTasksForRebalance(
      [task],
      overrides,
      new Map(),
      NOW,
      TZ,
    );

    expect(buckets.active_snooze).toHaveLength(1);
    expect(buckets.from_now_on).toHaveLength(0);
  });

  test('Test 9: 10 mixed tasks — bucket counts sum to total minus excluded', () => {
    const anchored = [
      makeTask({ id: 'aaaaaaaaaaaaaa1', schedule_mode: 'anchored', anchor_date: '2026-08-01T00:00:00.000Z' }),
      makeTask({ id: 'aaaaaaaaaaaaaa2', schedule_mode: 'anchored', anchor_date: '2026-09-01T00:00:00.000Z' }),
    ];
    const snoozeTasks = [
      makeTask({ id: 'sssssssssssss01' }),
      makeTask({ id: 'sssssssssssss02' }),
    ];
    const markerTasks = [
      makeTask({ id: 'mmmmmmmmmmmm001', reschedule_marker: '2026-06-01T00:00:00.000Z' }),
    ];
    const rebalTasks = [
      makeTask({ id: 'rrrrrrrrrrr0001' }),
      makeTask({ id: 'rrrrrrrrrrr0002' }),
      makeTask({ id: 'rrrrrrrrrrr0003' }),
    ];
    const excluded = [
      makeTask({ id: 'xxxxxxxxxxxx001', archived: true }),
      makeTask({ id: 'xxxxxxxxxxxx002', frequency_days: null }),
    ];
    const all = [
      ...anchored,
      ...snoozeTasks,
      ...markerTasks,
      ...rebalTasks,
      ...excluded,
    ];
    const overrides = new Map<string, Override>([
      [snoozeTasks[0].id, makeOverride(snoozeTasks[0].id)],
      [snoozeTasks[1].id, makeOverride(snoozeTasks[1].id)],
    ]);

    const buckets = classifyTasksForRebalance(
      all,
      overrides,
      new Map(),
      NOW,
      TZ,
    );

    expect(buckets.anchored).toHaveLength(2);
    expect(buckets.active_snooze).toHaveLength(2);
    expect(buckets.from_now_on).toHaveLength(1);
    expect(buckets.rebalanceable).toHaveLength(3);

    const total =
      buckets.anchored.length +
      buckets.active_snooze.length +
      buckets.from_now_on.length +
      buckets.rebalanceable.length;
    expect(total).toBe(all.length - excluded.length);
  });

  test('Test 10: rebalanceable iteration order matches input task order (deterministic)', () => {
    const tasks = [
      makeTask({ id: 'ordr00000000001', created: '2026-01-01T00:00:00.000Z' }),
      makeTask({ id: 'ordr00000000002', created: '2026-02-01T00:00:00.000Z' }),
      makeTask({ id: 'ordr00000000003', created: '2026-03-01T00:00:00.000Z' }),
    ];
    const buckets = classifyTasksForRebalance(
      tasks,
      new Map(),
      new Map(),
      NOW,
      TZ,
    );

    expect(buckets.rebalanceable.map((t) => t.id)).toEqual([
      'ordr00000000001',
      'ordr00000000002',
      'ordr00000000003',
    ]);
  });

  test('Test 11: empty inputs — all four buckets empty', () => {
    const buckets = classifyTasksForRebalance(
      [],
      new Map(),
      new Map(),
      NOW,
      TZ,
    );

    expect(buckets.anchored).toHaveLength(0);
    expect(buckets.active_snooze).toHaveLength(0);
    expect(buckets.from_now_on).toHaveLength(0);
    expect(buckets.rebalanceable).toHaveLength(0);

    // Task with no override entry → no false-positive on active_snooze.
    const task = makeTask({ id: 'nooverride00001' });
    const b2 = classifyTasksForRebalance(
      [task],
      new Map(),
      new Map(),
      NOW,
      TZ,
    );
    expect(b2.active_snooze).toHaveLength(0);
    expect(b2.rebalanceable).toHaveLength(1);
  });

  test('Test 12: reschedule_marker falsy variants — null, undefined, empty string all non-from_now_on', () => {
    const tNull = makeTask({
      id: 'falsy0000000001',
      reschedule_marker: null,
    });
    const tUndef = makeTask({
      id: 'falsy0000000002',
      reschedule_marker: undefined,
    });
    const tEmpty = makeTask({
      id: 'falsy0000000003',
      reschedule_marker: '',
    });

    const buckets = classifyTasksForRebalance(
      [tNull, tUndef, tEmpty],
      new Map(),
      new Map(),
      NOW,
      TZ,
    );

    expect(buckets.from_now_on).toHaveLength(0);
    expect(buckets.rebalanceable).toHaveLength(3);
  });
});
