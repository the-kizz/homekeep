'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { archiveTask } from '@/lib/actions/tasks';

/**
 * TaskDetailSheet (03-03 Plan, D-17, VIEW-06).
 *
 * Opens on long-press / right-click of a task row (the row-tap itself
 * is the PRIMARY one-tap completion action; the detail sheet is the
 * SECONDARY view-details action). Shows:
 *   - task name + area + frequency + schedule mode (in the header)
 *   - optional notes
 *   - "Recent completions" list (last 5, passed in as a prop from the
 *     parent Server Component — client PB can't read HttpOnly cookies,
 *     so we hydrate once on render)
 *   - Complete (triggers the same completeTaskAction path as row-tap;
 *     Pitfall 12: sheet CLOSES first so the guard dialog's focus trap
 *     doesn't compete with the sheet's)
 *   - Edit link → /h/[homeId]/tasks/[taskId] (existing Phase 2 route)
 *   - Archive button → archiveTask server action (existing Phase 2)
 *
 * Responsive side: Sheet slides from the BOTTOM on small viewports
 * (<640px) and from the RIGHT on sm+. useIsDesktop is SSR-safe —
 * initial render assumes mobile, hydrates on first effect.
 */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)');
    const handler = () => setIsDesktop(mq.matches);
    handler();
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isDesktop;
}

export function TaskDetailSheet({
  open,
  onOpenChange,
  task,
  recentCompletions,
  timezone,
  homeId,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: {
    id: string;
    name: string;
    frequency_days: number;
    schedule_mode: 'cycle' | 'anchored';
    anchor_date: string | null;
    notes: string;
    area_name?: string;
  } | null;
  recentCompletions: Array<{ id: string; completed_at: string }>;
  timezone: string;
  homeId: string;
  onComplete: (taskId: string) => void;
}) {
  const isDesktop = useIsDesktop();
  const [, startTransition] = useTransition();

  if (!task) return null;

  const handleComplete = () => {
    // Pitfall 12: close the sheet BEFORE triggering the guard dialog path.
    onOpenChange(false);
    onComplete(task.id);
  };

  const handleArchive = () => {
    startTransition(async () => {
      await archiveTask(task.id);
      onOpenChange(false);
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isDesktop ? 'right' : 'bottom'}
        className="w-full sm:max-w-md"
        data-testid="task-detail-sheet"
      >
        <SheetHeader>
          <SheetTitle>{task.name}</SheetTitle>
          <SheetDescription>
            {task.area_name ?? 'Unassigned area'} · Every{' '}
            {task.frequency_days}
            {task.frequency_days === 1 ? ' day' : ' days'}
            {task.schedule_mode === 'anchored' ? ' (anchored)' : ''}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 p-4">
          {task.notes ? (
            <p className="text-sm text-muted-foreground">{task.notes}</p>
          ) : null}

          <section>
            <h3 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
              Recent completions
            </h3>
            {recentCompletions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Never completed yet.
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {recentCompletions.map((c) => (
                  <li key={c.id} data-completion-id={c.id}>
                    {formatInTimeZone(
                      new Date(c.completed_at),
                      timezone,
                      'MMM d, yyyy',
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="flex flex-wrap gap-2">
            <Button onClick={handleComplete} data-testid="detail-complete">
              Complete
            </Button>
            <Button asChild variant="outline">
              <Link href={`/h/${homeId}/tasks/${task.id}`}>Edit</Link>
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleArchive}
              data-testid="detail-archive"
            >
              Archive
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
