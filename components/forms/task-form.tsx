'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { taskSchema, type TaskInput } from '@/lib/schemas/task';
import type { ActionState } from '@/lib/schemas/auth';
import { createTask, updateTask } from '@/lib/actions/tasks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
};

const QUICK_SELECT: { label: string; days: number }[] = [
  { label: 'Weekly', days: 7 },
  { label: 'Monthly', days: 30 },
  { label: 'Quarterly', days: 90 },
  { label: 'Yearly', days: 365 },
];

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
