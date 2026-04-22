import Link from 'next/link';
import { computeNextDue, type Task } from '@/lib/task-scheduling';
import { NextDueDisplay } from '@/components/next-due-display';
import { Card } from '@/components/ui/card';

/**
 * TaskList — Server Component rendering active tasks with their next-due
 * date (Phase 2 `lastCompletion` is always null, so next-due is derived
 * purely from creation / anchor / frequency).
 *
 * Server Component (no 'use client') because computeNextDue is pure and
 * no interactive state is needed. The <NextDueDisplay> child is the only
 * Client Component boundary — it pulls in date-fns-tz's timezone database
 * on the client side, keeping the server bundle lean.
 *
 * Archived tasks are filtered out here as a defensive second pass; the
 * server-side fetch on area detail / home dashboard should also pass
 * `filter: "archived = false"` to avoid transporting archived rows over
 * the wire.
 */

export type TaskRow = {
  id: string;
  name: string;
  created: string;
  frequency_days: number;
  schedule_mode: 'cycle' | 'anchored';
  anchor_date: string | null;
  archived: boolean;
};

export function TaskList({
  tasks,
  homeId,
  timezone,
  now,
}: {
  tasks: TaskRow[];
  homeId: string;
  timezone: string;
  /** Pass from the page as `new Date()` so the Server Component owns the
   * clock read, keeping the children pure. */
  now: Date;
}) {
  const active = tasks.filter((t) => !t.archived);
  if (active.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No tasks yet.</p>
    );
  }
  return (
    <ul className="space-y-2">
      {active.map((t) => {
        const taskForScheduling: Task = {
          id: t.id,
          created: t.created,
          archived: t.archived,
          frequency_days: t.frequency_days,
          schedule_mode: t.schedule_mode,
          anchor_date: t.anchor_date,
        };
        // 10-02 Plan: pass `undefined` as the 4th override arg. TaskList is
        // the Phase 2 area-detail task list — it doesn't surface coverage
        // or band state; overrides ride on the dashboard / by-area / person
        // surfaces instead. v1.0 behavior is preserved intentionally.
        const nextDue = computeNextDue(taskForScheduling, null, now, undefined);
        return (
          <li key={t.id} data-task-id={t.id} data-task-name={t.name}>
            <Link
              href={`/h/${homeId}/tasks/${t.id}`}
              className="block"
            >
              <Card className="p-3 transition-colors hover:bg-muted">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{t.name}</span>
                  <NextDueDisplay date={nextDue} timezone={timezone} />
                </div>
                <span className="text-xs text-muted-foreground">
                  Every {t.frequency_days}{' '}
                  {t.frequency_days === 1 ? 'day' : 'days'}
                  {t.schedule_mode === 'anchored' ? ' (anchored)' : ''}
                </span>
              </Card>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
