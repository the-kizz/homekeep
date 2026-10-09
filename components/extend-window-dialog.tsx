// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep
'use client';

import { formatInTimeZone } from 'date-fns-tz';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { Task } from '@/lib/task-scheduling';

/**
 * Phase 15 Plan 02 ExtendWindowDialog (SNZE-08, D-10, D-11, D-12).
 *
 * Fires when the user picks a reschedule date outside the task's
 * active_from/to seasonal window. Three options (D-11):
 *   - Cancel             → no-op; caller leaves the action sheet open
 *                          so the user can pick a different date.
 *   - Extend active window → caller widens active_from/to to include the
 *                          picked month (via updateTask), then proceeds
 *                          with the original snooze/reschedule.
 *   - Continue anyway    → caller proceeds with the original action;
 *                          the task will appear dormant on that date
 *                          per isInActiveWindow. Warning copy shown
 *                          below the main description.
 *
 * This component is presentational — all state lives in the caller
 * (RescheduleActionSheet). Extend logic + server action wiring lives
 * in BandView / PersonTaskList (per D-12 "caller widens via updateTask").
 *
 * Trust boundary (T-15-02-04 Information disclosure): this dialog
 * requires EXPLICIT user click — no auto-extend path. "Continue anyway"
 * keeps the window unchanged; ONLY "Extend" widens. Cancel is a no-op.
 * Callers MUST NOT auto-select any option based on state.
 */
export function ExtendWindowDialog({
  open,
  onOpenChange,
  task,
  pickedDate,
  timezone,
  onCancel,
  onExtend,
  onContinueAnyway,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: Task & { name: string };
  /** yyyy-MM-dd — the reschedule target date that fell outside active
   *  window. Used for the month-label copy ("include <Month>"). */
  pickedDate: string;
  /** IANA timezone — used to render the picked month in home tz so
   *  "October" vs "November" matches the user's calendar view. */
  timezone: string;
  onCancel: () => void;
  onExtend: () => Promise<void> | void;
  onContinueAnyway: () => Promise<void> | void;
}) {
  const monthLabel =
    pickedDate && !Number.isNaN(new Date(pickedDate).getTime())
      ? formatInTimeZone(new Date(pickedDate), timezone, 'MMMM')
      : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="extend-window-dialog">
        <DialogHeader>
          <DialogTitle>Snooze past active window?</DialogTitle>
          <DialogDescription>
            &lsquo;{task.name}&rsquo; is only active from month{' '}
            {task.active_from_month} to {task.active_to_month}. The date you
            picked{monthLabel ? ` (${monthLabel})` : ''} is outside that
            window.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {monthLabel
            ? `Extend the window to include ${monthLabel}? Or continue — the task will be dormant on that date.`
            : 'Extend the window, or continue — the task will be dormant on that date.'}
        </p>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={onCancel}
            data-testid="extend-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              void onContinueAnyway();
            }}
            data-testid="extend-continue"
          >
            Continue anyway
          </Button>
          <Button
            onClick={() => {
              void onExtend();
            }}
            data-testid="extend-confirm"
          >
            Extend active window
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
