'use client';
// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep

import { formatInTimeZone } from 'date-fns-tz';
import { Scale } from 'lucide-react';

/**
 * ShiftBadge (Phase 16 Plan 01, D-05, D-06 / LVIZ-03, LVIZ-04).
 *
 * Inline balance-scale mark (lucide `Scale`, 16px) with an accessible
 * label and a native `title` tooltip. Placed next to the task name on
 * BandView TaskRow, PersonTaskList TaskRow, and the HorizonStrip Sheet
 * drawer, anywhere the user sees a task that the LOAD smoother displaced
 * from its natural cadence. The Horizon legend names the same mark.
 *
 * D-05 tooltip choice: native `title` attribute (no new radix-tooltip
 * dep). Caller owns the display: it should only render this component
 * when getIdealAndScheduled(...).displaced === true (LVIZ-04 threshold
 * of at least 1 calendar day).
 *
 * Never rendered on DormantTaskRow (Phase 14 compat per D-07) and never
 * for anchored tasks (their ideal and scheduled dates are the same).
 *
 * T-16-01 Information Disclosure mitigation: the `title` string is
 * built from `formatInTimeZone(date, tz, 'MMM d')` output; no
 * user-controlled string flows into it.
 */
export function ShiftBadge({
  idealDate,
  scheduledDate,
  timezone,
}: {
  idealDate: Date;
  scheduledDate: Date;
  timezone: string;
}) {
  const idealStr = formatInTimeZone(idealDate, timezone, 'MMM d');
  const scheduledStr = formatInTimeZone(scheduledDate, timezone, 'MMM d');
  const tooltip = `Shifted from ${idealStr} to ${scheduledStr} to smooth household load`;
  return (
    <span
      data-shift-badge
      role="img"
      aria-label="Moved to balance the month"
      title={tooltip}
      className="ml-1.5 inline-flex translate-y-[2px] items-center text-muted-foreground"
    >
      <Scale className="size-4" strokeWidth={1.75} aria-hidden="true" />
    </span>
  );
}
