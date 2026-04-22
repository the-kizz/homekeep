// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/conroyke56/homekeep
import { addDays, differenceInDays } from 'date-fns';
import type { Override } from '@/lib/schedule-overrides';

/**
 * Task scheduling — next-due computation (02-05 Plan, D-13 + SPEC §8.5;
 * 10-02 Plan adds the override branch per D-06 + D-10).
 *
 * PURE module: no I/O, no wall-clock Date construction, no Date.now. Every
 * call is deterministic given its arguments, which makes the edge-case matrix in
 * tests/unit/task-scheduling.test.ts straightforward to cover.
 *
 * Timezone posture: all Dates here are UTC-equivalent instants. Storage in
 * PocketBase is UTC ISO strings. Rendering in the home's IANA timezone is a
 * *separate concern* handled by components/next-due-display.tsx via
 * date-fns-tz.formatInTimeZone — NEVER do date math in a non-UTC zone.
 * date-fns' addDays / differenceInDays operate on the UTC epoch and are
 * DST-safe by construction (RESEARCH §Pattern: Next-Due Computation
 * timezone handling note line 1217).
 */

export type Task = {
  id: string;
  created: string; // ISO 8601 UTC
  archived: boolean;
  frequency_days: number; // integer >= 1
  schedule_mode: 'cycle' | 'anchored';
  anchor_date: string | null; // ISO 8601 UTC; must be non-null when schedule_mode === 'anchored'
};

export type Completion = {
  completed_at: string; // ISO 8601 UTC — Phase 3+; in Phase 2 this is always null.
};

/**
 * Compute the next-due date for a task.
 *
 * Branch order (short-circuit precedence):
 *   1. archived → null
 *   2. frequency validation → throw
 *   3. **override branch** (Phase 10, D-06 + D-10): active + unconsumed
 *      override whose `snooze_until` post-dates the last completion wins.
 *   4. (Phase 12 will insert the `next_due_smoothed` LOAD branch here — D-07
 *      forward-compatibility.)
 *   5. cycle branch — base + frequency_days.
 *   6. anchored branch — step forward by whole cycles past `now`.
 *
 * Returns:
 *   - `null` if the task is archived.
 *   - `new Date(override.snooze_until)` when an active unconsumed override
 *     applies (see D-10 guard below).
 *   - For `cycle` mode: base = lastCompletion?.completed_at ?? task.created;
 *     next_due = base + frequency_days.
 *   - For `anchored` mode:
 *     - If the anchor is in the future, the anchor itself IS the next due.
 *     - Otherwise, step by whole frequency cycles until STRICTLY after now.
 *       We compute `cycles = floor(elapsed/freq) + 1` so that `elapsed == freq`
 *       lands two cycles out (the current cycle end IS now — we want the NEXT).
 *
 * Throws when `frequency_days` is not a positive integer — this is a defence
 * in depth alongside the zod `.int().min(1)` at the schema layer.
 *
 * Parameters:
 *   @param task             The task record (non-null, member-gated).
 *   @param lastCompletion   The latest completion for this task, or `null`
 *                           when there is none.
 *   @param now              Caller-supplied wall-clock instant (keeps this
 *                           function pure; tests pass fixed Dates).
 *   @param override         Optional (Phase 10 D-06). When present AND
 *                           `!override.consumed_at` AND
 *                           `snooze_until > lastCompletion.completed_at`
 *                           (D-10 read-time filter), returns
 *                           `new Date(override.snooze_until)`. Omitting the
 *                           argument yields byte-identical v1.0 behavior.
 *
 *                           The D-10 guard is defense-in-depth: if the
 *                           atomic consumption write (Plan 10-03) ever
 *                           misses — or an admin blanks `consumed_at` back
 *                           to null after the task has been completed —
 *                           we fall through to the natural branch rather
 *                           than leaving the task "perma-snoozed" past a
 *                           real completion.
 *
 * Override `consumed_at` interpretation (A2 from Plan 10-01): PB 0.37.1 may
 * return `null`, `''`, or `undefined` for a fresh row with no consumed_at
 * set. The falsy check `!override.consumed_at` covers all three.
 */
export function computeNextDue(
  task: Task,
  lastCompletion: Completion | null,
  now: Date,
  override?: Override,
): Date | null {
  if (task.archived) return null;

  if (
    !Number.isInteger(task.frequency_days) ||
    task.frequency_days < 1
  ) {
    throw new Error(`Invalid frequency_days: ${task.frequency_days}`);
  }

  // ─── Phase 10 override branch (D-06, D-10 read-time filter) ─────────
  // Override wins when:
  //   (a) override is present
  //   (b) override.consumed_at is falsy (null, '', or undefined per A2)
  //   (c) snooze_until > lastCompletion.completed_at
  //       (D-10 read-time filter — defense in depth against missed
  //        atomic-consumption writes / admin-UI consumed_at reset)
  //
  // When (c) fails, the snooze is stale (completion landed after the
  // snooze date); fall through to the natural branch. Without (c),
  // a post-completion race that missed the consumption write would
  // leave the task "perma-snoozed" forever — user would complete
  // daily and still see it as "due next month". NEVER do that.
  //
  // Phase 12 will insert the `next_due_smoothed` branch BETWEEN this
  // override branch and the cycle/anchored branches (D-07
  // forward-compatibility).
  if (override && !override.consumed_at) {
    const snoozeUntil = new Date(override.snooze_until);
    const lastCompletedAt = lastCompletion
      ? new Date(lastCompletion.completed_at)
      : null;
    if (!lastCompletedAt || snoozeUntil > lastCompletedAt) {
      return snoozeUntil;
    }
    // else: stale override; fall through to cycle/anchored natural branch.
  }

  if (task.schedule_mode === 'cycle') {
    const baseIso = lastCompletion?.completed_at ?? task.created;
    const base = new Date(baseIso);
    return addDays(base, task.frequency_days);
  }

  // anchored
  const baseIso = task.anchor_date ?? task.created;
  const base = new Date(baseIso);

  // Anchor in the future: the anchor IS the next due (no cycling yet).
  if (base.getTime() > now.getTime()) return base;

  // Otherwise find the next cycle boundary strictly after `now`.
  // floor(elapsed/freq) + 1 guarantees we step past `now` even when
  // elapsed is an exact multiple of freq.
  const elapsedDays = differenceInDays(now, base);
  const cycles = Math.floor(elapsedDays / task.frequency_days) + 1;
  return addDays(base, cycles * task.frequency_days);
}
