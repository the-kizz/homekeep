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
import { updateTask } from '@/lib/actions/tasks';
import { getIdealAndScheduled } from '@/lib/horizon-density';
import { TaskBand } from '@/components/task-band';
import { HorizonStrip } from '@/components/horizon-strip';
import { DormantTaskRow } from '@/components/dormant-task-row';
import { classifyDormantTasks } from '@/lib/seasonal-rendering';
import {
  EarlyCompletionDialog,
  type GuardState,
} from '@/components/early-completion-dialog';
import { RescheduleActionSheet } from '@/components/reschedule-action-sheet';
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
  // Phase 15 Plan 02 (D-05): Reschedule entry point on the Person view.
  // The Person view has no TaskDetailSheet by design ("what's on my
  // plate now", not metadata browsing — see file-header JSDoc), so the
  // long-press / context-menu onDetail handler wires directly to
  // setRescheduleTaskId instead of routing through a detail sheet.
  const [rescheduleTaskId, setRescheduleTaskId] = useState<string | null>(
    null,
  );
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

  // Phase 16 Plan 01 (LVIZ-03, LVIZ-04, D-04, D-06): per-render shift
  // map mirrors BandView. Threaded to TaskBand (×2) + HorizonStrip.
  const shiftByTaskId = new Map<
    string,
    { idealDate: Date; scheduledDate: Date; displaced: boolean }
  >();
  for (const t of tasks) {
    const last = latestByTask.get(t.id) ?? null;
    const info = getIdealAndScheduled(t, last, nowDate, timezone);
    if (info.ideal && info.scheduled) {
      shiftByTaskId.set(t.id, {
        idealDate: info.ideal,
        scheduledDate: info.scheduled,
        displaced: info.displaced,
      });
    }
  }

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

  // Phase 14 (SEAS-06, D-07..D-09): dormant-task classification for the
  // Person view. Same pattern as BandView — parallels the band pipeline
  // and renders below HorizonStrip when dormant tasks exist. `tasks`
  // here is already scoped to the current user (the page pre-filters
  // to effective-assignee-is-me), so dormant tasks surface only for
  // the person who owns them.
  const dormant = classifyDormantTasks(tasks, nowDate, timezone);

  // `noBandsRendered` is the "all my stuff is mid-cycle" empty-state
  // trigger. A user who owns only dormant tasks should NOT see the
  // empty-state card — they'll see the Sleeping section instead. Hence
  // `dormant.length === 0` is part of the predicate.
  const noBandsRendered =
    overdueWithName.length === 0 &&
    thisWeekWithName.length === 0 &&
    horizonWithName.length === 0 &&
    dormant.length === 0;

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
          {/* v1.2.1 PATCH2-06: PersonTaskList keeps tap=complete because
              its onDetail opens the reschedule sheet (not a real detail
              view). Opt out of the new tap=detail default explicitly. */}
          <TaskBand
            label="Overdue"
            tasks={overdueWithName}
            onComplete={(id) => handleTap(id)}
            onDetail={(id) => setRescheduleTaskId(id)}
            primaryTap="complete"
            pendingTaskId={pendingTaskId}
            timezone={timezone}
            variant="overdue"
            now={nowDate}
            shiftByTaskId={shiftByTaskId}
          />
          <TaskBand
            label="This Week"
            tasks={thisWeekWithName}
            onComplete={(id) => handleTap(id)}
            onDetail={(id) => setRescheduleTaskId(id)}
            primaryTap="complete"
            pendingTaskId={pendingTaskId}
            timezone={timezone}
            variant="thisWeek"
            now={nowDate}
            shiftByTaskId={shiftByTaskId}
          />
          <HorizonStrip
            tasks={horizonWithName}
            now={nowDate}
            timezone={timezone}
            shiftByTaskId={shiftByTaskId}
          />
          {/* Phase 14 (SEAS-06): Sleeping section — mirrors BandView's
              placement below HorizonStrip. Zero-added-DOM when no
              dormant tasks exist. */}
          {dormant.length > 0 && (
            <section
              data-dormant-section
              data-dormant-count={dormant.length}
              className="space-y-2"
            >
              <h3 className="text-sm font-medium text-muted-foreground">
                Sleeping
              </h3>
              <div className="space-y-2">
                {dormant.map((t) => (
                  <DormantTaskRow
                    key={t.id}
                    task={{
                      id: t.id,
                      name: t.name,
                      nextOpenDate: t.nextOpenDate,
                    }}
                    timezone={timezone}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {guardState && (
        <EarlyCompletionDialog
          state={guardState}
          onConfirm={handleGuardConfirm}
          onCancel={handleGuardCancel}
        />
      )}

      {/* Phase 15 Plan 02 (SNZE-01, D-05): RescheduleActionSheet wired
          from the long-press / context-menu onDetail path above. Person
          scope skips the TaskDetailSheet intermediate (design note in
          file header); long-press opens the sheet directly. D-12
          onExtendWindow widens tasks.active_from/to via updateTask. */}
      {rescheduleTaskId &&
        (() => {
          const rt = tasks.find((t) => t.id === rescheduleTaskId);
          if (!rt) return null;
          const latestRow = latestByTask.get(rescheduleTaskId);
          const rtLast = latestRow
            ? { completed_at: latestRow.completed_at }
            : null;
          return (
            <RescheduleActionSheet
              open={true}
              onOpenChange={(o) => !o && setRescheduleTaskId(null)}
              task={rt as unknown as Task & { name: string }}
              lastCompletion={rtLast}
              timezone={timezone}
              onExtendWindow={async (newFrom, newTo) => {
                const fd = new FormData();
                fd.set('home_id', homeId);
                fd.set('area_id', rt.area_id);
                fd.set('name', rt.name);
                fd.set(
                  'frequency_days',
                  rt.frequency_days == null
                    ? ''
                    : String(rt.frequency_days),
                );
                fd.set('schedule_mode', rt.schedule_mode);
                if (rt.anchor_date) fd.set('anchor_date', rt.anchor_date);
                fd.set('active_from_month', String(newFrom));
                fd.set('active_to_month', String(newTo));
                if (rt.due_date) fd.set('due_date', rt.due_date);
                await updateTask(rt.id, { ok: false }, fd);
              }}
            />
          );
        })()}
    </div>
  );
}
