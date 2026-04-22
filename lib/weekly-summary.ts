import { startOfWeek } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { computeCoverage } from '@/lib/coverage';
import { computeNextDue, type Task } from '@/lib/task-scheduling';
import { reduceLatestByTask, type CompletionRecord } from '@/lib/completions';
import type { Override } from '@/lib/schedule-overrides';

/**
 * Weekly summary (06-01 Task 2, D-12, GAME-03).
 *
 * PURE composition of existing primitives:
 *   - reduceLatestByTask (lib/completions.ts) — pick latest per task
 *   - computeCoverage (lib/coverage.ts) — health mean across active tasks
 *   - computeNextDue (lib/task-scheduling.ts) — per-task overdue days
 *
 * Returns:
 *   {
 *     completionsCount,    // completions WITHIN the current local week
 *     coveragePercent,     // round(computeCoverage * 100)
 *     topArea,             // area with MOST completions this week
 *                          //   → tie-break alphabetically by name;
 *                          //   → no completions → 'No area' or areas[0].name
 *     mostNeglectedTask    // task with MAX daysOverdue
 *                          //   → tie-break newer `created` wins;
 *                          //   → no overdue / no tasks → null
 *   }
 *
 * Empty-home invariant (D-06) flows through computeCoverage: zero active
 * tasks → coverage 1.0 → 100%. Tasks ⊂ the home; callers pre-filter.
 *
 * Task shape note: the `Task` type exported from lib/task-scheduling does
 * NOT carry `area_id` or `name` — those live on the PB record. For the
 * weekly summary the caller MUST pass a Task extended with `area_id: string`
 * and `name: string` (covered by the `TaskWithAreaName` type alias below).
 * All existing callers (Phase 3 / 5 dashboards) already select these fields
 * in their PB getFullList queries.
 */

export type TaskWithAreaName = Task & { area_id: string; name: string };

export type WeeklySummary = {
  completionsCount: number;
  coveragePercent: number;
  topArea: string;
  mostNeglectedTask: {
    id: string;
    name: string;
    daysOverdue: number;
  } | null;
};

/**
 * 10-02 Plan: Accepts `overridesByTask: Map<string, Override>` as the 4th
 * argument (BEFORE `now`, matching the family convention in coverage /
 * band-classification / area-coverage). The Map is forwarded into
 * `computeCoverage` for the coverage mean, AND consulted per-task in the
 * mostNeglectedTask reducer via `overridesByTask.get(task.id)` passed to
 * `computeNextDue`. An active, unconsumed override shifts that task's
 * next-due to `snooze_until`, so SNZE-09-style snoozed-overdue tasks
 * stop being "most neglected" and stop pulling the coverage mean down.
 */
export function computeWeeklySummary(
  completions: CompletionRecord[],
  tasks: TaskWithAreaName[],
  areas: Array<{ id: string; name: string }>,
  overridesByTask: Map<string, Override>,
  now: Date,
  timezone: string,
): WeeklySummary {
  // Local-timezone week start (DST-safe, mirrors personal/household streak).
  const zonedNow = toZonedTime(now, timezone);
  const weekStart = fromZonedTime(startOfWeek(zonedNow), timezone);

  // 1) completionsCount — completions whose completed_at >= weekStart
  let completionsCount = 0;
  // Also track per-area counts for topArea computation
  const perAreaCount = new Map<string, number>();
  const taskAreaLookup = new Map<string, string>();
  for (const t of tasks) taskAreaLookup.set(t.id, t.area_id);

  for (const c of completions) {
    if (new Date(c.completed_at).getTime() >= weekStart.getTime()) {
      completionsCount += 1;
      const areaId = taskAreaLookup.get(c.task_id);
      if (areaId) {
        perAreaCount.set(areaId, (perAreaCount.get(areaId) ?? 0) + 1);
      }
    }
  }

  // 2) coveragePercent — round(computeCoverage * 100)
  const latestByTask = reduceLatestByTask(completions);
  const coveragePercent = Math.round(
    computeCoverage(tasks, latestByTask, overridesByTask, now) * 100,
  );

  // 3) topArea — MAX perAreaCount; alphabetical tie-break; fallback when
  //    no completions this week.
  let topArea: string;
  if (perAreaCount.size === 0) {
    topArea = areas[0]?.name ?? 'No area';
  } else {
    // Build candidates by descending count, then alphabetical ascending.
    const withNames = areas
      .filter((a) => perAreaCount.has(a.id))
      .map((a) => ({ name: a.name, count: perAreaCount.get(a.id) ?? 0 }));
    withNames.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    });
    topArea = withNames[0]?.name ?? areas[0]?.name ?? 'No area';
  }

  // 4) mostNeglectedTask — MAX daysOverdue across active tasks; tie-break
  //    by newer `created` descending. computeNextDue returns null for
  //    archived or mis-configured tasks; we skip those.
  let best: {
    id: string;
    name: string;
    daysOverdue: number;
    created: string;
  } | null = null;
  for (const task of tasks) {
    if (task.archived) continue;
    const last = latestByTask.get(task.id) ?? null;
    const override = overridesByTask.get(task.id);
    const nextDue = computeNextDue(task, last, now, override);
    if (!nextDue) continue;
    const daysOverdue = Math.max(
      0,
      (now.getTime() - nextDue.getTime()) / 86400000,
    );
    if (daysOverdue <= 0) continue;
    if (
      !best ||
      daysOverdue > best.daysOverdue ||
      (daysOverdue === best.daysOverdue &&
        new Date(task.created).getTime() > new Date(best.created).getTime())
    ) {
      best = {
        id: task.id,
        name: task.name,
        daysOverdue,
        created: task.created,
      };
    }
  }

  const mostNeglectedTask = best
    ? { id: best.id, name: best.name, daysOverdue: best.daysOverdue }
    : null;

  return { completionsCount, coveragePercent, topArea, mostNeglectedTask };
}
