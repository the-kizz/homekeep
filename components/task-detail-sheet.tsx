'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import { differenceInCalendarDays } from 'date-fns';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { archiveTask } from '@/lib/actions/tasks';
import type { EffectiveAssignee } from '@/lib/assignment';
import { AssigneeDisplay } from '@/components/assignee-display';
import { getIdealAndScheduled } from '@/lib/horizon-density';
import type { Task } from '@/lib/task-scheduling';

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
  onReschedule,
  lastCompletion,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: {
    id: string;
    name: string;
    /**
     * Phase 16 Plan 01 (LVIZ-05): widened from `number` to
     * `number | null` so the Schedule section can thread the task
     * into getIdealAndScheduled for OOFT + cycle alike. BandView /
     * PersonTaskList already filter the detail-click path to
     * recurring tasks, but widening here keeps the prop shape
     * aligned with Task for safe casting.
     */
    frequency_days: number | null;
    schedule_mode: 'cycle' | 'anchored';
    anchor_date: string | null;
    notes: string;
    area_name?: string;
    /** 04-03 D-10 + TASK-04: resolved cascade from the Server Component. */
    effective?: EffectiveAssignee;
    /**
     * Phase 16 Plan 01 (LVIZ-05): additional fields threaded from
     * the Task record so the Schedule section can call
     * getIdealAndScheduled at render. All optional — callers that
     * don't pass them get the Phase 15 shape back (Schedule section
     * silently omitted).
     */
    created?: string;
    active_from_month?: number | null;
    active_to_month?: number | null;
    preferred_days?: 'any' | 'weekend' | 'weekday' | null;
    next_due_smoothed?: string | null;
    due_date?: string | null;
    reschedule_marker?: string | null;
  } | null;
  recentCompletions: Array<{ id: string; completed_at: string }>;
  timezone: string;
  homeId: string;
  onComplete: (taskId: string) => void;
  /**
   * Phase 15 Plan 02 (D-05): optional Reschedule callback. When
   * provided, the footer renders a Reschedule button that closes
   * this sheet (Pitfall 12 pattern — avoid duelling focus traps with
   * the subsequent RescheduleActionSheet) before invoking the handler.
   */
  onReschedule?: (taskId: string) => void;
  /**
   * Phase 16 Plan 01 (LVIZ-05): most-recent completion for this task.
   * Parent (BandView / PersonTaskList) threads detailCompletions[0]
   * through — used by getIdealAndScheduled to compute the natural
   * ideal date for the Schedule section. Defaults to null → the
   * helper handles the no-completion branch (fresh task) correctly.
   */
  lastCompletion?: { completed_at: string } | null;
}) {
  const isDesktop = useIsDesktop();
  const [, startTransition] = useTransition();

  if (!task) return null;

  // Phase 16 Plan 01 (LVIZ-05, D-08, D-09): compute the Schedule
  // section's shift info per render. The helper is pure + cheap
  // (two computeNextDue calls). When any required Task field is
  // missing, we skip the compute — displayed=false collapses the
  // section entirely per D-09.
  const taskForShift: Task | null =
    task.created !== undefined
      ? {
          id: task.id,
          created: task.created,
          archived: false,
          frequency_days: task.frequency_days,
          schedule_mode: task.schedule_mode,
          anchor_date: task.anchor_date,
          due_date: task.due_date ?? null,
          preferred_days: task.preferred_days ?? null,
          active_from_month: task.active_from_month ?? null,
          active_to_month: task.active_to_month ?? null,
          next_due_smoothed: task.next_due_smoothed ?? null,
          reschedule_marker: task.reschedule_marker ?? null,
        }
      : null;
  const shift = taskForShift
    ? getIdealAndScheduled(
        taskForShift,
        lastCompletion ?? null,
        new Date(),
        timezone,
      )
    : { ideal: null, scheduled: null, displaced: false };

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
            {task.area_name ?? 'Unassigned area'} ·{' '}
            {task.frequency_days != null && task.frequency_days > 0
              ? `Every ${task.frequency_days}${task.frequency_days === 1 ? ' day' : ' days'}`
              : 'One-off'}
            {task.schedule_mode === 'anchored' ? ' (anchored)' : ''}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 p-4">
          {task.notes ? (
            <p className="text-sm text-muted-foreground">{task.notes}</p>
          ) : null}

          {/* Phase 16 Plan 01 (LVIZ-05, D-08, D-09): Schedule section
              only renders when LOAD shifted the task by ≥1 day. When
              ideal === scheduled (or either is null), this section is
              omitted — detail sheet collapses back to the Phase 15
              byte-identical shape. */}
          {shift.displaced && shift.ideal && shift.scheduled && (
            <section
              data-testid="detail-schedule"
              className="space-y-1"
            >
              <h3 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                Schedule
              </h3>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Ideal</dt>
                <dd>
                  {formatInTimeZone(shift.ideal, timezone, 'MMM d, yyyy')}
                </dd>
                <dt className="text-muted-foreground">Scheduled</dt>
                <dd>
                  {formatInTimeZone(
                    shift.scheduled,
                    timezone,
                    'MMM d, yyyy',
                  )}
                </dd>
              </dl>
              <p className="text-xs text-muted-foreground">
                Shifted by{' '}
                {Math.abs(
                  differenceInCalendarDays(shift.scheduled, shift.ideal),
                )}{' '}
                days to smooth household load.
              </p>
            </section>
          )}

          {task.effective && (
            <section data-testid="detail-assignee">
              <h3 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                Assigned to
              </h3>
              <AssigneeDisplay effective={task.effective} size="md" />
            </section>
          )}

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
            {/* Phase 15 Plan 02 (D-05): Reschedule entry point — only
                rendered when a caller wires onReschedule. Closes the
                sheet BEFORE firing the callback (Pitfall 12 precedent
                from the Complete button — avoid duelling focus traps
                with the subsequent RescheduleActionSheet). */}
            {onReschedule && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                  onReschedule(task.id);
                }}
                data-testid="detail-reschedule"
              >
                Reschedule
              </Button>
            )}
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
