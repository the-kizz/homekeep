'use client';

import { formatInTimeZone } from 'date-fns-tz';

/**
 * NextDueDisplay — formats a next-due Date in the home's IANA timezone.
 *
 * Client Component so `date-fns-tz`'s timezone database loads on the
 * client boundary (keeps the server bundle smaller). The input `date` is
 * a UTC-equivalent instant produced by `computeNextDue` in
 * lib/task-scheduling.ts; formatting in the home's timezone happens HERE
 * and only here; date math never runs in non-UTC zones (research
 * §Pattern: Next-Due Computation timezone note line 1217).
 *
 * When `date` is null (archived task — computeNextDue returns null), we
 * render a subtle "Archived" hint instead. Parents that already filter
 * out archived tasks will never hit this branch, but the safe default
 * avoids a crash if they forget.
 */
export function NextDueDisplay({
  date,
  timezone,
}: {
  date: Date | null;
  timezone: string;
}) {
  if (!date) {
    return <span className="text-muted-foreground">Archived</span>;
  }
  const formatted = formatInTimeZone(date, timezone, 'MMM d, yyyy');
  return <time dateTime={date.toISOString()}>{formatted}</time>;
}
