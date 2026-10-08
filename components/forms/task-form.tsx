'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, useWatch, Controller, type Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { taskSchema, type TaskInput } from '@/lib/schemas/task';
import type { ActionState } from '@/lib/schemas/auth';
import { createTask, updateTask } from '@/lib/actions/tasks';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isInActiveWindow, isOoftTask } from '@/lib/task-scheduling';
import { cn } from '@/lib/utils';

/**
 * Task create/edit form.
 *
 * The first screen holds only what every task needs: Name, Area,
 * Frequency (quick chips plus a free days input — or the "Do by" date
 * for a one-off) and Who. Everything else — task type, schedule mode
 * and anchor date, last done, active months, notes — sits behind a
 * single "More options" collapsible, which edit mode opens when the
 * task already uses any of it.
 *
 * On submit the form's action fires createTask or updateTask bound to
 * the task id. Server validates again via safeParse; client-onBlur errors
 * merge with server fieldErrors (client wins on display).
 */

const INITIAL: ActionState = { ok: false };

type AreaOption = { id: string; name: string };
type MemberOption = { id: string; name: string };

type TaskRecord = {
  id: string;
  home_id: string;
  area_id: string;
  name: string;
  description?: string;
  // Phase 15 (OOFT-04, D-01): frequency_days is nullable at the Task
  // type (Phase 11) — one-off tasks carry null. Edit-form must tolerate
  // the nullable shape so switching to One-off doesn't coerce to 0.
  frequency_days: number | null;
  schedule_mode: 'cycle' | 'anchored';
  anchor_date: string | null;
  notes?: string;
  assigned_to_id?: string | null;
  // Phase 13 Plan 13-02 (TCSEM-01): optional last-done date surfaced
  // through the Advanced collapsible for cycle-mode tasks. Null =
  // smart-default at creation (TCSEM-03). Edit-form currently ignores
  // this on save (see lib/actions/tasks.ts updateTask comment).
  last_done?: string | null;
  // Phase 14 (SEAS-07): optional seasonal window — paired-or-null
  // validated by taskSchema refine 2. Both applicable to cycle AND
  // anchored modes (seasonal is orthogonal to schedule_mode; e.g.
  // a heater serviced on a fixed Nov 1 anchor with Oct-Mar window).
  active_from_month?: number | null;
  active_to_month?: number | null;
  // Phase 15 (OOFT-04, D-03): one-off "do by" date surfaced on the
  // form when task_type toggle is "One-off". Phase 11 migration added
  // the field; Phase 15 finally exposes it in the edit form.
  due_date?: string | null;
};

const QUICK_SELECT: { label: string; days: number }[] = [
  { label: 'Daily', days: 1 },
  { label: 'Weekly', days: 7 },
  { label: 'Every 2 weeks', days: 14 },
  { label: 'Monthly', days: 30 },
  { label: 'Quarterly', days: 90 },
  { label: 'Yearly', days: 365 },
];

// Phase 14 (SEAS-07, D-01): month dropdown options (1..12 labels for
// the Active months from/to selects). Ordered Jan..Dec.
const MONTH_OPTIONS = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
] as const;

export function TaskForm({
  mode,
  homeId,
  areas,
  members = [],
  task,
  preselectedAreaId,
}: {
  mode: 'create' | 'edit';
  homeId: string;
  areas: AreaOption[];
  members?: MemberOption[];
  task?: TaskRecord;
  preselectedAreaId?: string;
}) {
  const action =
    mode === 'create' ? createTask : updateTask.bind(null, task!.id);

  const [state, formAction, isPending] = useActionState<ActionState, FormData>(
    action,
    INITIAL,
  );

  const defaultAreaId =
    task?.area_id ??
    (preselectedAreaId && areas.some((a) => a.id === preselectedAreaId)
      ? preselectedAreaId
      : (areas[0]?.id ?? ''));

  // Normalise anchor_date → yyyy-MM-dd for the <input type="date"> value.
  const defaultAnchor =
    typeof task?.anchor_date === 'string' && task.anchor_date.length > 0
      ? task.anchor_date.slice(0, 10)
      : '';

  // 04-03 TASK-02: assigned_to_id default — use the task record's value
  // if editing; otherwise empty string (="" = "Area default / Anyone").
  // The zod schema treats empty string as null-equivalent (z.string().nullish()).
  const defaultAssigned =
    typeof task?.assigned_to_id === 'string' && task.assigned_to_id.length > 0
      ? task.assigned_to_id
      : '';

  // Phase 15 (OOFT-04, D-01): derive the initial task_type from an
  // existing task's frequency_days shape. v1.0 rows store frequency > 0;
  // OOFT rows carry null (app semantic) OR 0 (PB 0.37.1 cleared-field
  // storage) — see isOoftTask for the centralized marker. Create mode
  // defaults to 'recurring' so the user flips into One-off explicitly.
  const initialTaskType: 'recurring' | 'one-off' =
    task && isOoftTask({ frequency_days: task.frequency_days })
      ? 'one-off'
      : 'recurring';

  const {
    register,
    control,
    setValue,
    formState: { errors },
  } = useForm<TaskInput>({
    resolver: zodResolver(taskSchema),
    mode: 'onBlur',
    defaultValues: {
      home_id: homeId,
      area_id: defaultAreaId,
      name: task?.name ?? '',
      description: task?.description ?? '',
      // Phase 15 (OOFT-04, D-01): if the existing task is OOFT, seed
      // frequency_days with null so switching back to Recurring starts
      // from a clean 7-day default via the toggle handler.
      frequency_days:
        task === undefined
          ? 7
          : isOoftTask({ frequency_days: task.frequency_days })
            ? null
            : (task.frequency_days ?? 7),
      schedule_mode: task?.schedule_mode ?? 'cycle',
      anchor_date: defaultAnchor || null,
      assigned_to_id: defaultAssigned,
      notes: task?.notes ?? '',
      // Phase 13 Plan 13-02 (TCSEM-01): seed the Advanced collapsible's
      // last-done input from an existing row (edit mode) or null
      // (create). Create mode drives the TCSEM-03 smart-default branch
      // when left blank.
      last_done: task?.last_done ?? null,
      // Phase 14 (SEAS-07): seasonal window. Null+null = year-round
      // (both existing v1.0 rows and new-task defaults). Edit mode
      // seeds from the task record if present.
      active_from_month: task?.active_from_month ?? null,
      active_to_month: task?.active_to_month ?? null,
      // PB returns datetimes ("2026-11-01 00:00:00.000Z"); the date input
      // only accepts yyyy-MM-dd, so trim like anchor_date above.
      due_date:
        typeof task?.due_date === 'string' && task.due_date.length > 0
          ? task.due_date.slice(0, 10)
          : null,
    },
  });

  // Phase 15 (OOFT-04, D-01): UI-only toggle state, not part of the
  // schema. Controls conditional reveals (Recurring → frequency +
  // schedule_mode + anchor; One-off → due_date). The toggle handlers
  // force matching schema state to keep Phase 11 refine 3 (OOFT +
  // anchored incompatible) from tripping on submit.
  const [taskType, setTaskType] = useState<'recurring' | 'one-off'>(
    initialTaskType,
  );

  const router = useRouter();

  // Refresh the tree on successful update (createTask redirects, so the
  // ok branch only fires for edit). Keeps edits immediately visible.
  useEffect(() => {
    if (state.ok) {
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // useWatch rather than watch(): watch() defeats React Compiler memoisation.
  const scheduleMode = useWatch({ control, name: 'schedule_mode' });
  const freqValue = useWatch({ control, name: 'frequency_days' });
  const activeFromMonth = useWatch({ control, name: 'active_from_month' });

  const serverFieldErrors = !state.ok ? state.fieldErrors : undefined;
  const serverFormError = !state.ok ? state.formError : undefined;

  const nameError = errors.name?.message ?? serverFieldErrors?.name?.[0];
  const areaError = errors.area_id?.message ?? serverFieldErrors?.area_id?.[0];
  const freqError =
    errors.frequency_days?.message ?? serverFieldErrors?.frequency_days?.[0];
  const anchorError =
    errors.anchor_date?.message ?? serverFieldErrors?.anchor_date?.[0];
  const notesError = errors.notes?.message ?? serverFieldErrors?.notes?.[0];
  // Phase 15 (OOFT-04, D-03): due_date error surfaces from the Phase 11
  // refine 1 (required-when-ooft) or from the Phase 15 regex tightening
  // in lib/schemas/task.ts.
  const dueDateError =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (errors as any).due_date?.message ?? serverFieldErrors?.due_date?.[0];

  // Edit mode opens "More options" when the task already uses something
  // tucked away there, so the user sees why it behaves the way it does.
  const hasNonDefaultExtras =
    initialTaskType === 'one-off' ||
    task?.schedule_mode === 'anchored' ||
    task?.active_from_month != null ||
    (typeof task?.notes === 'string' && task.notes.trim().length > 0);
  const [moreOpen, setMoreOpen] = useState<boolean>(
    mode === 'edit' && hasNonDefaultExtras,
  );
  const activeMonthsError =
    errors.active_from_month?.message ??
    serverFieldErrors?.active_from_month?.[0];
  // A server error on a collapsed field would otherwise be invisible.
  const moreHasError = !!(anchorError || notesError || activeMonthsError);
  const moreIsOpen = moreOpen || moreHasError;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="home_id" value={homeId} />

      <div className="space-y-1.5">
        <Label htmlFor="task-name">Name</Label>
        <Input
          id="task-name"
          type="text"
          autoComplete="off"
          aria-invalid={!!nameError}
          {...register('name')}
        />
        {nameError && (
          <p className="text-sm text-destructive">{nameError}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="task-area">Area</Label>
        <select
          id="task-area"
          aria-invalid={!!areaError}
          {...register('area_id')}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {areas.length === 0 ? (
            <option value="">No areas yet — create one first</option>
          ) : (
            areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))
          )}
        </select>
        {areaError && (
          <p className="text-sm text-destructive">{areaError}</p>
        )}
      </div>

      {/* Frequency for recurring tasks; a one-off swaps it for its
          "Do by" date in the same spot so "when" always lives here. */}
      {taskType === 'recurring' ? (
        <div className="space-y-1.5">
          <Label htmlFor="task-freq">Frequency</Label>
          {/* type="button" matters: a bare <button> inside a <form>
              submits the form mid-fill. */}
          <div className="flex flex-wrap gap-2">
            {QUICK_SELECT.map((q) => (
              <Button
                key={q.label}
                type="button"
                variant={freqValue === q.days ? 'default' : 'outline'}
                size="sm"
                aria-pressed={freqValue === q.days}
                onClick={() =>
                  setValue('frequency_days', q.days, { shouldValidate: true })
                }
              >
                {q.label}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">or every</span>
            <Input
              id="task-freq"
              type="number"
              min={1}
              step={1}
              aria-invalid={!!freqError}
              className={cn('w-24')}
              {...register('frequency_days', { valueAsNumber: true })}
            />
            <span className="text-sm text-muted-foreground">days</span>
          </div>
          {freqError && (
            <p className="text-sm text-destructive">{freqError}</p>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="task-due-date">Do by (required)</Label>
          <Controller
            control={control}
            name="due_date"
            render={({ field }) => (
              <Input
                id="task-due-date"
                type="date"
                value={field.value ?? ''}
                onChange={(e) =>
                  field.onChange(
                    e.target.value.length > 0 ? e.target.value : null,
                  )
                }
                name="due_date"
                aria-invalid={!!dueDateError}
              />
            )}
          />
          {dueDateError && (
            <p className="text-sm text-destructive">{dueDateError}</p>
          )}
          <p className="text-xs text-muted-foreground">
            One-off tasks disappear once completed.
          </p>
        </div>
      )}

      {/* "" = area default or Anyone. One option, not two, because the
          stored value for both is null — a second entry would lie. */}
      <div className="space-y-1.5">
        <Label htmlFor="task-assignee">Who</Label>
        <select
          id="task-assignee"
          data-testid="task-assignee-select"
          {...register('assigned_to_id')}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Area default (or anyone)</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      {/* forceMount keeps every field in the DOM while collapsed, so
          FormData still carries schedule_mode, notes and the rest —
          otherwise saving an edit with the section closed would silently
          clear them. Radix never hides force-mounted content itself, so
          `hidden` is set here; hidden fields still submit. */}
      <Collapsible
        open={moreIsOpen}
        onOpenChange={setMoreOpen}
        className="space-y-3"
      >
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-between text-sm text-muted-foreground"
          >
            <span>More options</span>
            <span
              aria-hidden="true"
              className={cn('transition-transform', moreIsOpen && 'rotate-180')}
            >
              ▾
            </span>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent
          forceMount
          hidden={!moreIsOpen}
          data-more-options
          className="space-y-4 rounded-md border border-border/60 bg-muted/30 p-3"
        >
          {/* Switching to One-off forces schedule_mode back to cycle:
              a one-off on an anchored schedule is rejected by the
              schema. */}
          <div className="space-y-1.5" data-task-type-toggle>
            <Label>Task type</Label>
            <div
              className="flex gap-4"
              role="radiogroup"
              aria-label="Task type"
            >
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="task_type_ui"
                  value="recurring"
                  checked={taskType === 'recurring'}
                  onChange={() => {
                    setTaskType('recurring');
                    // Restore a usable frequency rather than an empty input.
                    const restored =
                      task && !isOoftTask({ frequency_days: task.frequency_days })
                        ? (task.frequency_days ?? 7)
                        : 7;
                    setValue('frequency_days', restored, {
                      shouldValidate: true,
                    });
                    // Avoid a phantom "due date required" after flipping back.
                    setValue('due_date', null, { shouldValidate: false });
                  }}
                />
                <span>Recurring</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="task_type_ui"
                  value="one-off"
                  checked={taskType === 'one-off'}
                  onChange={() => {
                    setTaskType('one-off');
                    setValue('schedule_mode', 'cycle', { shouldValidate: true });
                    setValue('frequency_days', null as unknown as number, {
                      shouldValidate: true,
                    });
                  }}
                />
                <span>One-off</span>
              </label>
            </div>
          </div>

          {taskType === 'recurring' && (
            <>
              <div className="space-y-1.5">
                <Label>Schedule mode</Label>
                <Controller
                  control={control}
                  name="schedule_mode"
                  render={({ field }) => (
                    <div
                      className="flex gap-4"
                      role="radiogroup"
                      aria-label="Schedule mode"
                    >
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="schedule_mode"
                          value="cycle"
                          checked={field.value === 'cycle'}
                          onChange={() => field.onChange('cycle')}
                        />
                        <span>Cycle</span>
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="schedule_mode"
                          value="anchored"
                          checked={field.value === 'anchored'}
                          onChange={() => field.onChange('anchored')}
                        />
                        <span>Anchored</span>
                      </label>
                    </div>
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  Cycle: counts from the last time you did it. Anchored: fixed
                  calendar dates, e.g. &quot;every 1 July&quot;.
                </p>
              </div>

              {scheduleMode === 'anchored' && (
                <div className="space-y-1.5">
                  <Label htmlFor="task-anchor">Anchor date</Label>
                  <Controller
                    control={control}
                    name="anchor_date"
                    render={({ field }) => (
                      <Input
                        id="task-anchor"
                        type="date"
                        aria-invalid={!!anchorError}
                        value={field.value ?? ''}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value.length > 0 ? e.target.value : null,
                          )
                        }
                        name="anchor_date"
                      />
                    )}
                  />
                  {anchorError && (
                    <p className="text-sm text-destructive">{anchorError}</p>
                  )}
                </div>
              )}
            </>
          )}

          {/* Last done only shapes the first due date at creation; the
              update action ignores it, so showing it on edit would be a
              field that does nothing. Not meaningful for anchored or
              one-off tasks either. */}
          {mode === 'create' &&
            taskType === 'recurring' &&
            scheduleMode === 'cycle' && (
              <div className="space-y-1.5">
                <Label htmlFor="task-last-done">Last done (optional)</Label>
                <Controller
                  control={control}
                  name="last_done"
                  render={({ field }) => (
                    <Input
                      id="task-last-done"
                      type="date"
                      value={field.value ?? ''}
                      onChange={(e) =>
                        field.onChange(
                          e.target.value.length > 0 ? e.target.value : null,
                        )
                      }
                      name="last_done"
                    />
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  When did you last do this? Leave blank and HomeKeep picks a
                  sensible first date.
                </p>
              </div>
            )}

          {/* Active months apply to cycle and anchored alike. The "to"
              select stays disabled until "from" is chosen because the
              schema wants both or neither. */}
          <div className="space-y-1.5">
            <Label>Active months (optional)</Label>
            <div className="flex items-center gap-2">
              <Controller
                control={control}
                name="active_from_month"
                render={({ field }) => (
                  <select
                    id="task-active-from"
                    name="active_from_month"
                    aria-label="From month"
                    value={field.value ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      field.onChange(v.length > 0 ? Number(v) : null);
                    }}
                    className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">From — year-round</option>
                    {MONTH_OPTIONS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                )}
              />
              <span className="text-xs text-muted-foreground">→</span>
              <Controller
                control={control}
                name="active_to_month"
                render={({ field }) => {
                  const fromValue = activeFromMonth;
                  return (
                    <select
                      id="task-active-to"
                      name="active_to_month"
                      aria-label="To month"
                      disabled={fromValue == null}
                      value={field.value ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        field.onChange(v.length > 0 ? Number(v) : null);
                      }}
                      className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      <option value="">To</option>
                      {MONTH_OPTIONS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  );
                }}
              />
            </div>
            {activeMonthsError && (
              <p className="text-sm text-destructive">{activeMonthsError}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Example: From October → To March covers Oct, Nov, Dec, Jan, Feb,
              Mar. Leave blank for year-round.
            </p>
          </div>

          {/* Advisory only: save still succeeds. */}
          {taskType === 'recurring' && scheduleMode === 'anchored' && (
            <AnchoredWarningAlert control={control} />
          )}

          <div className="space-y-1.5">
            <Label htmlFor="task-notes">Notes (optional)</Label>
            <textarea
              id="task-notes"
              maxLength={2000}
              aria-invalid={!!notesError}
              {...register('notes')}
              className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {notesError && (
              <p className="text-sm text-destructive">{notesError}</p>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {serverFormError && (
        <p className="text-sm text-destructive" role="alert">
          {serverFormError}
        </p>
      )}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending
          ? mode === 'create'
            ? 'Creating…'
            : 'Saving…'
          : mode === 'create'
            ? 'Create task'
            : 'Save changes'}
      </Button>
    </form>
  );
}

/**
 * Phase 14 (SEAS-08, D-04, D-05, D-06): anchored-warning inline Alert.
 *
 * Renders an amber, non-blocking warning when all four conditions hold:
 *   1. schedule_mode === 'anchored'  (gated by caller)
 *   2. anchor_date is a non-empty ISO-like string
 *   3. Both active_from_month and active_to_month are set
 *   4. STRICTLY > 50% of 6 projected cycles fall outside the active
 *      window (D-04 threshold: 4+ of 6 dormant).
 *
 * Projection math is bounded to 6 iterations (O(1)); useWatch re-renders
 * only this alert when the watched fields change.
 *
 * The alert does NOT block save — it's purely advisory. The user
 * may legitimately want a "service heater on Nov 1 with Oct-Mar
 * window" config where the anchor falls inside the window and all
 * 6 projections stay in Nov across 5 years; or they may knowingly
 * want the warning case to materialize. Save succeeds regardless
 * (SEAS-08 contract: warn, don't gate).
 */
function AnchoredWarningAlert({ control }: { control: Control<TaskInput> }) {
  const anchorDate = useWatch({ control, name: 'anchor_date' });
  const fromMonth = useWatch({ control, name: 'active_from_month' });
  const toMonth = useWatch({ control, name: 'active_to_month' });
  const freq = useWatch({ control, name: 'frequency_days' });

  if (
    typeof anchorDate !== 'string' ||
    anchorDate.length === 0 ||
    fromMonth == null ||
    toMonth == null ||
    typeof freq !== 'number' ||
    !Number.isFinite(freq) ||
    freq <= 0
  ) {
    return null;
  }

  const anchor = new Date(anchorDate);
  if (Number.isNaN(anchor.getTime())) return null;

  let dormantCount = 0;
  for (let k = 0; k < 6; k++) {
    const projected = new Date(anchor.getTime() + k * freq * 86400000);
    const month = projected.getUTCMonth() + 1;
    if (!isInActiveWindow(month, fromMonth, toMonth)) dormantCount++;
  }
  const ratio = dormantCount / 6;
  // D-04: STRICTLY greater than 50% — ratio=0.5 (3/6) does NOT trigger.
  if (ratio <= 0.5) return null;

  return (
    <div
      role="alert"
      data-anchored-warning
      data-dormant-ratio={ratio.toFixed(2)}
      className="rounded-md border border-amber-500/60 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <strong className="font-medium">Heads up:</strong> Most scheduled
      cycles fall outside the active window. The task will be dormant
      for those dates.
    </div>
  );
}
