'use client';

// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep

import clsx from 'clsx';
import { formatInTimeZone } from 'date-fns-tz';

/**
 * DormantTaskRow (Phase 14 SEAS-06, D-07 + D-08).
 *
 * Presentational. Renders a single dormant task as a dimmed row with
 * a "Sleeps until <MMM yyyy>" badge. NOT tap-completable from this
 * surface (D-08): the onClick is an explicit no-op, and
 * `pointer-events-none` on the container is a belt-and-braces guard
 * in case any wrapping handler is delegated via event bubbling. The
 * badge already communicates why the row is inactive; no toast keeps
 * the UI quiet. Users can still complete dormant tasks via the
 * History page or task detail page (Phase 15 scope).
 *
 * The component intentionally accepts NO `onComplete` prop — there is
 * no way for a caller to wire a completion action through this row.
 * This mitigates T-14-06 (Tampering: dormant no-op bypass via injected
 * onClick): the row surface has no completion affordance at all.
 *
 * Badge text format is LOAD-BEARING: the integration suite on
 * port 18102 (Task 2) asserts the exact "Sleeps until Oct 2026"
 * literal for a task waking 2026-10-01 Perth. Changing the date
 * format here will break the contract — update the test alongside.
 *
 * Styling pattern matches the existing TaskRow (Phase 3) shape, with
 * the dormant visual overrides: opacity-50, muted-foreground, no
 * hover affordance, aria-disabled="true".
 */
export function DormantTaskRow({
  task,
  timezone,
}: {
  task: {
    id: string;
    name: string;
    area_name?: string;
    nextOpenDate: Date;
  };
  timezone: string;
}) {
  const badgeDate = formatInTimeZone(task.nextOpenDate, timezone, 'MMM yyyy');
  const badgeText = `Sleeps until ${badgeDate}`;

  return (
    <div
      role="group"
      aria-disabled="true"
      data-task-id={task.id}
      data-task-name={task.name}
      data-dormant="true"
      data-next-open-iso={task.nextOpenDate.toISOString()}
      onClick={() => {
        /* Phase 14 SEAS-06 (D-08): silent no-op on dormant rows. The
           badge already communicates why the row is inactive; no
           toast keeps the UI quiet. Users who want to complete a
           dormant task must go through History or the task detail
           page (Phase 15 Reschedule scope). */
      }}
      className={clsx(
        'flex w-full min-h-[44px] items-center justify-between gap-2 rounded border p-3 text-left',
        'opacity-50 text-muted-foreground',
        // Belt-and-braces: pointer-events-none prevents any wrapping
        // delegated click handler from firing against this row. The
        // inline onClick is already a no-op; this blocks the bubble.
        'pointer-events-none select-none',
      )}
    >
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{task.name}</span>
        {task.area_name && (
          <span className="text-xs">{task.area_name}</span>
        )}
      </div>
      <span
        data-sleeps-until
        className="shrink-0 rounded-md border border-border bg-muted px-2 py-0.5 text-xs tabular-nums"
      >
        {badgeText}
      </span>
    </div>
  );
}
