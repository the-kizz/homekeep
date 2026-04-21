'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/**
 * EarlyCompletionDialog (03-03 Plan, D-07 + COMP-02).
 *
 * Confirms an early completion when the task was done within the last
 * 25% of its cycle. The server action (03-01 completeTaskAction) has
 * already returned `{ requiresConfirm: true, ...}` and the client owns
 * the UX decision from here: Cancel closes without writing; "Mark done
 * anyway" re-invokes the action with `{ force: true }` to bypass the
 * guard.
 *
 * Accessibility: Radix Dialog provides focus trap, aria-modal, ESC
 * close. The dialog mounts only when `state` is non-null (BandView
 * conditional render), so the open/close animation runs from the
 * correct mounted boundary.
 *
 * Pitfall 12 (Sheet + Dialog stacking): when the caller opens this
 * dialog from inside the TaskDetailSheet, it MUST close the Sheet
 * BEFORE setting guardState. TaskDetailSheet's Complete button does
 * this via `onOpenChange(false)` prior to `onComplete(taskId)` in
 * its handleComplete. No simultaneous focus traps.
 *
 * Copy (D-07): when `lastCompletedAt` is null (no prior completion;
 * just-created task), we reference the task's created-date via the
 * engine's fallback — but for display we gracefully explain that the
 * task "was just created" to avoid the confusing "last done 0 days
 * ago" phrasing.
 */
export type GuardState = {
  taskId: string;
  taskName: string;
  frequencyDays: number;
  lastCompletedAt: string | null;
  nowDate: Date;
};

export function EarlyCompletionDialog({
  state,
  onConfirm,
  onCancel,
}: {
  state: GuardState;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const reference = state.lastCompletedAt ? new Date(state.lastCompletedAt) : null;
  const daysSince = reference
    ? Math.max(
        0,
        Math.round(
          (state.nowDate.getTime() - reference.getTime()) / 86400000,
        ),
      )
    : 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent data-testid="early-completion-dialog">
        <DialogHeader>
          <DialogTitle>Mark &ldquo;{state.taskName}&rdquo; done?</DialogTitle>
          <DialogDescription>
            {state.lastCompletedAt
              ? `Last done ${daysSince} day${daysSince === 1 ? '' : 's'} ago, every ${state.frequencyDays} day${state.frequencyDays === 1 ? '' : 's'}.`
              : `Task was just created. Usually done every ${state.frequencyDays} day${state.frequencyDays === 1 ? '' : 's'}.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onCancel}
            data-testid="guard-cancel"
          >
            Cancel
          </Button>
          <Button onClick={onConfirm} data-testid="guard-confirm">
            Mark done anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
