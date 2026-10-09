import { startOfWeek } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import type { CompletionRecord } from '@/lib/completions';

/**
 * Personal streak (05-01 Task 2, D-08, PERS-03).
 *
 * PURE module: takes `now` + `timezone` as arguments; no Date.now reads.
 * Matches the Phase 3 band-classification idiom for timezone-safe week
 * boundaries:
 *
 *   localWeekStartUtc = fromZonedTime(startOfWeek(toZonedTime(now, tz)), tz)
 *
 * Formula (per D-08):
 *   Starting from the calendar week containing `now` (Sunday-start, local
 *   time in the home's IANA timezone), count consecutive weeks BACKWARD
 *   where the user had ≥1 completion. Stop at the first week with zero.
 *
 * Callers MUST pre-filter `completions` to the user of interest — this
 * function does not inspect `completed_by_id`. The tests lock that
 * contract (see tests/unit/personal-streak.test.ts).
 *
 * DST safety: date-fns-tz's fromZonedTime / toZonedTime handle AEST↔AEDT
 * transitions cleanly, so weeks containing the DST boundary (25h or 23h
 * long) still aggregate correctly.
 */
export function computePersonalStreak(
  completions: CompletionRecord[],
  now: Date,
  timezone: string,
): number {
  if (completions.length === 0) return 0;

  // Current week boundary (local midnight on local Sunday) as a UTC instant.
  const zonedNow = toZonedTime(now, timezone);
  const currentWeekStart = fromZonedTime(
    startOfWeek(zonedNow),
    timezone,
  );

  // Bucket completions into week-offsets by computing each completion's
  // OWN local-week-start and stepping back from currentWeekStart. Going
  // through startOfWeek(toZonedTime(...), tz) avoids DST phantom-weeks
  // (where a naive `(currentStart - t) / 7d` rounds wrong when the span
  // crosses a 23h or 25h Sunday).
  const weeksWithCompletion = new Set<number>();
  const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
  for (const c of completions) {
    const t = new Date(c.completed_at);
    // Completion's own week start (local midnight on its local Sunday).
    const completionWeekStart = fromZonedTime(
      startOfWeek(toZonedTime(t, timezone)),
      timezone,
    );
    if (completionWeekStart.getTime() > currentWeekStart.getTime()) continue; // future — ignore
    // Weeks between the two week-starts. Round to nearest integer because
    // DST weeks measure 25h/23h for one day each transition, which makes
    // the raw ms ratio 6.86–7.14 weeks instead of an exact integer.
    const diffMs = currentWeekStart.getTime() - completionWeekStart.getTime();
    const weekOffset = Math.round(diffMs / MS_PER_WEEK);
    weeksWithCompletion.add(weekOffset);
  }

  // Walk forward from week 0, stop at first missing week.
  let streak = 0;
  while (weeksWithCompletion.has(streak)) {
    streak += 1;
  }
  return streak;
}
