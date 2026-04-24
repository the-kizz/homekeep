'use client';
// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep

import { formatInTimeZone } from 'date-fns-tz';

/**
 * ShiftBadge (Phase 16 Plan 01, D-05, D-06 / LVIZ-03, LVIZ-04).
 *
 * Inline <span> rendering the ⚖️ balance-scale emoji with an
 * accessibility label + native `title` tooltip. Placed next to the
 * task name on BandView TaskRow, PersonTaskList TaskRow, and the
 * HorizonStrip Sheet drawer — anywhere the user sees a task that the
 * LOAD smoother displaced from its natural cadence.
 *
 * D-05 tooltip choice: native `title` attribute (no new radix-tooltip
 * dep). Ships everywhere with zero weight added. Caller owns the
 * display: it should only render this component when
 * getIdealAndScheduled(...).displaced === true (LVIZ-04 threshold
 * ≥1 calendar day).
 *
 * Never rendered on DormantTaskRow (Phase 14 compat per D-07 —
 * dormant surface has no shift semantics; the "Sleeps until" badge is
 * the only marker). Never rendered for anchored tasks because
 * computeNextDue's schedule_mode guard means their `ideal` and
 * `scheduled` paths collapse to the same anchor (LOAD-06 bypass).
 *
 * T-16-01 Information Disclosure mitigation: the `title` string is
 * built from `formatInTimeZone(date, tz, 'MMM d')` output — date
 * objects cannot carry script payloads, and date-fns-tz returns
 * strictly-formatted ASCII. No user-controlled string flows into
 * the title.
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
      aria-label="Shifted"
      title={tooltip}
      className="ml-1 inline-flex items-center text-xs"
    >
      ⚖️
    </span>
  );
}
