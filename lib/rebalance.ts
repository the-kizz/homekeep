// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep
import type { Override } from '@/lib/schedule-overrides';
import type { CompletionRecord } from '@/lib/completions';
import {
  computeNextDue,
  isOoftTask,
  type Completion,
  type Task,
} from '@/lib/task-scheduling';

/**
 * Phase 17 REBAL classifier (Plan 17-01 Task 1, REBAL-01..04).
 *
 * PURE module: no I/O, no Date.now reads, no mutation of inputs. Given
 * the same task array + overrides/completions Maps + `now`, returns the
 * same 4-bucket partition. Consumed by lib/actions/rebalance.ts (Task 2):
 *   - rebalancePreviewAction — reads bucket LENGTHS to build counts.
 *   - rebalanceApplyAction   — iterates `rebalanceable` to compute
 *     fresh placements; leaves anchored / active_snooze / from_now_on
 *     untouched (preservation rules).
 *
 * Priority (first match wins — D-01, order fixed):
 *   1. anchored       — task.schedule_mode === 'anchored'      (REBAL-01)
 *   2. active_snooze  — overridesByTask.has(task.id)           (REBAL-02)
 *   3. from_now_on    — task.reschedule_marker truthy          (REBAL-03)
 *   4. rebalanceable  — everything else (cycle, no override,
 *                       no marker, non-OOFT, not dormant)      (REBAL-04)
 *
 * Excluded (D-02) — NOT in any bucket:
 *   - task.archived === true
 *   - isOoftTask(task)                     (LOAD-09 — OOFT never smoother-
 *                                           placed; frequency_days
 *                                           null OR 0 per PB 0.37.1)
 *   - dormant-seasonal: computeNextDue returns null for a natural-only
 *     synthesized view (no override, no smoothed, no marker). Detected
 *     ONLY on the rebalanceable candidate set — anchored/override/marker
 *     tasks are preserved regardless of dormancy (user intent wins).
 *
 * Falsy-marker handling: null, undefined, AND empty string all route to
 * the non-from_now_on branch. PB 0.37.1 DateField may round-trip as
 * either null (Phase 15 write) or '' (never-written row) depending on
 * whether the row predates the 1745280003 migration.
 */

export type RebalanceBuckets = {
  anchored: Task[];
  active_snooze: Task[];
  from_now_on: Task[];
  rebalanceable: Task[];
};

/**
 * Partition `tasks` into the four REBAL buckets.
 *
 * @param tasks            Home tasks (already filtered to archived=false
 *                         upstream is fine but not required — archived
 *                         tasks are also skipped here defensively).
 * @param overridesByTask  Map<taskId, Override> of active (unconsumed)
 *                         schedule_overrides rows, keyed by task_id.
 *                         Produced by getActiveOverridesForHome.
 * @param latestByTask     Map<taskId, CompletionRecord> of the latest
 *                         completion per task. Used ONLY by dormant-
 *                         seasonal detection on the rebalanceable
 *                         candidate set — prior-season completions
 *                         trigger wasInPriorSeason wake-up; same-season
 *                         dormancy returns null from computeNextDue.
 * @param now              Wall-clock instant (caller-supplied, keeps
 *                         this function pure).
 * @param timezone         IANA tz for seasonal-month extraction. Default
 *                         'UTC' matches computeNextDue's fallback.
 *
 * Invariants:
 *   - Output bucket arrays are disjoint (no task appears in two buckets).
 *   - Output order within each bucket preserves input order —
 *     Task 2's apply action sorts rebalanceable by naturalIdeal
 *     ascending, but insertion order here is deterministic (same Map
 *     iteration / classify iteration = stable base for sort).
 *   - Pure: does not mutate inputs. Returns fresh Buckets object with
 *     fresh arrays per call.
 */
export function classifyTasksForRebalance(
  tasks: Task[],
  overridesByTask: Map<string, Override>,
  latestByTask: Map<string, CompletionRecord>,
  now: Date,
  timezone: string = 'UTC',
): RebalanceBuckets {
  const buckets: RebalanceBuckets = {
    anchored: [],
    active_snooze: [],
    from_now_on: [],
    rebalanceable: [],
  };

  for (const task of tasks) {
    // D-02 exclusions — hard-skip before any priority matching.
    if (task.archived) continue;
    if (isOoftTask(task)) continue;

    // D-01 priority 1: anchored.
    if (task.schedule_mode === 'anchored') {
      buckets.anchored.push(task);
      continue;
    }

    // D-01 priority 2: active override row exists.
    if (overridesByTask.has(task.id)) {
      buckets.active_snooze.push(task);
      continue;
    }

    // D-01 priority 3: reschedule_marker truthy (Phase 15 SNZE-07).
    // Truthy check covers null, undefined, AND '' — PB DateField may
    // round-trip as any of the three depending on write history.
    if (task.reschedule_marker) {
      buckets.from_now_on.push(task);
      continue;
    }

    // D-01 priority 4: rebalanceable candidate. Gate on dormant-
    // seasonal exclusion BEFORE adding — synthesize a natural-only
    // view (no override applied, no smoothed shortcut, no marker
    // effect) so computeNextDue's seasonal-dormant branch fires
    // objectively. If null → dormant, drop.
    const naturalView: Task = {
      ...task,
      next_due_smoothed: null,
      reschedule_marker: null,
    };
    const last = latestByTask.get(task.id) ?? null;
    const lastCompletion: Completion | null = last
      ? { completed_at: last.completed_at }
      : null;
    const due = computeNextDue(
      naturalView,
      lastCompletion,
      now,
      undefined,
      timezone,
    );
    if (due === null) continue; // dormant-seasonal (D-02)

    buckets.rebalanceable.push(task);
  }

  return buckets;
}
