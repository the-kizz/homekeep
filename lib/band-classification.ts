// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/conroyke56/homekeep
import { addDays, startOfDay } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { computeNextDue, type Task } from '@/lib/task-scheduling';
import type { CompletionRecord } from '@/lib/completions';

/**
 * Band classification (03-01 Plan, Pattern 7, D-04 + D-05, Pitfall 2).
 *
 * PURE module: takes `now` + `timezone` as arguments; no Date.now() reads,
 * no environment side-effects.
 *
 * The critical edge: "overdue" means "due before midnight TODAY in the
 * home's IANA timezone". A naive UTC comparison ignores that a home in
 * Australia/Melbourne (UTC+10) has a different local-midnight moment
 * than a home in America/Los_Angeles. Pitfall 2 codifies the fix:
 *
 *   localMidnightTodayUtc = fromZonedTime(startOfDay(toZonedTime(now, tz)), tz)
 *
 * This pattern is DST-safe by construction (date-fns-tz handles the
 * offset table), verified against
 * github.com/marnusw/date-fns-tz.
 *
 * Bands:
 *   - overdue:  nextDue <  localMidnightToday
 *   - thisWeek: localMidnightToday <= nextDue <= localMidnightToday + 7d
 *   - horizon:  nextDue > localMidnightToday + 7d
 *
 * Sort (D-05):
 *   - overdue:  ASC by daysDelta (most negative first — worst overdue first)
 *   - thisWeek: ASC by nextDue
 *   - horizon:  ASC by nextDue
 *
 * Archived tasks are excluded from every band. Tasks whose
 * computeNextDue returns null (e.g. archived, or invalid input
 * caught by the pure function) are silently skipped.
 */

export type ClassifiedTask = Task & { nextDue: Date; daysDelta: number };

export type Bands = {
  overdue: ClassifiedTask[];
  thisWeek: ClassifiedTask[];
  horizon: ClassifiedTask[];
};

export function computeTaskBands(
  tasks: Task[],
  latestByTask: Map<string, CompletionRecord>,
  now: Date,
  timezone: string,
): Bands {
  // "Local midnight today" represented as a UTC Date instant. See
  // module docstring for the DST-safe derivation.
  const zonedNow = toZonedTime(now, timezone);
  const localMidnightTodayUtc = fromZonedTime(
    startOfDay(zonedNow),
    timezone,
  );
  const localMidnightPlus7Utc = addDays(localMidnightTodayUtc, 7);

  const classified: ClassifiedTask[] = [];
  for (const task of tasks) {
    if (task.archived) continue;
    const last = latestByTask.get(task.id) ?? null;
    const nextDue = computeNextDue(task, last, now);
    if (!nextDue) continue;
    const daysDelta =
      (nextDue.getTime() - localMidnightTodayUtc.getTime()) / 86400000;
    classified.push({ ...task, nextDue, daysDelta });
  }

  const overdue = classified
    .filter((t) => t.nextDue < localMidnightTodayUtc)
    .sort((a, b) => a.daysDelta - b.daysDelta); // most-negative first

  const thisWeek = classified
    .filter(
      (t) =>
        t.nextDue >= localMidnightTodayUtc &&
        t.nextDue <= localMidnightPlus7Utc,
    )
    .sort((a, b) => a.nextDue.getTime() - b.nextDue.getTime());

  const horizon = classified
    .filter((t) => t.nextDue > localMidnightPlus7Utc)
    .sort((a, b) => a.nextDue.getTime() - b.nextDue.getTime());

  return { overdue, thisWeek, horizon };
}
