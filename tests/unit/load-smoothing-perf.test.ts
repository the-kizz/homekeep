// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep

/**
 * LOAD-13 perf benchmark — 100-task placement < 100ms.
 *
 * Pure in-memory — no PB roundtrip measured (that's a separate D-11
 * concern). Production end-to-end = placement (~3-5ms observed) +
 * PB getFullList (~30-50ms warm) = well under 100ms.
 *
 * Seed composition (per 12-RESEARCH.md §Perf Benchmark Approach):
 *   15 × freq=1
 *   17 × freq=7
 *   17 × freq=14
 *   17 × freq=30
 *   17 × freq=90
 *   17 × freq=365
 *   Total: 100 tasks
 *
 * Half pre-completed (freq/2 days ago); half fresh-new (no completion).
 *
 * Flakiness protection: 100ms budget with expected observed ~3-5ms →
 * 20-33× headroom. If this ever fails, the algorithm has a quadratic
 * blowup — check computeHouseholdLoad windowDays bound or
 * placeNextDue candidate scoring loop.
 */

import { test, expect } from 'vitest';
import { addDays } from 'date-fns';
import {
  computeHouseholdLoad,
  placeNextDue,
} from '@/lib/load-smoothing';
import type { Task } from '@/lib/task-scheduling';
import type { CompletionRecord } from '@/lib/completions';

const NOW = new Date('2026-05-01T00:00:00.000Z');
const TZ = 'UTC';

function seedPerfTasks(): {
  tasks: Task[];
  latestByTask: Map<string, CompletionRecord>;
} {
  const tasks: Task[] = [];
  const latestByTask = new Map<string, CompletionRecord>();
  const freqCounts: Array<[number, number]> = [
    [1, 15], [7, 17], [14, 17], [30, 17], [90, 17], [365, 17],
  ];
  let idCounter = 0;
  for (const [freq, count] of freqCounts) {
    for (let i = 0; i < count; i++) {
      const id = `t-${idCounter++}`;
      const task: Task = {
        id,
        created: '2026-01-01T00:00:00.000Z',
        archived: false,
        frequency_days: freq,
        schedule_mode: 'cycle',
        anchor_date: null,
        due_date: null,
        preferred_days: null,
        active_from_month: null,
        active_to_month: null,
        next_due_smoothed: null,
      };
      tasks.push(task);
      // Half pre-completed (even index); half fresh (odd).
      if (i % 2 === 0) {
        const completedAt = addDays(NOW, -Math.floor(freq / 2)).toISOString();
        latestByTask.set(id, {
          id: `c-${id}`,
          task_id: id,
          completed_by_id: 'u1',
          completed_at: completedAt,
          notes: '',
          via: 'tap',
        });
      }
    }
  }
  return { tasks, latestByTask };
}

test('LOAD-13 perf: 100-task placement completes in <100ms', () => {
  const { tasks, latestByTask } = seedPerfTasks();
  expect(tasks.length).toBe(100);

  // Target: first cycle task with a completion (so placement has a
  // valid naturalIdeal). Find a non-OOFT, non-anchored task with a
  // completion seeded.
  const target = tasks.find(
    (t) => t.schedule_mode === 'cycle'
      && t.frequency_days !== null
      && t.frequency_days > 0
      && latestByTask.has(t.id),
  );
  if (!target) throw new Error('perf seed has no placeable task');

  const lastRec = latestByTask.get(target.id) ?? null;
  const lastCompletion = lastRec
    ? { completed_at: lastRec.completed_at }
    : null;

  const start = performance.now();
  const load = computeHouseholdLoad(
    tasks, latestByTask, new Map(), NOW, 120, TZ,
  );
  const placed = placeNextDue(
    target,
    lastCompletion,
    load,
    NOW,
    { timezone: TZ },
  );
  const elapsed = performance.now() - start;

  expect(placed).toBeInstanceOf(Date);
  expect(elapsed).toBeLessThan(100);
  // Log for observability when running standalone — not asserted.
  // Expected range 2-8ms on CI; 100ms is 12-50× headroom.
  if (process.env.PERF_LOG === '1') {
    // eslint-disable-next-line no-console
    console.log(`[LOAD-13] elapsed=${elapsed.toFixed(2)}ms (budget <100ms)`);
  }
});
