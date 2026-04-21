// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/conroyke56/homekeep
import { addDays, differenceInDays } from 'date-fns';

/**
 * Task scheduling — next-due computation (02-05 Plan, D-13 + SPEC §8.5).
 *
 * PURE module: no I/O, no wall-clock Date construction, no Date.now. Every
 * call is deterministic given its arguments, which makes the edge-case matrix in
 * tests/unit/task-scheduling.test.ts straightforward to cover (13 cases).
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
 * Returns:
 *   - `null` if the task is archived.
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
 */
export function computeNextDue(
  task: Task,
  lastCompletion: Completion | null,
  now: Date,
): Date | null {
  if (task.archived) return null;

  if (
    !Number.isInteger(task.frequency_days) ||
    task.frequency_days < 1
  ) {
    throw new Error(`Invalid frequency_days: ${task.frequency_days}`);
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
