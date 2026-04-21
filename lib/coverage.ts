// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/conroyke56/homekeep
import { computeNextDue, type Task } from '@/lib/task-scheduling';
import type { CompletionRecord } from '@/lib/completions';

/**
 * Household coverage formula (03-01 Plan, Pattern 8, D-06, VIEW-05).
 *
 * PURE module: deterministic from (tasks, latestByTask, now).
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
 * Household coverage = mean(per-task health) across NON-ARCHIVED tasks.
 *
 * Empty-home invariant (D-06): when there are no non-archived tasks OR
 * no tasks produce a valid nextDue, return `1.0` — "an empty house is
 * perfectly maintained". The UI overlays an "Add your first task" CTA
 * on top of the 100% ring.
 *
 * Weighting: equal-weight across tasks (per D-06 and SPEC §8.1).
 * Frequency-normalisation is already baked in via `overdueDays /
 * frequency_days`, so shorter-cycle tasks (daily bench wipe) and
 * longer-cycle tasks (yearly gutter clean) contribute equally on the
 * final mean — which matches the product intention documented in
 * PROJECT.md Key Decisions.
 */

export function computeCoverage(
  tasks: Task[],
  latestByTask: Map<string, CompletionRecord>,
  now: Date,
): number {
  const active = tasks.filter((t) => !t.archived);
  if (active.length === 0) return 1.0;

  let sum = 0;
  let counted = 0;
  for (const task of active) {
    const last = latestByTask.get(task.id) ?? null;
    const nextDue = computeNextDue(task, last, now);
    if (!nextDue) continue;
    const overdueDays = Math.max(
      0,
      (now.getTime() - nextDue.getTime()) / 86400000,
    );
    const health = Math.max(
      0,
      Math.min(1, 1 - overdueDays / task.frequency_days),
    );
    sum += health;
    counted += 1;
  }
  return counted === 0 ? 1.0 : sum / counted;
}
