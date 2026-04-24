// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep

/**
 * Phase 14 (SEAS-06, D-07..D-10): dormant-task classifier for UI
 * rendering.
 *
 * PURE module: deterministic over (tasks, now, timezone). No I/O, no
 * wall-clock reads.
 *
 * A task is "dormant" when it has a seasonal window (both
 * active_from_month AND active_to_month non-null) AND the current month
 * in `timezone` is outside that window. Archived tasks are ALWAYS
 * excluded — defense-in-depth alongside callers that already filter
 * archived via `filter: 'archived = false'`.
 *
 * Why a dedicated classifier (not reusing band-classification):
 * computeTaskBands calls computeNextDue which returns null for dormant
 * tasks per SEAS-02, so bands NEVER see them. The UI still wants to
 * list them in a "Sleeping" section. This classifier is the parallel
 * read path that bubbles dormants up with their wake-up date.
 *
 * Timezone posture: month extraction goes through toZonedTime so the
 * home's local calendar answers "is this month dormant?" — matching
 * the Phase 11 seasonal-wakeup branch in computeNextDue. The caller
 * always has a concrete IANA tz available (Server Components load
 * `home.timezone`; BandView / PersonTaskList receive it as a prop),
 * so we never fall through to UTC here (unlike the `timezone?`
 * optional on computeNextDue which v1.0 callers can omit).
 */

import { toZonedTime } from 'date-fns-tz';
import {
  isInActiveWindow,
  nextWindowOpenDate,
  type Task,
} from '@/lib/task-scheduling';

/**
 * Shape of a dormant task in the result list. Extends the input Task
 * with the two fields the UI needs: `name` (always present — required
 * by the input-type bound) and `nextOpenDate` (precomputed wake-up
 * date as a UTC instant). `area_name` is optional because only some
 * callers (by-area page) have it resolved.
 */
export type DormantTaskEntry = Task & {
  name: string;
  area_name?: string;
  nextOpenDate: Date;
};

/**
 * Classify the given tasks into the dormant subset. Returns a new
 * array sorted ASC by nextOpenDate (soonest wake-up first).
 *
 * The generic bound requires `name` on the input so the output can
 * carry it without an extra lookup at the call-site.
 */
export function classifyDormantTasks<
  T extends Task & { name: string; area_name?: string },
>(
  tasks: T[],
  now: Date,
  timezone: string,
): DormantTaskEntry[] {
  const zonedNow = toZonedTime(now, timezone);
  const nowMonth = zonedNow.getMonth() + 1; // 1..12
  const out: DormantTaskEntry[] = [];

  for (const t of tasks) {
    if (t.archived) continue;
    const from = t.active_from_month;
    const to = t.active_to_month;
    if (from == null || to == null) continue; // year-round → never dormant
    if (isInActiveWindow(nowMonth, from, to)) continue; // in season
    // Dormant — compute wake-up date.
    const nextOpenDate = nextWindowOpenDate(now, from, to, timezone);
    out.push({
      ...t,
      nextOpenDate,
    });
  }

  // Sort ASC by nextOpenDate — soonest wake-up first.
  out.sort((a, b) => a.nextOpenDate.getTime() - b.nextOpenDate.getTime());
  return out;
}
