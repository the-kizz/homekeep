'use client';

import { useRef } from 'react';
import clsx from 'clsx';
import type { EffectiveAssignee } from '@/lib/assignment';
import { AssigneeDisplay } from '@/components/assignee-display';
import { ShiftBadge } from '@/components/shift-badge';

/**
 * TaskRow (03-02 Plan, D-16, SPEC §19 "information, not alarm").
 *
 * The entire row is a single `<button>` — the whole row IS the tap
 * target (D-16). Min height 44px satisfies iOS/Android touch-target
 * accessibility guidance (Pitfall 8).
 *
 * Variants:
 *   - overdue:  warm-accent `border-l-4 border-l-primary` (NOT red
 *               — SPEC §19 explicitly rejects red panic bars).
 *   - thisWeek / horizon: default border, no accent.
 *
 * Pending state (`pending=true`) disables the button and dims it to
 * 60% opacity. The onComplete prop is invoked with the task id on
 * click; the parent owns the pending-id bookkeeping (03-03 wires it
 * to the real server action).
 *
 * Label copy (right-aligned tabular-nums for mixed-width digits):
 *   - overdue (daysDelta < 0):  "{N}d late"
 *   - today (|daysDelta| < 1):  "today"
 *   - future (daysDelta ≥ 1):   "in {N}d"
 *
 * Detail affordance (03-03 extension, VIEW-06 / v1.2.1 PATCH2-06):
 *   - Optional `onDetail` prop. When provided, the primary tap opens
 *     the detail view by default (v1.2.1 flip — prior behavior routed
 *     tap to onComplete). Right-click (onContextMenu) and long-press
 *     (500ms touch hold) also invoke onDetail so any input modality
 *     lands in the same place. Completion is reachable from the detail
 *     sheet's "Complete" button (one extra tap, far fewer accidental
 *     completions).
 *   - Call sites that want the pre-v1.2.1 "tap = complete" UX (notably
 *     PersonTaskList, where `onDetail` opens a reschedule sheet rather
 *     than a true detail view) can pass `primaryTap="complete"` to
 *     opt out.
 *   - When `onDetail` is omitted entirely, tap always invokes
 *     `onComplete` — legacy call sites that never rendered a detail
 *     affordance are unaffected.
 */
export function TaskRow({
  task,
  onComplete,
  onDetail,
  primaryTap,
  pending,
  daysDelta,
  variant,
  shiftInfo,
}: {
  task: {
    id: string;
    name: string;
    frequency_days: number;
    /** 04-03 D-10 + TASK-04: resolved cascade from the Server Component. */
    effective?: EffectiveAssignee;
  };
  onComplete: (taskId: string) => void;
  onDetail?: (taskId: string) => void;
  /**
   * v1.2.1 PATCH2-06: primary tap semantic. Defaults to 'detail' when
   * `onDetail` is provided (opens the detail sheet; completion lives
   * behind the sheet's Complete button). Pass 'complete' to restore the
   * pre-v1.2.1 "tap marks done" behavior (PersonTaskList uses this —
   * its `onDetail` is a reschedule sheet, not a true detail view).
   */
  primaryTap?: 'complete' | 'detail';
  pending: boolean;
  daysDelta: number;
  variant?: 'overdue' | 'thisWeek' | 'horizon';
  /**
   * Phase 16 Plan 01 (D-06 / LVIZ-03): when present, render the ⚖️
   * ShiftBadge next to the task name. Parent owns the
   * getIdealAndScheduled computation; pass shiftInfo only for tasks
   * whose `displaced === true`. Omit the prop otherwise.
   */
  shiftInfo?: { idealDate: Date; scheduledDate: Date; timezone: string };
}) {
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const label =
    variant === 'overdue'
      ? `${Math.max(1, Math.round(-daysDelta))}d late`
      : daysDelta < 1
        ? 'today'
        : `in ${Math.round(daysDelta)}d`;

  const clearLongPressTimer = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleTouchStart = () => {
    if (!onDetail) return;
    longPressTimer.current = setTimeout(() => onDetail(task.id), 500);
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!onDetail) return;
    e.preventDefault();
    onDetail(task.id);
  };

  // v1.2.1 PATCH2-06: primary tap opens details by default when
  // onDetail is provided; caller can opt out with primaryTap='complete'.
  const effectivePrimary =
    primaryTap ?? (onDetail ? 'detail' : 'complete');
  const handleClick =
    effectivePrimary === 'detail' && onDetail
      ? () => onDetail(task.id)
      : () => onComplete(task.id);

  return (
    <button
      type="button"
      disabled={pending}
      aria-disabled={pending}
      data-task-id={task.id}
      data-task-name={task.name}
      data-variant={variant}
      data-assignee-kind={task.effective?.kind}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchEnd={clearLongPressTimer}
      onTouchCancel={clearLongPressTimer}
      onTouchMove={clearLongPressTimer}
      className={clsx(
        'flex w-full min-h-[44px] items-center justify-between gap-2 rounded border p-3 text-left transition-colors',
        variant === 'overdue' && 'border-l-4 border-l-primary',
        pending
          ? 'pointer-events-none opacity-60'
          : 'hover:bg-muted active:scale-[0.99]',
      )}
    >
      <div className="flex flex-col min-w-0">
        <span className="font-medium truncate">
          {task.name}
          {shiftInfo && (
            <ShiftBadge
              idealDate={shiftInfo.idealDate}
              scheduledDate={shiftInfo.scheduledDate}
              timezone={shiftInfo.timezone}
            />
          )}
        </span>
        <span className="text-xs text-muted-foreground">
          Every {task.frequency_days}{' '}
          {task.frequency_days === 1 ? 'day' : 'days'}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {task.effective && (
          <AssigneeDisplay effective={task.effective} showLabel={false} />
        )}
        <span className="text-xs text-muted-foreground tabular-nums">
          {label}
        </span>
      </div>
    </button>
  );
}
