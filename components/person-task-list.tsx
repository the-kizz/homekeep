'use client';

import { useOptimistic, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { Task } from '@/lib/task-scheduling';
import type { EffectiveAssignee } from '@/lib/assignment';
import type { Override } from '@/lib/schedule-overrides';
import {
  reduceLatestByTask,
  type CompletionRecord,
} from '@/lib/completions';
import {
  computeTaskBands,
  type ClassifiedTask,
} from '@/lib/band-classification';
import { completeTaskAction } from '@/lib/actions/completions';
import { TaskBand } from '@/components/task-band';
import { HorizonStrip } from '@/components/horizon-strip';
import {
  EarlyCompletionDialog,
  type GuardState,
} from '@/components/early-completion-dialog';
import { Card, CardContent } from '@/components/ui/card';

/**
 * PersonTaskList — Client wrapper for the Person view "Your tasks" section
 * (05-02 Task 2, D-07 PERS-01).
 *
 * This is a BandView trimmed for Person scope:
 *   - NO CoverageRing header (coverage belongs to the whole household,
 *     not the individual — surfacing it here would mislead).
 *   - NO TaskDetailSheet wiring (Person scope is "what's on my plate now",
 *     not task metadata browsing).
 *   - YES optimistic completion + early-completion guard — the person
 *     view is ACTIVE per plan decision, not a passive read-only projection.
 *
 * Pure inputs + inline derivations mirror BandView verbatim so behaviour
 * stays consistent between surfaces (same completion flow, same guard,
 * same toast copy — one mental model for the user).
 *
 * Fallthrough empty state (whole list empty): the caller (person page)
 * wraps this with a higher-level "Nothing assigned to you" message when
 * `tasks.length === 0`, matching D-22. When tasks exist but every band
 * is empty (all assigned tasks are mid-cycle), each TaskBand returns
 * null and the HorizonStrip renders its own "looking clear" copy.
 */
export type PersonTask = Task & {
  name: string;
  area_id: string;
  effective?: EffectiveAssignee;
};

export function PersonTaskList({
  tasks,
  completions,
  userId,
  homeId,
  timezone,
  now,
  overridesByTask,
}: {
  tasks: PersonTask[];
  completions: CompletionRecord[];
  userId: string;
  homeId: string;
  timezone: string;
  now: string;
  /**
   * 10-02 Plan: active overrides for the home, serialized as a Record
   * across the RSC boundary. Reconstructed as a Map below for
   * `computeTaskBands`. Optional — empty Record preserves v1.0 behavior.
   */
  overridesByTask?: Record<string, Override>;
}) {
  const router = useRouter();
  const nowDate = new Date(now);
  const overridesMap = new Map<string, Override>(
    Object.entries(overridesByTask ?? {}),
  );
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [guardState, setGuardState] = useState<GuardState | null>(null);
  const [, startTransition] = useTransition();

  const [optimisticCompletions, addOptimisticCompletion] = useOptimistic(
    completions,
    (
      current: CompletionRecord[],
      added: CompletionRecord,
    ): CompletionRecord[] => [...current, added],
  );

  const latestByTask = reduceLatestByTask(optimisticCompletions);
  const bands = computeTaskBands(
    tasks,
    latestByTask,
    overridesMap,
    nowDate,
    timezone,
  );

  async function handleTap(
    taskId: string,
    opts: { force?: boolean } = {},
  ) {
    if (pendingTaskId === taskId) return;
    setPendingTaskId(taskId);

    startTransition(async () => {
      const nowIso = new Date().toISOString();
      const optimistic: CompletionRecord = {
        id: `optimistic-${taskId}-${nowIso}`,
        task_id: taskId,
        completed_by_id: userId,
        completed_at: nowIso,
        notes: '',
        via: 'tap',
      };
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

  // Attach name + effective onto the classified bucket (same shape
  // contract as BandView — TaskBand reads these via type assertion).
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const attachMeta = (ct: ClassifiedTask) => {
    const t = byId.get(ct.id);
    return {
      ...ct,
      name: t?.name ?? ct.id,
      effective: t?.effective,
    } as ClassifiedTask & {
      name: string;
      effective?: EffectiveAssignee;
    };
  };
  const overdueWithName = bands.overdue.map(attachMeta);
  const thisWeekWithName = bands.thisWeek.map(attachMeta);
  const horizonWithName = bands.horizon.map(attachMeta);

  const noBandsRendered =
    overdueWithName.length === 0 &&
    thisWeekWithName.length === 0 &&
    horizonWithName.length === 0;

  return (
    <div
      className="space-y-4"
      data-person-task-list
      data-home-id={homeId}
    >
      {noBandsRendered ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            All your assigned tasks are mid-cycle — nothing to do right now.
          </CardContent>
        </Card>
      ) : (
        <>
          <TaskBand
            label="Overdue"
            tasks={overdueWithName}
            onComplete={(id) => handleTap(id)}
            pendingTaskId={pendingTaskId}
            timezone={timezone}
            variant="overdue"
            now={nowDate}
          />
          <TaskBand
            label="This Week"
            tasks={thisWeekWithName}
            onComplete={(id) => handleTap(id)}
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
    </div>
  );
}
