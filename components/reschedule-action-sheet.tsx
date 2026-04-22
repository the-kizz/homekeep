// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/conroyke56/homekeep
'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatInTimeZone } from 'date-fns-tz';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  rescheduleTaskAction,
  snoozeTaskAction,
} from '@/lib/actions/reschedule';
import {
  computeNextDue,
  isInActiveWindow,
  type Completion,
  type Task,
} from '@/lib/task-scheduling';
import { ExtendWindowDialog } from '@/components/extend-window-dialog';

/**
 * Phase 15 Plan 02 RescheduleActionSheet (SNZE-01/02/03, D-04..D-06).
 *
 * Shadcn Sheet — slides from the bottom on mobile, renders with
 * sm:max-w-md on wider viewports. Contains:
 *   - Header: "Reschedule '{task.name}'"
 *   - Date picker (native <input type="date">) defaulting to the task's
 *     NATURAL next-due (D-06: computeNextDue with override=undefined AND
 *     next_due_smoothed stripped — we want the natural baseline, not a
 *     LOAD-smoothed projection that already accounts for household load).
 *   - Radio: "Just this time" (default per D-03) / "From now on"
 *   - Reschedule + Cancel buttons
 *
 * Submit semantics (D-04, SNZE-07):
 *   - "just-this-time" → snoozeTaskAction (Wave 1). Writes a
 *     schedule_overrides row. Phase 10 D-02 atomic-replace-active
 *     preserved server-side.
 *   - "from-now-on"    → rescheduleTaskAction (Wave 1). Mutates the
 *     task's anchor_date (anchored) OR next_due_smoothed (cycle) AND
 *     stamps reschedule_marker = now. Phase 17 REBAL preservation reads
 *     the marker. No override row written (D-09).
 *
 * Cross-window interception (D-10, T-15-02-04):
 *   - Before either submit fires, isInActiveWindow checks the picked
 *     month against the task's active_from/to window.
 *   - Out-of-window → ExtendWindowDialog opens with three explicit
 *     user-initiated options. No auto-extend path.
 *
 * Double-fire guard (T-15-02-05):
 *   - `pending` state gates `canSubmit`. The Reschedule button is
 *     disabled while a request is in flight; second click returns
 *     immediately.
 *
 * Presentational contract: the caller passes `onExtendWindow` which
 * performs the actual tasks.update to widen active_from/to. Keeps this
 * component free of server-action imports beyond the two reschedule
 * actions (the extension path is a task-update, not a reschedule).
 */
export function RescheduleActionSheet({
  open,
  onOpenChange,
  task,
  lastCompletion,
  timezone,
  onExtendWindow,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: Task & { name: string };
  lastCompletion: Completion | null;
  timezone: string;
  /**
   * D-12: caller widens active_from/to via tasks.update. Called with
   * the computed (newFrom, newTo) window bounds. Caller decides the
   * update mechanics (updateTask server action, direct PB write, etc.).
   * Bounded to (1..12) by the caller per T-15-02-07 EoP mitigation.
   */
  onExtendWindow: (newFrom: number, newTo: number) => Promise<void>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const [extendOpen, setExtendOpen] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState<
    null | 'just-this-time' | 'from-now-on'
  >(null);

  // D-06: default date = the NATURAL next-due. We strip next_due_smoothed
  // so computeNextDue's LOAD branch doesn't short-circuit to the
  // load-smoothed projection — the user reschedules from the natural
  // cadence baseline, not whatever the LOAD smoother already chose.
  // override=undefined keeps the override branch inert (reschedule is
  // about picking a NEW override/anchor, not reading a stale one).
  const naturalTask: Task = { ...task, next_due_smoothed: null };
  const defaultDate = computeNextDue(
    naturalTask,
    lastCompletion,
    new Date(),
    undefined,
    timezone,
  );
  const defaultDateStr = defaultDate
    ? formatInTimeZone(defaultDate, timezone, 'yyyy-MM-dd')
    : '';

  const [pickedDate, setPickedDate] = useState<string>(defaultDateStr);
  const [radio, setRadio] = useState<'just-this-time' | 'from-now-on'>(
    'just-this-time',
  );

  // Keep pickedDate in sync when task/lastCompletion changes across
  // re-opens (e.g. long-press a different task, close, long-press again —
  // same component instance, different task props). Effect is cheap;
  // defaultDateStr is a derived string so the dep array is stable.
  useEffect(() => {
    setPickedDate(defaultDateStr);
  }, [defaultDateStr]);

  function isCrossWindow(date: string): boolean {
    if (task.active_from_month == null || task.active_to_month == null) {
      return false;
    }
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return false;
    // Use home-tz month extraction here eventually; UTC is close-enough
    // per Pitfall 4 (differs by at most 1 day at month boundaries).
    const month = d.getUTCMonth() + 1;
    return !isInActiveWindow(
      month,
      task.active_from_month,
      task.active_to_month,
    );
  }

  async function doSubmit(which: 'just-this-time' | 'from-now-on') {
    if (!pickedDate) return;
    setPending(true);
    try {
      const iso = new Date(pickedDate).toISOString();
      const res =
        which === 'just-this-time'
          ? await snoozeTaskAction({
              task_id: task.id,
              snooze_until: iso,
            })
          : await rescheduleTaskAction({
              task_id: task.id,
              new_date: iso,
            });
      if (res.ok) {
        toast.success(
          which === 'just-this-time' ? 'Snoozed' : 'Rescheduled',
        );
        onOpenChange(false);
        startTransition(() => router.refresh());
      } else {
        toast.error(res.formError);
      }
    } finally {
      setPending(false);
    }
  }

  function handleSubmitClick() {
    if (!canSubmit) return;
    if (isCrossWindow(pickedDate)) {
      setPendingSubmit(radio);
      setExtendOpen(true);
      return;
    }
    void doSubmit(radio);
  }

  const canSubmit =
    defaultDateStr.length > 0 && pickedDate.length > 0 && !pending;

  // D-06: computeNextDue → null (archived / seasonal-dormant-without-
  // prior-season) renders the "not schedulable right now" fallback.
  // Submit button is intentionally omitted — user only sees a Close.
  if (!defaultDate) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="sm:max-w-md"
          data-testid="reschedule-sheet"
        >
          <SheetHeader>
            <SheetTitle>
              Reschedule &lsquo;{task.name}&rsquo;
            </SheetTitle>
          </SheetHeader>
          <div className="p-4 text-sm text-muted-foreground">
            Task is not schedulable right now.
          </div>
          <div className="p-4">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid="reschedule-close"
            >
              Close
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="sm:max-w-md"
          data-testid="reschedule-sheet"
        >
          <SheetHeader>
            <SheetTitle>
              Reschedule &lsquo;{task.name}&rsquo;
            </SheetTitle>
            <SheetDescription>
              Pick a new date. &ldquo;Just this time&rdquo; snoozes once.
              &ldquo;From now on&rdquo; shifts the schedule permanently.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 p-4">
            <div className="space-y-1.5">
              <Label htmlFor="reschedule-date">New date</Label>
              <Input
                id="reschedule-date"
                type="date"
                value={pickedDate}
                onChange={(e) => setPickedDate(e.target.value)}
                data-testid="reschedule-date-input"
              />
            </div>
            <div
              className="space-y-1.5"
              role="radiogroup"
              aria-label="Reschedule scope"
            >
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="reschedule-scope"
                  value="just-this-time"
                  checked={radio === 'just-this-time'}
                  onChange={() => setRadio('just-this-time')}
                />
                <span>Just this time</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="reschedule-scope"
                  value="from-now-on"
                  checked={radio === 'from-now-on'}
                  onChange={() => setRadio('from-now-on')}
                />
                <span>From now on</span>
              </label>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={!canSubmit}
                onClick={handleSubmitClick}
                data-testid="reschedule-submit"
              >
                Reschedule
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                data-testid="reschedule-cancel"
              >
                Cancel
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
      <ExtendWindowDialog
        open={extendOpen}
        onOpenChange={setExtendOpen}
        task={task}
        pickedDate={pickedDate}
        timezone={timezone}
        onCancel={() => {
          setExtendOpen(false);
          setPendingSubmit(null);
        }}
        onExtend={async () => {
          // D-12: widen active_from/to by the smallest delta to include
          // the picked month. T-15-02-07 EoP mitigation: bound to 1..12
          // via min/max on the current window + picked month (all three
          // are already constrained to 1..12 upstream).
          const d = new Date(pickedDate);
          if (Number.isNaN(d.getTime())) {
            setExtendOpen(false);
            setPendingSubmit(null);
            return;
          }
          const m = d.getUTCMonth() + 1;
          const curFrom = task.active_from_month as number;
          const curTo = task.active_to_month as number;
          // Non-wrap window: extend `to` if picked month > to, else
          // extend `from` if picked month < from. Wrap windows already
          // cover a large span — treat the same way; the result still
          // includes the picked month. Caller clamps final values to
          // 1..12 via min/max defense.
          const newFrom = Math.max(1, Math.min(12, m < curFrom ? m : curFrom));
          const newTo = Math.max(1, Math.min(12, m > curTo ? m : curTo));
          await onExtendWindow(newFrom, newTo);
          setExtendOpen(false);
          if (pendingSubmit) await doSubmit(pendingSubmit);
          setPendingSubmit(null);
        }}
        onContinueAnyway={async () => {
          setExtendOpen(false);
          if (pendingSubmit) await doSubmit(pendingSubmit);
          setPendingSubmit(null);
        }}
      />
    </>
  );
}
