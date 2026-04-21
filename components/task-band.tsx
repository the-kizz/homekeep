'use client';

import { formatInTimeZone, toZonedTime } from 'date-fns-tz';
import { startOfDay, addDays } from 'date-fns';
import { TaskRow } from '@/components/task-row';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { ClassifiedTask } from '@/lib/band-classification';

/**
 * TaskBand (03-02 Plan, D-12 + D-13).
 *
 * Reusable band Card with a header + a list of TaskRow children.
 * When `groupByDay` is not supplied, defaults to `true` when
 * `tasks.length > 5` and `false` otherwise (D-13). When grouping is
 * active, tasks are bucketed under Today / Tomorrow / weekday-name
 * headings derived via `formatInTimeZone` — NEVER raw `.getDay()`,
 * which would read the server's timezone (Pitfall 2).
 *
 * Empty-band policy (D-12): when `tasks.length === 0`, returns
 * `null` so the band (header + card) disappears entirely. The
 * caller decides whether to render an empty-state placeholder
 * elsewhere (the page-level CTA when the whole home has zero
 * tasks is owned by `<BandView>`).
 *
 * ClassifiedTask carries the pure classification fields (nextDue,
 * daysDelta). `<BandView>` attaches `name` onto each item before
 * handing it to this component — the cast at the render site is
 * a structural contract, not a bug (see 03-02 PLAN Task 2 Step A
 * note).
 */
export function TaskBand({
  label,
  tasks,
  onComplete,
  onDetail,
  pendingTaskId,
  timezone,
  variant,
  groupByDay,
  now,
}: {
  label: string;
  tasks: ClassifiedTask[];
  onComplete: (taskId: string) => void;
  /** 03-03 extension: forwarded to TaskRow for right-click / long-press. */
  onDetail?: (taskId: string) => void;
  pendingTaskId: string | null;
  timezone: string;
  variant?: 'overdue' | 'thisWeek' | 'horizon';
  /** Defaults to `tasks.length > 5` per D-13. */
  groupByDay?: boolean;
  now: Date;
}) {
  if (tasks.length === 0) return null;

  const shouldGroup = groupByDay ?? tasks.length > 5;

  if (!shouldGroup) {
    return (
      <Card
        data-band={variant ?? label.toLowerCase().replace(/\s+/g, '-')}
      >
        <CardHeader>
          <CardTitle>{label}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {tasks.map((t) => (
            <TaskRow
              key={t.id}
              task={{
                id: t.id,
                name: (t as ClassifiedTask & { name: string }).name,
                frequency_days: t.frequency_days,
              }}
              onComplete={onComplete}
              onDetail={onDetail}
              pending={pendingTaskId === t.id}
              daysDelta={t.daysDelta}
              variant={variant}
            />
          ))}
        </CardContent>
      </Card>
    );
  }

  // Day-grouping branch. Keys are yyyy-MM-dd in the home's timezone.
  const zonedNow = toZonedTime(now, timezone);
  const todayKey = formatInTimeZone(
    startOfDay(zonedNow),
    timezone,
    'yyyy-MM-dd',
  );
  const tomorrowKey = formatInTimeZone(
    addDays(startOfDay(zonedNow), 1),
    timezone,
    'yyyy-MM-dd',
  );

  const buckets = new Map<string, ClassifiedTask[]>();
  for (const t of tasks) {
    const key = formatInTimeZone(t.nextDue, timezone, 'yyyy-MM-dd');
    const arr = buckets.get(key) ?? [];
    arr.push(t);
    buckets.set(key, arr);
  }

  // Preserve ASC ordering across keys.
  const orderedKeys = Array.from(buckets.keys()).sort();

  return (
    <Card data-band={variant ?? label.toLowerCase().replace(/\s+/g, '-')}>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {orderedKeys.map((key) => {
          const bucket = buckets.get(key)!;
          const anchor = bucket[0].nextDue;
          const heading =
            key === todayKey
              ? 'Today'
              : key === tomorrowKey
                ? 'Tomorrow'
                : formatInTimeZone(anchor, timezone, 'EEEE');
          return (
            <div key={key} className="space-y-1">
              <h3
                className="text-xs uppercase tracking-wide text-muted-foreground"
                data-day-group={key}
              >
                {heading}
              </h3>
              <div className="space-y-2">
                {bucket.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={{
                      id: t.id,
                      name: (t as ClassifiedTask & { name: string }).name,
                      frequency_days: t.frequency_days,
                    }}
                    onComplete={onComplete}
                    onDetail={onDetail}
                    pending={pendingTaskId === t.id}
                    daysDelta={t.daysDelta}
                    variant={variant}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
