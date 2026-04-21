import { startOfWeek } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import type { CompletionRecord } from '@/lib/completions';

/**
 * Household streak (06-01 Task 2, D-10, GAME-01).
 *
 * PURE module: takes `now` + `timezone` as arguments; no Date.now reads.
 * ALGORITHMICALLY IDENTICAL to lib/personal-streak.ts — the only
 * difference is the CALLER CONTRACT: callers pass the UNION of all
 * home members' completions (not a single user's slice). ANY member's
 * completion in a given calendar week counts that week toward the
 * streak.
 *
 * Formula (per D-10):
 *   Starting from the calendar week containing `now` (Sunday-start, local
 *   time in the home's IANA timezone), count consecutive weeks BACKWARD
 *   where the household had ≥1 completion. Stop at the first week with
 *   zero.
 *
 * DST safety: date-fns-tz's fromZonedTime / toZonedTime handle AEST↔AEDT
 * transitions cleanly; weeks containing a DST boundary (25h or 23h long)
 * still aggregate correctly. The `Math.round` on the ms ratio is the
 * hinge — a naive floor/ceil would mis-bucket the 23h-short week.
 */
export function computeHouseholdStreak(
  completions: CompletionRecord[],
  now: Date,
  timezone: string,
): number {
  if (completions.length === 0) return 0;

  const zonedNow = toZonedTime(now, timezone);
  const currentWeekStart = fromZonedTime(startOfWeek(zonedNow), timezone);

  const weeksWithCompletion = new Set<number>();
  const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
  for (const c of completions) {
    const t = new Date(c.completed_at);
    const completionWeekStart = fromZonedTime(
      startOfWeek(toZonedTime(t, timezone)),
      timezone,
    );
    if (completionWeekStart.getTime() > currentWeekStart.getTime()) continue; // future — ignore
    const diffMs =
      currentWeekStart.getTime() - completionWeekStart.getTime();
    const weekOffset = Math.round(diffMs / MS_PER_WEEK);
    weeksWithCompletion.add(weekOffset);
  }

  let streak = 0;
  while (weeksWithCompletion.has(streak)) {
    streak += 1;
  }
  return streak;
}
