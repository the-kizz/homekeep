'use client';

import { useActionState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  resetRequestSchema,
  type ResetRequestInput,
  type ActionState,
} from '@/lib/schemas/auth';
import { requestResetAction } from '@/lib/actions/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const INITIAL: ActionState = { ok: false };

export function ResetRequestForm() {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(
    requestResetAction,
    INITIAL,
  );

  const {
    register,
    formState: { errors },
  } = useForm<ResetRequestInput>({
    resolver: zodResolver(resetRequestSchema),
    mode: 'onBlur',
    defaultValues: { email: '' },
  });

  if (state.ok) {
    return (
      <div className="space-y-2 text-sm">
        <p>If that email is registered, a reset link has been sent.</p>
        <p className="text-muted-foreground">
          Didn&apos;t receive it? Check spam, or contact the admin if SMTP
          is not configured on this instance.
        </p>
      </div>
    );
  }

  const serverFieldErrors = !state.ok ? state.fieldErrors : undefined;
  const serverFormError = !state.ok ? state.formError : undefined;
  const emailError = errors.email?.message ?? serverFieldErrors?.email?.[0];

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          aria-invalid={!!emailError}
          {...register('email')}
        />
        {emailError && <p className="text-sm text-destructive">{emailError}</p>}
      </div>

      {serverFormError && (
        <p className="text-sm text-destructive" role="alert">
          {serverFormError}
        </p>
      )}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? 'Sending…' : 'Send reset link'}
      </Button>
    </form>
  );
}
