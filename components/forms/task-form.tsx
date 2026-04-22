'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
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
import { isInActiveWindow } from '@/lib/task-scheduling';
import { cn } from '@/lib/utils';

/**
 * Task create/edit form (02-05 Plan — CONTEXT §Specifics).
 *
 * Fields:
 *   - Name (text)
 *   - Area (<select> — populated from pre-fetched areas; preselectable
 *     via ?areaId= query param on the new-task page)
 *   - Frequency quick-select: Weekly / Monthly / Quarterly / Yearly
 *     buttons that setValue('frequency_days', 7|30|90|365). These are
 *     `type="button"` — native HTML buttons inside a <form> default to
 *     `type="submit"`, which would submit the form on click; this was
 *     flagged in plan verification as a real bug risk.
 *   - Custom frequency <Input type="number"> for override
 *   - Schedule mode radio: cycle (default) / anchored
 *   - Anchor date: conditionally rendered when schedule_mode === 'anchored'
 *     via RHF's watch('schedule_mode').
 *   - Notes (<textarea>, cap 2000 chars in schema)
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
  frequency_days: number;
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
};

const QUICK_SELECT: { label: string; days: number }[] = [
  { label: 'Weekly', days: 7 },
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

  const {
    register,
    control,
    setValue,
    watch,
    formState: { errors },
  } = useForm<TaskInput>({
    resolver: zodResolver(taskSchema),
    mode: 'onBlur',
    defaultValues: {
      home_id: homeId,
      area_id: defaultAreaId,
      name: task?.name ?? '',
      description: task?.description ?? '',
      frequency_days: task?.frequency_days ?? 7,
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
    },
  });

  const router = useRouter();

  // Refresh the tree on successful update (createTask redirects, so the
  // ok branch only fires for edit). Keeps edits immediately visible.
  useEffect(() => {
    if (state.ok) {
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const scheduleMode = watch('schedule_mode');
  const freqValue = watch('frequency_days');

  const serverFieldErrors = !state.ok ? state.fieldErrors : undefined;
  const serverFormError = !state.ok ? state.formError : undefined;

  const nameError = errors.name?.message ?? serverFieldErrors?.name?.[0];
  const areaError = errors.area_id?.message ?? serverFieldErrors?.area_id?.[0];
  const freqError =
    errors.frequency_days?.message ?? serverFieldErrors?.frequency_days?.[0];
  const anchorError =
    errors.anchor_date?.message ?? serverFieldErrors?.anchor_date?.[0];
  const notesError = errors.notes?.message ?? serverFieldErrors?.notes?.[0];

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

      {/*
        04-03 TASK-02: Assignee picker. "" = "Area default / Anyone" —
        the cascade in lib/assignment.ts falls through to area default or
        'anyone' at render time. Single option (no separate "Anyone"
        entry) because the DB representation of both is null; adding a
        second sentinel would introduce a lying UI. Native <select>
        matches the area picker above for visual consistency.
      */}
      <div className="space-y-1.5">
        <Label htmlFor="task-assignee">Assign to</Label>
        <select
          id="task-assignee"
          data-testid="task-assignee-select"
          {...register('assigned_to_id')}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Use area default (or Anyone)</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Leave as area default unless you want to override for this task.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Frequency</Label>
        {/* CRITICAL: these buttons are explicitly type="button". Native
            <button> inside a <form> defaults to type="submit", which
            would submit the form mid-fill on click (plan verification
            called this out as a real bug risk). */}
        <div className="flex flex-wrap gap-2">
          {QUICK_SELECT.map((q) => (
            <Button
              key={q.label}
              type="button"
              variant={freqValue === q.days ? 'default' : 'outline'}
              size="sm"
              onClick={() =>
                setValue('frequency_days', q.days, { shouldValidate: true })
              }
            >
              {q.label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Input
            id="task-freq"
            type="number"
            min={1}
            step={1}
            aria-invalid={!!freqError}
            className={cn('w-28')}
            {...register('frequency_days', { valueAsNumber: true })}
          />
          <span className="text-sm text-muted-foreground">days</span>
        </div>
        {freqError && (
          <p className="text-sm text-destructive">{freqError}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label>Schedule mode</Label>
        <Controller
          control={control}
          name="schedule_mode"
          render={({ field }) => (
            <div className="flex gap-4" role="radiogroup" aria-label="Schedule mode">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="schedule_mode"
                  value="cycle"
                  checked={field.value === 'cycle'}
                  onChange={() => field.onChange('cycle')}
                />
                <span>Cycle (from last completion)</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="schedule_mode"
                  value="anchored"
                  checked={field.value === 'anchored'}
                  onChange={() => field.onChange('anchored')}
                />
                <span>Anchored (fixed calendar cycles)</span>
              </label>
            </div>
          )}
        />
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
                  field.onChange(e.target.value.length > 0 ? e.target.value : null)
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

      {/*
        Phase 13 Plan 13-02 (TCSEM-01 + D-15, D-16): Advanced collapsible.
        Default collapsed. Contains the optional "Last done" date field.
        Rendered only for cycle-mode tasks (D-03 hides for anchored;
        D-04 hides for OOFT — OOFT form UI is Phase 15 scope, so the
        cycle guard alone is sufficient for v1.1's Phase 13 ship).

        When last_done is supplied, the server action's TCSEM-02 branch
        computes firstIdeal = last_done + frequency_days, then runs the
        load-smoothing placement. Blank last_done routes to TCSEM-03's
        smart-default (≤7 → tomorrow; 8..90 → cycle/4; >90 → cycle/3).

        Phase 13 review WR-02: hide in edit mode. updateTask (D-07)
        silently drops last_done — showing the input would let users
        type a date, press Save, and see nothing change ("lying UI").
        Edit-time re-placement is Phase 15+ scope; match the form to
        the server's creation-only scope.
      */}
      {mode === 'create' && (
        <Collapsible className="space-y-3">
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-between text-sm text-muted-foreground"
            >
              <span>Advanced</span>
              <span aria-hidden="true">▾</span>
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 rounded-md border border-border/60 bg-muted/30 p-3">
            {/* Phase 13 (TCSEM-01): last_done — cycle-mode only. The
                inner guard moved down from the outer Collapsible gate
                so Phase 14's Active months can live alongside without
                being hidden for anchored tasks. */}
            {scheduleMode === 'cycle' && (
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
                  When did you last do this? Blank = HomeKeep picks a smart first-due.
                </p>
              </div>
            )}

            {/* Phase 14 (SEAS-07, D-01, D-02, D-03): Active months —
                applies to both cycle and anchored modes. Paired-or-null
                enforced by taskSchema refine 2 at submit; UX hint
                disables "To month" until "From month" is selected (D-02).
                Both blank = year-round. */}
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
                    const fromValue = watch('active_from_month');
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
              {(errors.active_from_month?.message ||
                serverFieldErrors?.active_from_month?.[0]) && (
                <p className="text-sm text-destructive">
                  {errors.active_from_month?.message ??
                    serverFieldErrors?.active_from_month?.[0]}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Example: From October → To March covers Oct, Nov, Dec, Jan, Feb, Mar.
                Leave blank for year-round.
              </p>
            </div>

            {/* Phase 14 (SEAS-08, D-04, D-05, D-06): anchored-warning.
                Only renders when schedule_mode === 'anchored' AND
                anchor_date set AND both active months set AND projected
                dormancy ratio STRICTLY > 50%. Non-blocking — save
                succeeds regardless. */}
            {scheduleMode === 'anchored' && (
              <AnchoredWarningAlert watch={watch} />
            )}
          </CollapsibleContent>
        </Collapsible>
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
 * Projection math is bounded to 6 iterations (O(1)) — RHF watch()
 * subscriptions debounce re-renders (T-14-03 accept disposition).
 *
 * The alert does NOT block save — it's purely advisory. The user
 * may legitimately want a "service heater on Nov 1 with Oct-Mar
 * window" config where the anchor falls inside the window and all
 * 6 projections stay in Nov across 5 years; or they may knowingly
 * want the warning case to materialize. Save succeeds regardless
 * (SEAS-08 contract: warn, don't gate).
 */
function AnchoredWarningAlert({
  watch,
}: {
  watch: ReturnType<typeof useForm<TaskInput>>['watch'];
}) {
  const anchorDate = watch('anchor_date');
  const fromMonth = watch('active_from_month');
  const toMonth = watch('active_to_month');
  const freq = watch('frequency_days');

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
