'use client';

import { useState } from 'react';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/card';
import type { ClassifiedTask } from '@/lib/band-classification';
import { ShiftBadge } from '@/components/shift-badge';

/**
 * HorizonStrip (03-02 Plan, D-14, VIEW-04, Pitfall 2).
 *
 * A 12-month CSS grid starting from the current month in the home's
 * IANA timezone. Each cell is a tappable `<button>` showing the
 * month abbreviation. Tapping a populated cell opens a bottom
 * `<Sheet>` drawer listing the tasks falling in that month with
 * their exact due dates.
 *
 * Phase 16 Plan 01 (D-01, D-03 / LVIZ-01): each cell's background is
 * tinted bg-primary/{10,30,50} proportional to that month's task
 * count relative to the heaviest-month max. Empty months receive no
 * tint (D-03 fallback to default cell background). This REPLACES the
 * old 3-dot per-cell render with an at-a-glance density signal.
 *
 * Phase 16 Plan 01 (D-06 / LVIZ-03): when the Sheet drawer is open,
 * each task row wears the ⚖️ ShiftBadge if the parent supplied a
 * `shiftByTaskId` Map entry with `displaced=true`. Parent
 * (BandView/PersonTaskList) owns the compute — the Map comes in
 * already keyed so this component stays render-only.
 *
 * Timezone safety: bucketing uses
 * `formatInTimeZone(date, timezone, 'yyyy-MM')` so a task whose
 * UTC next-due is late on June 30 in Melbourne (UTC+10) correctly
 * lands in the July cell (Pitfall 2 canonical failure mode).
 *
 * Empty state (D-12 specifics): when there are no tasks in the
 * next 12 months, the entire grid is replaced with
 * "Nothing on the horizon yet — looking clear!" text — no empty
 * cells, no disabled buttons.
 *
 * Tap targets: each cell has `min-h-[44px]` (Pitfall 8). Empty
 * months are `disabled` + `opacity-50` so they're visually
 * de-emphasised but still occupy grid space (a calendar with
 * holes would be more visually jarring than a dimmed cell).
 */
export function HorizonStrip({
  tasks,
  now,
  timezone,
  shiftByTaskId,
}: {
  tasks: ClassifiedTask[];
  now: Date;
  timezone: string;
  /**
   * Phase 16 Plan 01 (D-06 / LVIZ-03): optional per-task shift info
   * keyed by task id. When a task's entry has `displaced: true`, the
   * Sheet drawer renders `<ShiftBadge>` next to the task name.
   * Parent (BandView / PersonTaskList) computes this Map once per
   * render via `getIdealAndScheduled` and passes it down. Defaults
   * to empty → backward-compat with Phase 3 call sites.
   */
  shiftByTaskId?: Map<
    string,
    { idealDate: Date; scheduledDate: Date; displaced: boolean }
  >;
}) {
  const [openMonthKey, setOpenMonthKey] = useState<string | null>(null);

  // Month boundaries come from the home's wall clock, not the host's:
  // date-fns startOfMonth/addMonths work in host-local time, which put the
  // strip a month off whenever host and home disagreed on the current month.
  const [startYear, startMonth] = formatInTimeZone(now, timezone, 'yyyy-MM')
    .split('-')
    .map(Number);
  const months: { key: string; label: string; date: Date }[] = [];
  for (let i = 0; i < 12; i++) {
    const monthIndex = startMonth - 1 + i;
    const year = startYear + Math.floor(monthIndex / 12);
    const key = `${year}-${String((monthIndex % 12) + 1).padStart(2, '0')}`;
    const d = fromZonedTime(`${key}-01T00:00:00`, timezone);
    months.push({
      key,
      label: formatInTimeZone(d, timezone, 'MMM'),
      date: d,
    });
  }

  const buckets = new Map<string, ClassifiedTask[]>();
  for (const t of tasks) {
    const k = formatInTimeZone(t.nextDue, timezone, 'yyyy-MM');
    const arr = buckets.get(k) ?? [];
    arr.push(t);
    buckets.set(k, arr);
  }

  // Phase 16 Plan 01 (D-01 / LVIZ-01): max-count normaliser for the
  // density tint. Math.max-with-1 floor prevents a divide-by-zero
  // edge case (though the emptyHorizon short-circuit below already
  // catches tasks.length === 0).
  let maxCount = 0;
  for (const arr of buckets.values()) {
    if (arr.length > maxCount) maxCount = arr.length;
  }
  if (maxCount < 1) maxCount = 1;

  const openTasks = openMonthKey ? (buckets.get(openMonthKey) ?? []) : [];
  const openMonthLabel = openMonthKey
    ? (months.find((m) => m.key === openMonthKey)?.label ?? openMonthKey)
    : '';

  const emptyHorizon = tasks.length === 0;
  // The current month is always index 0 (see the loop above: i=0 is now).
  // We tag that cell with a subtle warm border so the strip has a clear
  // "you are here" anchor without shouting.
  const currentMonthKey = months[0]?.key;

  return (
    <Card data-band="horizon">
      <CardHeader>
        <CardTitle className="font-display text-lg font-medium text-foreground/85">
          Horizon
        </CardTitle>
      </CardHeader>
      <CardContent>
        {emptyHorizon ? (
          <p className="text-sm text-muted-foreground">
            Nothing on the horizon yet — looking clear!
          </p>
        ) : (
          <>
          <div className="grid grid-cols-6 gap-1 sm:grid-cols-12">
            {months.map((m) => {
              const count = (buckets.get(m.key) ?? []).length;
              const isCurrent = m.key === currentMonthKey;
              // Populated months stay at full opacity so the eye
              // lands on them; empty months dim to 65% — just visible
              // enough to stay scannable as context without competing
              // with the populated cells. Phase 9 UX audit bumped from
              // 55% (too ghosted) to 65%.
              const labelOpacity = count > 0 ? 'opacity-100' : 'opacity-65';
              // Phase 16 Plan 01 (D-01 / LVIZ-01): three-step density
              // tint. Thresholds: empty → none; ratio ≤ 0.33 → /10;
              // 0.33 < ratio ≤ 0.66 → /30; ratio > 0.66 → /50.
              // D-03: empty months render with no tint (default bg).
              const ratio = count === 0 ? 0 : count / maxCount;
              const tintClass =
                count === 0
                  ? ''
                  : ratio <= 0.33
                    ? 'bg-primary/10'
                    : ratio <= 0.66
                      ? 'bg-primary/30'
                      : 'bg-primary/50';
              return (
                <button
                  key={m.key}
                  type="button"
                  disabled={count === 0}
                  onClick={() => count > 0 && setOpenMonthKey(m.key)}
                  className={
                    'flex min-h-[44px] flex-col items-center justify-center gap-1 rounded border p-1 text-xs disabled:opacity-50 ' +
                    (tintClass ? tintClass + ' ' : '') +
                    (isCurrent ? 'border-primary/40' : '')
                  }
                  aria-label={`${m.label} — ${count} task${count === 1 ? '' : 's'}`}
                  data-month-key={m.key}
                  data-month-count={count}
                  data-tint={tintClass || 'none'}
                  data-current-month={isCurrent ? 'true' : undefined}
                >
                  <span
                    className={`font-display text-muted-foreground ${labelOpacity}`}
                  >
                    {m.label}
                  </span>
                </button>
              );
            })}
          </div>
          {/* The tint and the ⚖️ badge are otherwise unexplained; one
              quiet line keeps the strip readable without a help page. */}
          <p
            data-horizon-legend
            className="mt-3 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground"
          >
            <span aria-hidden="true" className="inline-flex gap-0.5">
              <span className="size-2.5 rounded-sm border bg-primary/10" />
              <span className="size-2.5 rounded-sm border bg-primary/30" />
              <span className="size-2.5 rounded-sm border bg-primary/50" />
            </span>
            {/* Whitespace between flex items is not drawn (gap spaces
                them) but keeps the sentence intact for screen readers. */}
            {/* The tint reads darker on light cards and brighter on dark
                ones, so the copy names its strength, not its shade. */}
            <span>Stronger tint means a busier month</span>{' '}
            <span aria-hidden="true">·</span>{' '}
            <span>⚖️ moved to balance the month</span>
          </p>
          </>
        )}
      </CardContent>

      <Sheet
        open={!!openMonthKey}
        onOpenChange={(o) => !o && setOpenMonthKey(null)}
      >
        <SheetContent
          side="bottom"
          className="sm:mx-auto sm:max-w-md"
        >
          <SheetHeader>
            <SheetTitle>{openMonthLabel}</SheetTitle>
          </SheetHeader>
          <ul className="space-y-2 p-4">
            {openTasks.map((t) => {
              // Phase 16 Plan 01 (D-06 / LVIZ-03): render ShiftBadge
              // inline when the parent supplied a displaced entry for
              // this task. Hidden on dormant/anchored per upstream
              // contract — the parent already filters those via
              // getIdealAndScheduled returning displaced=false.
              const shift = shiftByTaskId?.get(t.id);
              const showBadge =
                shift && shift.displaced && shift.idealDate && shift.scheduledDate;
              return (
                <li key={t.id} data-horizon-task-id={t.id}>
                  <span className="font-medium">
                    {(t as ClassifiedTask & { name: string }).name}
                  </span>
                  {showBadge && (
                    <ShiftBadge
                      idealDate={shift!.idealDate}
                      scheduledDate={shift!.scheduledDate}
                      timezone={timezone}
                    />
                  )}
                  <span className="text-muted-foreground">
                    {' — '}
                    {formatInTimeZone(t.nextDue, timezone, 'MMM d')}
                  </span>
                </li>
              );
            })}
          </ul>
        </SheetContent>
      </Sheet>
    </Card>
  );
}
