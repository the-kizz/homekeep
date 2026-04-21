'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { areaSchema, type AreaInput } from '@/lib/schemas/area';
import type { ActionState } from '@/lib/schemas/auth';
import { createArea, updateArea } from '@/lib/actions/areas';
import { AREA_COLORS, AREA_ICONS } from '@/lib/area-palette';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { IconPicker } from '@/components/icon-picker';
import { ColorPicker } from '@/components/color-picker';

/**
 * Area create/edit form (02-04 Plan).
 *
 * The icon + color pickers are controlled components (not plain <input>),
 * so they're wired via react-hook-form's Controller. Hidden inputs inside
 * the form carry the selected values into the FormData the server action
 * reads — IconPicker/ColorPicker buttons are type="button" so they never
 * submit the form.
 *
 * scope is forced to 'location' on the server (Whole Home is hook-only).
 * We still include it as a hidden input for a clean audit trail.
 */

const INITIAL: ActionState = { ok: false };

type AreaRecord = {
  id: string;
  home_id: string;
  name: string;
  icon: string;
  color: string;
  sort_order: number;
  scope: 'location' | 'whole_home';
};

export function AreaForm({
  mode,
  homeId,
  area,
  onDone,
}: {
  mode: 'create' | 'edit';
  homeId: string;
  area?: AreaRecord;
  onDone?: () => void;
}) {
  const action =
    mode === 'create' ? createArea : updateArea.bind(null, area!.id);

  const [state, formAction, isPending] = useActionState<ActionState, FormData>(
    action,
    INITIAL,
  );

  const defaultIcon =
    area?.icon && (AREA_ICONS as readonly string[]).includes(area.icon)
      ? area.icon
      : AREA_ICONS[0];
  const defaultColor =
    area?.color && (AREA_COLORS as readonly string[]).includes(area.color)
      ? area.color
      : AREA_COLORS[0];

  const {
    register,
    control,
    formState: { errors },
  } = useForm<AreaInput>({
    resolver: zodResolver(areaSchema),
    mode: 'onBlur',
    defaultValues: {
      home_id: homeId,
      name: area?.name ?? '',
      icon: defaultIcon,
      color: defaultColor,
      sort_order: area?.sort_order ?? 0,
      scope: area?.scope ?? 'location',
    },
  });

  const router = useRouter();

  // On successful submit: refresh the Server Component tree so the new /
  // updated area shows up in the list, then (if provided) close the
  // parent dialog. useEffect keeps the side-effect out of render.
  useEffect(() => {
    if (state.ok) {
      router.refresh();
      onDone?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const serverFieldErrors = !state.ok ? state.fieldErrors : undefined;
  const serverFormError = !state.ok ? state.formError : undefined;

  const nameError = errors.name?.message ?? serverFieldErrors?.name?.[0];
  const iconError = errors.icon?.message ?? serverFieldErrors?.icon?.[0];
  const colorError =
    errors.color?.message ?? serverFieldErrors?.color?.[0];

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {/* Hidden metadata fields — server re-reads via formData.get() */}
      <input type="hidden" name="home_id" value={homeId} />
      <input type="hidden" name="scope" value={area?.scope ?? 'location'} />
      <input
        type="hidden"
        name="sort_order"
        value={String(area?.sort_order ?? 0)}
      />

      <div className="space-y-1.5">
        <Label htmlFor="area-name">Name</Label>
        <Input
          id="area-name"
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
        <Label>Icon</Label>
        <Controller
          control={control}
          name="icon"
          render={({ field }) => (
            <>
              <IconPicker
                value={field.value}
                onChange={(v) => field.onChange(v)}
              />
              <input type="hidden" name="icon" value={field.value} />
            </>
          )}
        />
        {iconError && (
          <p className="text-sm text-destructive">{iconError}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label>Color</Label>
        <Controller
          control={control}
          name="color"
          render={({ field }) => (
            <>
              <ColorPicker
                value={field.value}
                onChange={(v) => field.onChange(v)}
              />
              <input type="hidden" name="color" value={field.value} />
            </>
          )}
        />
        {colorError && (
          <p className="text-sm text-destructive">{colorError}</p>
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
            ? 'Create area'
            : 'Save changes'}
      </Button>
    </form>
  );
}
