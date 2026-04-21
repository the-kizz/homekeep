'use client';

import { useOptimistic, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { Task } from '@/lib/task-scheduling';
import {
  reduceLatestByTask,
  type CompletionRecord,
} from '@/lib/completions';
import {
  computeTaskBands,
  type ClassifiedTask,
} from '@/lib/band-classification';
import { computeCoverage } from '@/lib/coverage';
import { completeTaskAction } from '@/lib/actions/completions';
import { CoverageRing } from '@/components/coverage-ring';
import { TaskBand } from '@/components/task-band';
import { HorizonStrip } from '@/components/horizon-strip';
import {
  EarlyCompletionDialog,
  type GuardState,
} from '@/components/early-completion-dialog';
import { TaskDetailSheet } from '@/components/task-detail-sheet';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/**
 * BandView (03-02 / 03-03 Plans, D-11 + D-12 + D-18 + D-19, Pitfalls 1/4/5/6/7/10/12).
 *
 * Top-level Client Component for the authenticated landing page. Owns:
 *   - `useOptimistic(completions, reducerForm)` where the reducer is
 *     `(current, added) => [...current, added]` — no closed-over
 *     outer state (Pitfall 1: stale-closure safe).
 *   - Band classification + coverage are DERIVED INLINE on every
 *     render from `optimisticCompletions`. They are NOT memoized on
 *     a different dependency (Pitfall 7: otherwise the optimistic
 *     update would not flow through to the UI).
 *   - A `pendingTaskId` piece of state used to dim the tapped row
 *     until the server action returns (Pitfall 4: double-tap guard —
 *     a second tap on the same pending row returns immediately).
 *   - `guardState` for the EarlyCompletionDialog when the server
 *     returns `{ requiresConfirm: true }` (Pitfall 5: discriminated
 *     union handling — server NEVER throws for business outcomes).
 *   - `detailTaskId` for the TaskDetailSheet (VIEW-06 / D-17).
 *
 * Completion flow (03-03 wiring):
 *   1. Row tap → `handleTap(taskId)` → double-tap guard via pendingId.
 *   2. Optimistic completion synthesised and pushed through reducer.
 *   3. `await completeTaskAction(taskId, { force })` inside
 *      `startTransition` so React keeps the optimistic state live
 *      until the action resolves.
 *   4. Result is a discriminated union (Pitfall 5):
 *        - `{ requiresConfirm: true, ... }` → open EarlyCompletionDialog.
 *          React auto-rolls back the optimistic push because the
 *          transition ends without a server-confirmed write.
 *        - `{ ok: false, formError }` → toast.error.
 *        - `{ ok: true, completion, nextDueFormatted }` → toast.success
 *          + `router.refresh()` (Pitfall 6: complementary to the server
 *          action's `revalidatePath` — Server Component re-fetches).
 *   5. Catch block maps unexpected throws to a generic error toast.
 *
 * Guard confirm flow:
 *   - User clicks "Mark done anyway" → `handleGuardConfirm` re-calls
 *     `handleTap(guardState.taskId, { force: true })` → server action
 *     skips the guard and records the completion.
 *
 * Detail sheet flow (Pitfall 12: Sheet + Dialog stacking):
 *   - Row right-click / long-press → `setDetailTaskId(id)` opens sheet.
 *   - Sheet's "Complete" button closes the sheet FIRST, THEN calls
 *     handleTap. If the guard fires, the guard dialog opens cleanly
 *     after the sheet has finished its close animation — no duelling
 *     focus traps.
 *
 * Empty-state policy (03-CONTEXT §specifics):
 *   - `tasks.length === 0`: CoverageRing shows 100% (coverage pure
 *     function returns 1.0 for empty-home — D-06) + Card with
 *     "Add your first task" CTA pointing to `emptyStateHref`.
 *   - `bands.overdue.length === 0`: TaskBand returns null — band
 *     header + card disappear entirely (D-12 + VIEW-02).
 *   - `bands.horizon.length === 0`: HorizonStrip renders the
 *     "looking clear" copy in place of the 12-cell grid (D-12).
 *
 * Clock policy (A4): the parent Server Component owns the clock
 * read and passes `now` as an ISO string. BandView reconstructs
 * `new Date(now)` ONCE at the top of each render.
 *
 * React Compiler (Pitfall 10, A5): `useOptimistic` with the reducer
 * form compiles cleanly. No `'use no memo';` directive is required
 * (03-02 smoke confirmed; 03-03 wiring does not introduce new
 * compiler-hostile patterns). If a regression surfaces during live
 * smoke, add `'use no memo';` at the top of this file as the
 * first-line remediation.
 */
export type TaskWithName = Task & {
  name: string;
  icon: string;
  color: string;
  area_id: string;
  area_name?: string;
  notes?: string;
};

export function BandView({
  tasks,
  completions,
  userId,
  homeId,
  timezone,
  now,
  emptyStateHref,
  lastCompletionsByTaskId,
}: {
  tasks: TaskWithName[];
  completions: CompletionRecord[];
  userId: string;
  homeId: string;
  timezone: string;
  now: string;
  emptyStateHref?: string;
  /**
   * Last 5 completions per task (sorted DESC by completed_at), used
   * by TaskDetailSheet. Keyed by task id; missing task id = [].
   */
  lastCompletionsByTaskId: Record<
    string,
    Array<{ id: string; completed_at: string }>
  >;
}) {
  const router = useRouter();
  const nowDate = new Date(now);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [guardState, setGuardState] = useState<GuardState | null>(null);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Reducer form — Pitfall 1 safe: no outer closure captured.
  const [optimisticCompletions, addOptimisticCompletion] = useOptimistic(
    completions,
    (
      current: CompletionRecord[],
      added: CompletionRecord,
    ): CompletionRecord[] => [...current, added],
  );

  // Derive inline on every render — Pitfall 7.
  const latestByTask = reduceLatestByTask(optimisticCompletions);
  const bands = computeTaskBands(tasks, latestByTask, nowDate, timezone);
  const coverage = computeCoverage(tasks, latestByTask, nowDate);
  const coveragePct = Math.round(coverage * 100);

  async function handleTap(
    taskId: string,
    opts: { force?: boolean } = {},
  ) {
    // Pitfall 4 — double-tap guard. If the row is already in flight
    // for this task id, swallow the second tap.
    if (pendingTaskId === taskId) return;
    setPendingTaskId(taskId);

    const optimistic: CompletionRecord = {
      id: `optimistic-${taskId}-${Date.now()}`,
      task_id: taskId,
      completed_by_id: userId,
      completed_at: new Date().toISOString(),
      notes: '',
      via: 'tap',
    };

    startTransition(async () => {
      // Optimistic state is scoped to this transition — React auto-
      // rolls it back on transition end if the action path does not
      // lead to a confirmed server write (e.g. guard fires).
      addOptimisticCompletion(optimistic);
      try {
        const result = await completeTaskAction(taskId, {
          force: opts.force ?? false,
        });
        if ('requiresConfirm' in result) {
          const task = tasks.find((t) => t.id === taskId);
          setGuardState({
            taskId,
            taskName: task?.name ?? 'this task',
            frequencyDays: result.frequency,
            lastCompletedAt: result.lastCompletedAt,
            nowDate,
          });
          return;
        }
        if (!result.ok) {
          toast.error(result.formError || 'Could not complete task');
          return;
        }
        toast.success(`Done — next due ${result.nextDueFormatted}`);
        // Pitfall 6 complementarity with the server action's
        // revalidatePath: the server invalidates the route's data
        // cache; router.refresh() tells Next's client to re-fetch
        // the Server Component output so the new completion lands
        // in the non-optimistic parent state.
        router.refresh();
      } catch {
        toast.error('Could not complete task');
      } finally {
        setPendingTaskId(null);
      }
    });
  }

  function handleGuardConfirm() {
    if (!guardState) return;
    const id = guardState.taskId;
    setGuardState(null);
    void handleTap(id, { force: true });
  }

  function handleGuardCancel() {
    setGuardState(null);
  }

  function handleDetail(taskId: string) {
    setDetailTaskId(taskId);
  }

  // Attach `name` to each ClassifiedTask so the band/horizon children
  // can render it. The intermediate `TaskWithName` lookup is O(N)
  // per band but N is bounded by the active task count for the
  // home (realistic ceiling is <200 for a household — SPEC §19).
  const nameById = new Map(tasks.map((t) => [t.id, t.name]));
  const attachName = (ct: ClassifiedTask) =>
    ({ ...ct, name: nameById.get(ct.id) ?? ct.id }) as ClassifiedTask & {
      name: string;
    };
  const overdueWithName = bands.overdue.map(attachName);
  const thisWeekWithName = bands.thisWeek.map(attachName);
  const horizonWithName = bands.horizon.map(attachName);

  const detailTask = detailTaskId
    ? tasks.find((t) => t.id === detailTaskId)
    : null;
  const detailCompletions = detailTaskId
    ? (lastCompletionsByTaskId[detailTaskId] ?? [])
    : [];
  const hasAnyTasks = tasks.length > 0;

  return (
    <div
      className="mx-auto max-w-4xl space-y-6 p-6"
      data-band-view
      data-home-id={homeId}
    >
      <header className="flex items-center justify-center">
        <CoverageRing percentage={coveragePct} />
      </header>

      {!hasAnyTasks ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <p className="text-muted-foreground">
              No tasks yet — your house is a blank canvas.
            </p>
            <Button asChild>
              <Link
                href={emptyStateHref ?? `/h/${homeId}/tasks/new`}
              >
                Add your first task
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <TaskBand
            label="Overdue"
            tasks={overdueWithName}
            onComplete={(id) => handleTap(id)}
            onDetail={handleDetail}
            pendingTaskId={pendingTaskId}
            timezone={timezone}
            variant="overdue"
            now={nowDate}
          />
          <TaskBand
            label="This Week"
            tasks={thisWeekWithName}
            onComplete={(id) => handleTap(id)}
            onDetail={handleDetail}
            pendingTaskId={pendingTaskId}
            timezone={timezone}
            variant="thisWeek"
            now={nowDate}
          />
          <HorizonStrip
            tasks={horizonWithName}
            now={nowDate}
            timezone={timezone}
          />
        </>
      )}

      {guardState && (
        <EarlyCompletionDialog
          state={guardState}
          onConfirm={handleGuardConfirm}
          onCancel={handleGuardCancel}
        />
      )}

      <TaskDetailSheet
        open={!!detailTaskId}
        onOpenChange={(o) => !o && setDetailTaskId(null)}
        task={
          detailTask
            ? {
                id: detailTask.id,
                name: detailTask.name,
                frequency_days: detailTask.frequency_days,
                schedule_mode: detailTask.schedule_mode,
                anchor_date: detailTask.anchor_date,
                notes: detailTask.notes ?? '',
                area_name: detailTask.area_name,
              }
            : null
        }
        recentCompletions={detailCompletions}
        timezone={timezone}
        homeId={homeId}
        onComplete={(id) => handleTap(id)}
      />
    </div>
  );
}
