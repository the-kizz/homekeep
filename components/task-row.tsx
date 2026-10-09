'use client';

import { useRef } from 'react';
import clsx from 'clsx';
// Check is the literal mark for "done" here, not decoration.
import { Check } from 'lucide-react'; // avoid-ai-design-ignore: I3
import type { EffectiveAssignee } from '@/lib/assignment';
import { AssigneeDisplay } from '@/components/assignee-display';
import { ShiftBadge } from '@/components/shift-badge';
import { isOoftTask } from '@/lib/task-scheduling';

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
 * Label copy (right-aligned tabular-nums for mixed-width digits) is
 * plain English so it reads at a glance — see `dueLabel` below.
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
 *
 * One-tap complete (`onQuickComplete`):
 *   - Opening the sheet just to press Complete is the most common path,
 *     so rows can carry a round check button at the right edge. It is a
 *     sibling of the row button (nested buttons are invalid HTML), so a
 *     tap on it never reaches the row's detail handler. The parent routes
 *     it through the same completion path as the sheet, so the
 *     early-completion guard still applies.
 *   - Absent prop → no button and the original single-button markup.
 *
 * Phone width: the name gets the room. The assignee chip only appears for
 * a real assignee (task or area default); "Anyone" shows nothing, since
 * its absence already says it. A long name wraps to a second line rather
 * than being cut off.
 */
/**
 * Plain-English due label. `daysDelta` is measured from local midnight
 * today, so whole calendar days are ceil (late) / floor (ahead): a task
 * due yesterday afternoon is -0.4 -> "yesterday", one due tomorrow
 * evening is 1.8 -> "tomorrow". Rounding would push both a day out.
 * Late counts cap at "30+" — past a month the exact number stops
 * meaning anything and only widens the column.
 */
function dueLabel(
  daysDelta: number,
  variant?: 'overdue' | 'thisWeek' | 'horizon',
): string {
  if (variant === 'overdue') {
    const late = Math.max(1, Math.ceil(-daysDelta));
    if (late === 1) return 'yesterday';
    if (late > 30) return '30+ days late';
    return `${late} days late`;
  }
  if (daysDelta < 1) return 'today';
  const ahead = Math.floor(daysDelta);
  return ahead === 1 ? 'tomorrow' : `in ${ahead} days`;
}

export function TaskRow({
  task,
  onComplete,
  onDetail,
  onQuickComplete,
  primaryTap,
  pending,
  daysDelta,
  variant,
  shiftInfo,
}: {
  task: {
    id: string;
    name: string;
    /** null (or 0, as PocketBase stores a cleared number) = one-off. */
    frequency_days: number | null;
    /** 04-03 D-10 + TASK-04: resolved cascade from the Server Component. */
    effective?: EffectiveAssignee;
  };
  onComplete: (taskId: string) => void;
  onDetail?: (taskId: string) => void;
  /** Renders the round check button; called with the task id. */
  onQuickComplete?: (taskId: string) => void;
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

  const label = dueLabel(daysDelta, variant);
  // Due-label ink: brick when late, sand when it lands today/tomorrow,
  // otherwise quiet. The dot repeats the band colour before the title.
  const dueTone =
    variant === 'overdue'
      ? 'text-status-overdue font-medium'
      : variant !== 'horizon' && daysDelta < 2
        ? 'text-status-soon-deep font-medium'
        : 'text-muted-foreground';
  const dot =
    variant === 'overdue'
      ? 'bg-status-overdue'
      : variant === 'thisWeek'
        ? 'bg-status-soon'
        : null;

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

  const row = (
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
        'flex w-full min-h-14 items-center gap-3 px-4 py-3 text-left outline-none',
        'motion-safe:transition-colors motion-safe:duration-150',
        'focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        onQuickComplete && 'pr-16',
        pending ? 'pointer-events-none opacity-60' : 'hover:bg-muted/50',
      )}
    >
      {dot && (
        <span
          aria-hidden="true"
          data-status-dot={variant}
          className={clsx('size-1.5 shrink-0 self-start mt-2 rounded-full', dot)}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="line-clamp-2 break-words text-base leading-[22px] font-medium">
          {task.name}
          {shiftInfo && (
            <ShiftBadge
              idealDate={shiftInfo.idealDate}
              scheduledDate={shiftInfo.scheduledDate}
              timezone={shiftInfo.timezone}
            />
          )}
        </span>
        <span className="text-[13px] leading-5 text-muted-foreground">
          {isOoftTask(task)
            ? 'One-off'
            : `Every ${task.frequency_days} ${task.frequency_days === 1 ? 'day' : 'days'}`}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {task.effective && task.effective.kind !== 'anyone' && (
          <AssigneeDisplay effective={task.effective} showLabel={false} />
        )}
        <span
          data-due-label
          className={clsx('text-[13px] leading-5 tabular-nums', dueTone)}
        >
          {label}
        </span>
      </div>
    </button>
  );

  if (!onQuickComplete) return row;

  return (
    <div className="relative">
      {row}
      <button
        type="button"
        aria-label={`Complete ${task.name}`}
        disabled={pending}
        data-pending={pending ? 'true' : undefined}
        onClick={(e) => {
          e.stopPropagation();
          onQuickComplete(task.id);
        }}
        className={clsx(
          'group absolute right-2 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full outline-none',
        )}
      >
        <span
          aria-hidden="true"
          className={clsx(
            'flex size-9 items-center justify-center rounded-full border',
            'motion-safe:transition-colors motion-safe:duration-150',
            'group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-surface-2',
            pending
              ? 'border-status-healthy bg-status-healthy text-white dark:text-background'
              : 'border-foreground/15 text-muted-foreground group-hover:border-status-healthy group-hover:text-status-healthy group-focus-visible:border-status-healthy group-focus-visible:text-status-healthy group-active:bg-status-healthy group-active:text-white',
          )}
        >
          <Check className="size-[18px]" strokeWidth={1.75} />
        </span>
      </button>
    </div>
  );
}
