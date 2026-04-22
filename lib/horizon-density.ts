// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/conroyke56/homekeep

/**
 * Phase 16 Plan 01 (16-CONTEXT D-01, D-04, D-10 / LVIZ-01, LVIZ-03,
 * LVIZ-04): pure helpers for the horizon-density + shift-badge UI.
 *
 * PURE module: no I/O, no Date.now reads, no mutation of inputs. Same
 * posture as lib/seasonal-rendering.ts + lib/load-smoothing.ts. Every
 * call is deterministic given its arguments.
 *
 * Two exports:
 *   - getIdealAndScheduled(task, lastCompletion, now, timezone)
 *       Returns {ideal, scheduled, displaced} for the ⚖️ shift-badge
 *       + TaskDetailSheet Schedule section. `ideal` strips
 *       next_due_smoothed before re-running computeNextDue so the
 *       caller sees the natural cadence date independent of any LOAD
 *       smoothing. `displaced` triggers at ≥1 calendar day absolute
 *       diff (LVIZ-04 threshold — sub-day drift from DST / rounding
 *       does NOT count).
 *   - computeMonthDensity(tasks, latestByTask, now, timezone)
 *       Returns Map<yyyy-MM, count> for the HorizonStrip tint. O(N)
 *       in tasks, reuses the caller's already-fetched latestByTask
 *       completion Map. Archived + dormant + completed-OOFT + invalid
 *       tasks all surface as null from computeNextDue and are
 *       excluded here upstream.
 *
 * Design notes:
 *   - D-04 strip pattern matches components/reschedule-action-sheet.tsx
 *     lines 98-114. `{...task, next_due_smoothed: null}` shallow-clones
 *     so the caller's input is untouched.
 *   - LOAD-06 anchored-bypass is handled by computeNextDue's own
 *     schedule_mode guard (lib/task-scheduling.ts:256) — this module
 *     does not need an explicit short-circuit. Both `ideal` and
 *     `scheduled` paths see the same anchor-branch result.
 *   - Calendar-day precision: we compute day-diff via rounded ms to
 *     86_400_000, then gate displaced on abs(diff) >= 1. This matches
 *     LVIZ-04's "displacement > 0 days" spec — a 3-hour DST jog does
 *     not count; a full day does.
 */

import { formatInTimeZone } from 'date-fns-tz';
import {
  computeNextDue,
  type Completion,
  type Task,
} from '@/lib/task-scheduling';

export type ShiftInfo = {
  ideal: Date | null;
  scheduled: Date | null;
  displaced: boolean;
};

/**
 * Phase 16 (D-04, D-10 / LVIZ-03, LVIZ-04): compute both the natural
 * ideal next-due and the (possibly LOAD-smoothed) scheduled next-due
 * for a task.
 *
 * Algorithm:
 *   - scheduled = computeNextDue(task, lastCompletion, now, undefined, tz)
 *   - ideal     = computeNextDue({...task, next_due_smoothed: null},
 *                                lastCompletion, now, undefined, tz)
 *   - displaced = ideal && scheduled
 *                 && abs(daysDiff(scheduled, ideal)) >= 1
 *
 * Null cases (ideal=null OR scheduled=null): `displaced` is always
 * `false`. This covers archived (→ null), same-season dormant (→ null),
 * and completed-OOFT (→ null) — all surfaces the ⚖️ badge must skip.
 *
 * LOAD-06 anchored bypass: computeNextDue's schedule_mode guard
 * ensures anchored-mode tasks ignore next_due_smoothed by construction.
 * Both paths return the same anchor result → displaced=false. We rely
 * on that guard rather than duplicating the check here.
 */
export function getIdealAndScheduled(
  task: Task,
  lastCompletion: Completion | null,
  now: Date,
  timezone?: string,
): ShiftInfo {
  const scheduled = computeNextDue(
    task,
    lastCompletion,
    now,
    undefined,
    timezone,
  );
  // D-04 strip-smoothed pattern — shallow-clone so caller's task is
  // untouched, then re-run computeNextDue to get the natural date.
  const naturalTask: Task = { ...task, next_due_smoothed: null };
  const ideal = computeNextDue(
    naturalTask,
    lastCompletion,
    now,
    undefined,
    timezone,
  );

  if (!ideal || !scheduled) {
    return { ideal, scheduled, displaced: false };
  }

  // LVIZ-04: displacement counts only at ≥1 full calendar day. Sub-day
  // drift (DST, rounding) does not qualify. Round to day resolution
  // before comparison.
  const diffDays = Math.abs(
    Math.round((scheduled.getTime() - ideal.getTime()) / 86400000),
  );
  return { ideal, scheduled, displaced: diffDays >= 1 };
}

/**
 * Phase 16 (D-01, D-03 / LVIZ-01): month-density counter for the
 * HorizonStrip tint.
 *
 * Returns Map<monthKey, count> where monthKey = formatInTimeZone(date,
 * tz, 'yyyy-MM'). Months with zero tasks do NOT appear in the Map
 * (D-03 empty-month = no tint — consumer renders default cell
 * background for keys missing from the Map).
 *
 * Exclusions (all via computeNextDue returning null):
 *   - archived tasks
 *   - same-season dormant seasonal tasks
 *   - completed OOFT tasks
 *   - invalid frequency_days
 *
 * O(N) in tasks; no wall-clock reads; safe to call per render. The
 * HorizonStrip caller can reuse its already-computed buckets Map
 * (identical bucketing) rather than calling this helper if it prefers
 * — this helper exists for surfaces that don't have ClassifiedTask
 * but still want density (ex. integration tests, future analytics).
 */
export function computeMonthDensity(
  tasks: Task[],
  latestByTask: Map<string, { completed_at: string }>,
  now: Date,
  timezone: string,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const task of tasks) {
    if (task.archived) continue;
    const last = latestByTask.get(task.id) ?? null;
    const next = computeNextDue(task, last, now, undefined, timezone);
    if (!next) continue;
    const key = formatInTimeZone(next, timezone, 'yyyy-MM');
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}
