'use client';

import { formatInTimeZone, toZonedTime } from 'date-fns-tz';
import { startOfDay, addDays } from 'date-fns';
import { TaskRow } from '@/components/task-row';
import clsx from 'clsx';
import type { ClassifiedTask } from '@/lib/band-classification';
import { BAND_STACK, BAND_SURFACE, BandHeader } from '@/components/band-header';

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
 * Empty-band policy: when `tasks.length === 0` the band returns `null`
 * unless the caller passes `showEmpty`, in which case it keeps its
 * header and says so in one calm line ("Nothing overdue. Nice.").
 * The dashboard opts in so the bands stay in a fixed place and an
 * empty one reads as good news rather than as something missing; the
 * page-level CTA for a home with zero tasks is still `<BandView>`'s.
 *
 * ClassifiedTask carries the pure classification fields (nextDue,
 * daysDelta). `<BandView>` attaches `name` onto each item before
 * handing it to this component — the cast at the render site is
 * a structural contract, not a bug (see 03-02 PLAN Task 2 Step A
 * note).
 */
const SURFACE = BAND_SURFACE;

const EMPTY_COPY: Record<'overdue' | 'thisWeek', string> = {
  overdue: 'Nothing overdue. Nice.',
  thisWeek: 'Nothing due this week.',
};

export function TaskBand({
  label,
  tasks,
  onComplete,
  onDetail,
  onQuickComplete,
  primaryTap,
  pendingTaskId,
  timezone,
  variant,
  groupByDay,
  now,
  shiftByTaskId,
  showEmpty,
}: {
  label: string;
  tasks: ClassifiedTask[];
  onComplete: (taskId: string) => void;
  /** 03-03 extension: forwarded to TaskRow for right-click / long-press. */
  onDetail?: (taskId: string) => void;
  /** Forwarded to TaskRow; when set, each row gets a one-tap check button. */
  onQuickComplete?: (taskId: string) => void;
  /** v1.2.1 PATCH2-06: forwarded to TaskRow. Defaults to 'detail' when
   * onDetail is provided; PersonTaskList passes 'complete' so its
   * reschedule-on-long-press UX stays reachable via tap→complete. */
  primaryTap?: 'complete' | 'detail';
  pendingTaskId: string | null;
  timezone: string;
  variant?: 'overdue' | 'thisWeek' | 'horizon';
  /** Defaults to `tasks.length > 5` per D-13. */
  groupByDay?: boolean;
  now: Date;
  /**
   * Phase 16 Plan 01 (D-06 / LVIZ-03): per-task shift info keyed by
   * task id. Parent (BandView / PersonTaskList) computes once per
   * render; TaskBand threads the matching entry to each TaskRow so
   * the ⚖️ badge renders inline next to the task name when displaced.
   * Optional → backward-compat with existing Phase 3 call sites.
   */
  shiftByTaskId?: Map<
    string,
    { idealDate: Date; scheduledDate: Date; displaced: boolean }
  >;
  /** Keep the band visible with its calm empty line when it has no tasks. */
  showEmpty?: boolean;
}) {
  if (tasks.length === 0) {
    const emptyCopy =
      variant === 'overdue' || variant === 'thisWeek'
        ? EMPTY_COPY[variant]
        : null;
    if (!showEmpty || !emptyCopy) return null;
    return (
      <section data-band={variant} data-band-empty className={BAND_STACK}>
        <BandHeader label={label} count={0} variant={variant} />
        <div className={SURFACE}>
          <p className="px-4 py-4 text-sm text-muted-foreground">{emptyCopy}</p>
        </div>
      </section>
    );
  }

  const shouldGroup = groupByDay ?? tasks.length > 5;

  if (!shouldGroup) {
    return (
      <section
        data-band={variant ?? label.toLowerCase().replace(/\s+/g, '-')}
        className={BAND_STACK}
      >
        <BandHeader label={label} count={tasks.length} variant={variant} />
        <div className={clsx(SURFACE, 'divide-y divide-hairline')}>
          {tasks.map((t) => {
            // Phase 16 Plan 01 (D-06 / LVIZ-03): thread ShiftBadge
            // info only when this task is actually displaced. Parent
            // decides the threshold via getIdealAndScheduled.
            const shift = shiftByTaskId?.get(t.id);
            const rowShiftInfo =
              shift && shift.displaced
                ? {
                    idealDate: shift.idealDate,
                    scheduledDate: shift.scheduledDate,
                    timezone,
                  }
                : undefined;
            return (
              <TaskRow
                key={t.id}
                task={{
                  id: t.id,
                  name: (t as ClassifiedTask & { name: string }).name,
                  frequency_days: t.frequency_days,
                  effective: (
                    t as ClassifiedTask & {
                      effective?: import('@/lib/assignment').EffectiveAssignee;
                    }
                  ).effective,
                }}
                onComplete={onComplete}
                onDetail={onDetail}
                onQuickComplete={onQuickComplete}
                primaryTap={primaryTap}
                pending={pendingTaskId === t.id}
                daysDelta={t.daysDelta}
                variant={variant}
                shiftInfo={rowShiftInfo}
              />
            );
          })}
        </div>
      </section>
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
    <section
      data-band={variant ?? label.toLowerCase().replace(/\s+/g, '-')}
      className={BAND_STACK}
    >
      <BandHeader label={label} count={tasks.length} variant={variant} />
      <div className={clsx(SURFACE, 'divide-y divide-hairline')}>
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
            <div key={key}>
              <h3
                className="section-label border-b border-hairline bg-muted/40 px-4 py-1.5"
                data-day-group={key}
              >
                {heading}
              </h3>
              <div className="divide-y divide-hairline">
                {bucket.map((t) => {
                  const shift = shiftByTaskId?.get(t.id);
                  const rowShiftInfo =
                    shift && shift.displaced
                      ? {
                          idealDate: shift.idealDate,
                          scheduledDate: shift.scheduledDate,
                          timezone,
                        }
                      : undefined;
                  return (
                    <TaskRow
                      key={t.id}
                      task={{
                        id: t.id,
                        name: (t as ClassifiedTask & { name: string }).name,
                        frequency_days: t.frequency_days,
                        effective: (
                          t as ClassifiedTask & {
                            effective?: import('@/lib/assignment').EffectiveAssignee;
                          }
                        ).effective,
                      }}
                      onComplete={onComplete}
                      onDetail={onDetail}
                      onQuickComplete={onQuickComplete}
                      primaryTap={primaryTap}
                      pending={pendingTaskId === t.id}
                      daysDelta={t.daysDelta}
                      variant={variant}
                      shiftInfo={rowShiftInfo}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
