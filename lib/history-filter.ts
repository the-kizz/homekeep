import { startOfDay, startOfMonth, startOfWeek } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import type { CompletionRecord } from '@/lib/completions';

/**
 * History filter predicate applier (05-01 Task 2, D-10, HIST-02).
 *
 * PURE module: takes `now` + `timezone` as arguments. The three ranges
 * ('today', 'week', 'month') are anchored at LOCAL midnight in the home's
 * IANA timezone using the same DST-safe idiom as band-classification.ts
 * and personal-streak.ts:
 *
 *   localRangeStartUtc = fromZonedTime(startOfX(toZonedTime(now, tz)), tz)
 *
 * Contract:
 *   - personId undefined/null disables the person predicate.
 *   - areaId undefined/null disables the area predicate.
 *   - range 'all' returns the unconstrained input.
 *   - range 'today' / 'week' / 'month' compares `new Date(completed_at)`
 *     (UTC instant) against the computed local range-start.
 *   - Input order is preserved (Array.prototype.filter semantics).
 *
 * When areaId is set, the caller MUST supply `taskAreaMap` (a
 * task_id → area_id lookup) — completions do not store area_id directly
 * (they relate through tasks.area_id), so the UI server component builds
 * this map once per request from the tasks fetch.
 */

export type HistoryRange = 'today' | 'week' | 'month' | 'all';

export type HistoryFilter = {
  personId?: string | null;
  areaId?: string | null;
  range: HistoryRange;
};

export function filterCompletions(
  completions: CompletionRecord[],
  filter: HistoryFilter,
  taskAreaMap: Map<string, string>,
  now: Date,
  timezone: string,
): CompletionRecord[] {
  const rangeStart = computeRangeStart(filter.range, now, timezone);
  return completions.filter((c) => {
    if (filter.personId && c.completed_by_id !== filter.personId) return false;
    if (filter.areaId) {
      const areaId = taskAreaMap.get(c.task_id);
      if (areaId !== filter.areaId) return false;
    }
    if (rangeStart && new Date(c.completed_at) < rangeStart) return false;
    return true;
  });
}

function computeRangeStart(
  range: HistoryRange,
  now: Date,
  timezone: string,
): Date | null {
  if (range === 'all') return null;
  const zonedNow = toZonedTime(now, timezone);
  if (range === 'today') return fromZonedTime(startOfDay(zonedNow), timezone);
  if (range === 'week') return fromZonedTime(startOfWeek(zonedNow), timezone);
  // range === 'month'
  return fromZonedTime(startOfMonth(zonedNow), timezone);
}
