'use client';

import { useOptimistic, useState, useTransition } from 'react';
import Link from 'next/link';
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
import { CoverageRing } from '@/components/coverage-ring';
import { TaskBand } from '@/components/task-band';
import { HorizonStrip } from '@/components/horizon-strip';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/**
 * BandView (03-02 Plan, D-11 + D-12 + D-18 + D-19, Pitfalls 1/7/10).
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
 *     until the server action returns (disables double-tap —
 *     Pitfall 4 surface, though 03-03 delivers the full
 *     defence-in-depth wiring).
 *
 * `onComplete` is accepted as a prop. When not provided (03-02
 * shipping state), tap is a no-op — the UI is interactive-ready
 * but does not mutate state. 03-03 wires the real
 * `completeTaskAction` server action + toast + router.refresh.
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
 * React Compiler (Pitfall 10): this file intentionally uses
 * `useOptimistic` with a reducer form that the compiler is known
 * to handle correctly. If a compiler-induced regression is
 * observed during smoke, the first-line remediation is to add
 * `'use no memo';` at the top of this file.
 */
export type TaskWithName = Task & {
  name: string;
  icon: string;
  color: string;
  area_id: string;
  area_name?: string;
};

export function BandView({
  tasks,
  completions,
  userId,
  homeId,
  timezone,
  now,
  onComplete,
  emptyStateHref,
}: {
  tasks: TaskWithName[];
  completions: CompletionRecord[];
  userId: string;
  homeId: string;
  timezone: string;
  now: string;
  onComplete?: (
    taskId: string,
    opts?: { force?: boolean },
  ) => Promise<unknown>;
  emptyStateHref?: string;
}) {
  const nowDate = new Date(now);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
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

  async function handleTap(taskId: string) {
    if (!onComplete) {
      // 03-02 ships with tap wiring stubbed. 03-03 supplies the
      // real handler invoking completeTaskAction + toast +
      // router.refresh.
      return;
    }
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
      addOptimisticCompletion(optimistic);
      try {
        await onComplete(taskId);
      } finally {
        setPendingTaskId(null);
      }
    });
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
            onComplete={handleTap}
            pendingTaskId={pendingTaskId}
            timezone={timezone}
            variant="overdue"
            now={nowDate}
          />
          <TaskBand
            label="This Week"
            tasks={thisWeekWithName}
            onComplete={handleTap}
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
    </div>
  );
}
