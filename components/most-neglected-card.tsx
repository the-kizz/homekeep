'use client';

import { Hourglass } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * MostNeglectedCard (06-03 Task 2, D-14, GAME-05).
 *
 * Dashboard-only nudge that surfaces the SINGLE most-overdue task in a
 * gentle, warm-accent card. CONTEXT §critical: "only render if there's
 * an overdue task; hide otherwise" — the component returns null when
 * `task === null`, keeping the dashboard visually clean on a healthy
 * home.
 *
 * Copy tone: warm nudge ("Been a while — ready to tackle this?"), NOT
 * alarming. Lucide `AlertCircle` in warm text, not red.
 *
 * Interaction: tapping the Do it now button calls `onComplete(task.id)`.
 * The consuming `<BandView>` forwards this to the shared `handleTap`
 * flow so the double-tap guard + optimistic update + router.refresh
 * all work identically to the TaskRow path. `pending` disables the
 * button AND changes the label to "Completing…" while the underlying
 * server action is in flight for THIS task id.
 *
 * Data attrs (E2E anchors):
 *   data-most-neglected-card — root; absent when task=null.
 *   data-task-id            — echoes task.id.
 *   data-days-overdue       — numeric days overdue.
 */
export type MostNeglectedTask = {
  id: string;
  name: string;
  daysOverdue: number;
  area_name?: string;
};

export function MostNeglectedCard({
  task,
  onComplete,
  pending,
}: {
  task: MostNeglectedTask | null;
  onComplete: (taskId: string) => void;
  pending: boolean;
}) {
  if (task === null) return null;

  return (
    <section
      data-most-neglected-card
      data-task-id={task.id}
      data-days-overdue={task.daysOverdue}
      aria-label="Most neglected"
      className="flex flex-col gap-3 rounded-xl border border-status-overdue/25 bg-status-overdue-soft p-4 bold:border-l-[3px] bold:border-l-status-overdue sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0 space-y-1">
        <p className="section-label flex items-center gap-1.5">
          <Hourglass
            className="size-3.5 text-status-overdue"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          Most neglected
        </p>
        <p className="font-display text-lg leading-snug font-medium text-foreground">
          {task.name}
        </p>
        <p className="text-[13px] leading-5 text-muted-foreground">
          <span className="font-medium text-status-overdue tabular-nums" data-overdue-chip>
            {task.daysOverdue} {task.daysOverdue === 1 ? 'day' : 'days'} overdue
          </span>
          {task.area_name && <> in {task.area_name}</>}
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={() => onComplete(task.id)}
        disabled={pending}
        className="shrink-0 self-start sm:self-center"
      >
        {pending ? 'Completing…' : 'Do it now'}
      </Button>
    </section>
  );
}
