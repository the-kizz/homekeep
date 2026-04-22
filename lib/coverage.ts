// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/conroyke56/homekeep
import {
  computeNextDue,
  isInActiveWindow,
  type Task,
} from '@/lib/task-scheduling';
import type { CompletionRecord } from '@/lib/completions';
import type { Override } from '@/lib/schedule-overrides';

/**
 * Household coverage formula (03-01 Plan, Pattern 8, D-06, VIEW-05;
 * 10-02 Plan wires the override Map through per D-06 + D-08 + D-09;
 * 11-02 Plan adds the dormant-task filter per D-14 + SEAS-05).
 *
 * PURE module: deterministic from (tasks, latestByTask, overridesByTask, now).
 *
 * Per-task health:
 *   overdueDays = max(0, (now - nextDue) / 86400000)
 *   health      = clamp(1 - overdueDays / frequency_days, 0, 1)
 *
 * Intuition:
 *   - On schedule or early   → health = 1.0
 *   - Overdue by half a cycle → health = 0.5
 *   - Overdue by a full cycle or more → health = 0.0 (clamped)
 *
 * Household coverage = mean(per-task health) across NON-ARCHIVED,
 * NON-DORMANT tasks.
 *
 * Phase 11 dormant filter (D-14, SEAS-05): tasks with a seasonal active
 * window (active_from_month AND active_to_month both non-null) that do
 * NOT include the current UTC month are excluded from the mean —
 * treated identically to archived tasks. Rationale: "lawn mowing is
 * perfectly fine in winter" — don't drag the coverage number down for
 * a task the user doesn't expect to see in this season. Home-timezone
 * precision is deferred (UTC-month fallback differs from the home-tz
 * exact result by at most one day at month boundaries — acceptable
 * for coverage-ring rendering; the resulting flip of a single task in/
 * out of dormancy on one boundary day is a known v1.1 imprecision).
 * Year-round tasks (v1.0 row shape, no window) are NEVER excluded.
 *
 * Empty-home invariant (D-06): when there are no non-archived,
 * non-dormant tasks OR no such tasks produce a valid nextDue, return
 * `1.0` — "an empty house is perfectly maintained". The UI overlays an
 * "Add your first task" CTA on top of the 100% ring.
 *
 * Weighting: equal-weight across tasks (per D-06 and SPEC §8.1).
 * Frequency-normalisation is already baked in via `overdueDays /
 * frequency_days`, so shorter-cycle tasks (daily bench wipe) and
 * longer-cycle tasks (yearly gutter clean) contribute equally on the
 * final mean — which matches the product intention documented in
 * PROJECT.md Key Decisions.
 *
 * Override wiring (Phase 10, D-06 / D-08 / D-09, SNZE-09): an active,
 * unconsumed override for a task replaces its natural next-due inside
 * computeNextDue — so a snoozed overdue task contributes 1.0 health to
 * the coverage mean instead of 0.0. Callers pass an empty Map when no
 * overrides apply; `overridesByTask.get(task.id)` returns `undefined`
 * then, and computeNextDue runs byte-identical to v1.0.
 */

export function computeCoverage(
  tasks: Task[],
  latestByTask: Map<string, CompletionRecord>,
  overridesByTask: Map<string, Override>,
  now: Date,
): number {
  // Phase 11 (D-14, SEAS-05): dormant-task check. UTC month used (caller
  // does not pass timezone — acceptable per module-level JSDoc).
  const nowMonth = now.getUTCMonth() + 1;
  const isDormant = (t: Task): boolean => {
    const hasWindow =
      t.active_from_month != null && t.active_to_month != null;
    if (!hasWindow) return false;
    return !isInActiveWindow(
      nowMonth,
      t.active_from_month!,
      t.active_to_month!,
    );
  };

  const active = tasks.filter((t) => !t.archived && !isDormant(t));
  if (active.length === 0) return 1.0;

  let sum = 0;
  let counted = 0;
  for (const task of active) {
    const last = latestByTask.get(task.id) ?? null;
    const override = overridesByTask.get(task.id);
    const nextDue = computeNextDue(task, last, now, override);
    if (!nextDue) continue;
    // Phase 11 (WR-01): OOFT tasks (frequency_days null, or 0 per the
    // PB 0.37.1 cleared-NumberField storage quirk documented in
    // task-scheduling.ts) have no cycle to normalize against. An
    // uncompleted OOFT reaches this line with a concrete `due_date`
    // from computeNextDue's OOFT branch — dividing overdueDays by
    // null/0 produces NaN (future due) or Infinity (past due) and
    // corrupts the coverage mean. Skip them like dormant tasks: they
    // contribute no coverage signal until archived by completeTaskAction.
    // A completed OOFT is archived atomically by the completion batch;
    // reaching here with a completed OOFT is a race-window-only state
    // also safely skipped.
    const freq = task.frequency_days;
    if (freq === null || freq === 0) continue;
    const overdueDays = Math.max(
      0,
      (now.getTime() - nextDue.getTime()) / 86400000,
    );
    const health = Math.max(0, Math.min(1, 1 - overdueDays / freq));
    sum += health;
    counted += 1;
  }
  return counted === 0 ? 1.0 : sum / counted;
}
