'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  resetConfirmSchema,
  type ResetConfirmInput,
  type ActionState,
} from '@/lib/schemas/auth';
import { confirmResetAction } from '@/lib/actions/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const INITIAL: ActionState = { ok: false };

export function ResetConfirmForm({ token }: { token: string }) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(
    confirmResetAction,
    INITIAL,
  );

  const {
    register,
    formState: { errors },
  } = useForm<ResetConfirmInput>({
    resolver: zodResolver(resetConfirmSchema),
    mode: 'onBlur',
    defaultValues: { token, password: '', passwordConfirm: '' },
  });

  useEffect(() => {
    if (state.ok) {
      toast.success('Password updated — please log in');
      router.push('/login');
    }
  }, [state, router]);

  const serverFieldErrors = !state.ok ? state.fieldErrors : undefined;
  const serverFormError = !state.ok ? state.formError : undefined;
  const passwordError = errors.password?.message ?? serverFieldErrors?.password?.[0];
  const passwordConfirmError =
    errors.passwordConfirm?.message ?? serverFieldErrors?.passwordConfirm?.[0];
  const tokenError = serverFieldErrors?.token?.[0];

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="token" value={token} />

      <div className="space-y-1.5">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          aria-invalid={!!passwordError}
          {...register('password')}
        />
        {passwordError && <p className="text-sm text-destructive">{passwordError}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="passwordConfirm">Confirm new password</Label>
        <Input
          id="passwordConfirm"
          type="password"
          autoComplete="new-password"
          aria-invalid={!!passwordConfirmError}
          {...register('passwordConfirm')}
        />
        {passwordConfirmError && (
          <p className="text-sm text-destructive">{passwordConfirmError}</p>
        )}
      </div>

      {tokenError && (
        <p className="text-sm text-destructive" role="alert">
          {tokenError}
        </p>
      )}

      {serverFormError && (
        <p className="text-sm text-destructive" role="alert">
          {serverFormError}
        </p>
      )}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? 'Updating…' : 'Update password'}
      </Button>
    </form>
  );
}
