'use client';

import { useActionState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { homeSchema, type HomeInput } from '@/lib/schemas/home';
import type { ActionState } from '@/lib/schemas/auth';
import { createHome, updateHome } from '@/lib/actions/homes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Home create/edit form (02-04 Plan).
 *
 * Follows the login/signup form pattern from 02-03:
 *   - useActionState wraps the server action for pending + state.
 *   - react-hook-form + zodResolver surfaces inline onBlur errors using
 *     the SAME homeSchema the server re-parses.
 *   - Server-returned fieldErrors merge with client errors (client
 *     wins on display — server errors surface when the client hasn't
 *     run yet, e.g. JS-disabled submit).
 *
 * Timezone is a simple <select> of the most likely v1 values per
 * D-18 Claude's Discretion. IANA list is deferred — PB validates
 * arbitrary strings server-side.
 */

const INITIAL: ActionState = { ok: false };

const TIMEZONE_OPTIONS = [
  'Australia/Perth',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Australia/Brisbane',
  'Australia/Adelaide',
  'UTC',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
];

type HomeRecord = {
  id: string;
  name: string;
  address?: string;
  timezone: string;
};

export function HomeForm({
  mode,
  home,
}: {
  mode: 'create' | 'edit';
  home?: HomeRecord;
}) {
  // bind updateHome's first arg (homeId) ahead so useActionState still
  // sees the canonical (prevState, formData) shape it expects.
  const action =
    mode === 'create' ? createHome : updateHome.bind(null, home!.id);

  const [state, formAction, isPending] = useActionState<ActionState, FormData>(
    action,
    INITIAL,
  );

  const {
    register,
    formState: { errors },
  } = useForm<HomeInput>({
    resolver: zodResolver(homeSchema),
    mode: 'onBlur',
    defaultValues: {
      name: home?.name ?? '',
      address: home?.address ?? '',
      timezone: home?.timezone ?? 'Australia/Perth',
    },
  });

  const serverFieldErrors = !state.ok ? state.fieldErrors : undefined;
  const serverFormError = !state.ok ? state.formError : undefined;

  const nameError = errors.name?.message ?? serverFieldErrors?.name?.[0];
  const addressError =
    errors.address?.message ?? serverFieldErrors?.address?.[0];
  const timezoneError =
    errors.timezone?.message ?? serverFieldErrors?.timezone?.[0];

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="home-name">Name</Label>
        <Input
          id="home-name"
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
        <Label htmlFor="home-address">Address (optional)</Label>
        <Input
          id="home-address"
          type="text"
          autoComplete="off"
          aria-invalid={!!addressError}
          {...register('address')}
        />
        {addressError && (
          <p className="text-sm text-destructive">{addressError}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="home-timezone">Timezone</Label>
        <select
          id="home-timezone"
          aria-invalid={!!timezoneError}
          {...register('timezone')}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {TIMEZONE_OPTIONS.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
        {timezoneError && (
          <p className="text-sm text-destructive">{timezoneError}</p>
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
            ? 'Create home'
            : 'Save changes'}
      </Button>
    </form>
  );
}
