'use client';

import { useRef } from 'react';
import clsx from 'clsx';

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
 * Detail affordance (03-03 extension, VIEW-06):
 *   - Optional `onDetail` prop. When provided, right-click
 *     (onContextMenu) and long-press (500ms touch hold) invoke it
 *     with the task id. Both handlers are wired on the <button> so
 *     the whole row is the long-press target (not just a corner).
 *     onDetail is backward-compatible — existing call sites that
 *     omit it get the 03-02 behaviour unchanged.
 */
export function TaskRow({
  task,
  onComplete,
  onDetail,
  pending,
  daysDelta,
  variant,
}: {
  task: { id: string; name: string; frequency_days: number };
  onComplete: (taskId: string) => void;
  onDetail?: (taskId: string) => void;
  pending: boolean;
  daysDelta: number;
  variant?: 'overdue' | 'thisWeek' | 'horizon';
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

  return (
    <button
      type="button"
      disabled={pending}
      aria-disabled={pending}
      data-task-id={task.id}
      data-task-name={task.name}
      data-variant={variant}
      onClick={() => onComplete(task.id)}
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
      <div className="flex flex-col">
        <span className="font-medium">{task.name}</span>
        <span className="text-xs text-muted-foreground">
          Every {task.frequency_days}{' '}
          {task.frequency_days === 1 ? 'day' : 'days'}
        </span>
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">{label}</span>
    </button>
  );
}
