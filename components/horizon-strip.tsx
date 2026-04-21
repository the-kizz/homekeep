'use client';

import { useState } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import { addMonths, startOfMonth } from 'date-fns';
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

/**
 * HorizonStrip (03-02 Plan, D-14, VIEW-04, Pitfall 2).
 *
 * A 12-month CSS grid starting from the current month in the home's
 * IANA timezone. Each cell is a tappable `<button>` showing the
 * month abbreviation and 0..3 warm-accent dots (plus `+N` overflow
 * when a month has more than 3 tasks). Tapping a populated cell
 * opens a bottom `<Sheet>` drawer listing the tasks falling in that
 * month with their exact due dates.
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
}: {
  tasks: ClassifiedTask[];
  now: Date;
  timezone: string;
}) {
  const [openMonthKey, setOpenMonthKey] = useState<string | null>(null);

  const months: { key: string; label: string; date: Date }[] = [];
  for (let i = 0; i < 12; i++) {
    const d = startOfMonth(addMonths(now, i));
    months.push({
      key: formatInTimeZone(d, timezone, 'yyyy-MM'),
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
          <div className="grid grid-cols-6 gap-1 sm:grid-cols-12">
            {months.map((m) => {
              const count = (buckets.get(m.key) ?? []).length;
              const isCurrent = m.key === currentMonthKey;
              // Populated months stay at full opacity so the eye
              // lands on them; empty months dim to 55% so the strip
              // reads as "activity graph" not a full calendar.
              const labelOpacity = count > 0 ? 'opacity-100' : 'opacity-55';
              return (
                <button
                  key={m.key}
                  type="button"
                  disabled={count === 0}
                  onClick={() => count > 0 && setOpenMonthKey(m.key)}
                  className={
                    'flex min-h-[44px] flex-col items-center justify-center gap-1 rounded border p-1 text-xs disabled:opacity-50 ' +
                    (isCurrent ? 'border-primary/40' : '')
                  }
                  aria-label={`${m.label} — ${count} task${count === 1 ? '' : 's'}`}
                  data-month-key={m.key}
                  data-month-count={count}
                  data-current-month={isCurrent ? 'true' : undefined}
                >
                  <span
                    className={`font-display text-muted-foreground ${labelOpacity}`}
                  >
                    {m.label}
                  </span>
                  <span className="flex items-center gap-0.5">
                    {Array.from({ length: Math.min(count, 3) }).map(
                      (_, i) => (
                        <span
                          key={i}
                          className="size-1.5 rounded-full bg-primary"
                        />
                      ),
                    )}
                    {count > 3 && (
                      <span className="text-[10px]">+{count - 3}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
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
            {openTasks.map((t) => (
              <li key={t.id} data-horizon-task-id={t.id}>
                <span className="font-medium">
                  {(t as ClassifiedTask & { name: string }).name}
                </span>
                <span className="text-muted-foreground">
                  {' — '}
                  {formatInTimeZone(t.nextDue, timezone, 'MMM d')}
                </span>
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>
    </Card>
  );
}
