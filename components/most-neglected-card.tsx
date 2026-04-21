'use client';

import { AlertCircle } from 'lucide-react';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
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
 * Interaction: tapping the Complete button calls `onComplete(task.id)`.
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
    <Card
      data-most-neglected-card
      data-task-id={task.id}
      data-days-overdue={task.daysOverdue}
      className="border-primary/20 bg-primary/5"
    >
      <CardContent className="flex items-start gap-3 p-4">
        <AlertCircle
          className="mt-0.5 size-5 shrink-0 text-primary"
          aria-hidden="true"
        />
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2 font-display text-xs font-medium uppercase tracking-[0.12em] text-primary">
            <span>Most neglected</span>
          </div>
          <p className="truncate text-sm font-medium">{task.name}</p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {task.area_name && <span>in {task.area_name}</span>}
            <span
              className="rounded-full bg-muted px-2 py-0.5 tabular-nums"
              data-overdue-chip
            >
              {task.daysOverdue} {task.daysOverdue === 1 ? 'day' : 'days'}{' '}
              overdue
            </span>
          </div>
          <p className="pt-1 text-xs text-muted-foreground">
            Been a while — ready to tackle this?
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => onComplete(task.id)}
          disabled={pending}
          className="shrink-0 transition-colors duration-200"
        >
          {pending ? 'Completing…' : 'Complete it →'}
        </Button>
      </CardContent>
    </Card>
  );
}
