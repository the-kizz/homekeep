'use client';

import { useActionState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { signupSchema, type SignupInput, type ActionState } from '@/lib/schemas/auth';
import { signupAction } from '@/lib/actions/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const INITIAL: ActionState = { ok: false };

export function SignupForm() {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(
    signupAction,
    INITIAL,
  );

  const {
    register,
    formState: { errors },
  } = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    mode: 'onBlur',
    defaultValues: { name: '', email: '', password: '', passwordConfirm: '' },
  });

  const serverFieldErrors = !state.ok ? state.fieldErrors : undefined;
  const serverFormError = !state.ok ? state.formError : undefined;

  const nameError = errors.name?.message ?? serverFieldErrors?.name?.[0];
  const emailError = errors.email?.message ?? serverFieldErrors?.email?.[0];
  const passwordError = errors.password?.message ?? serverFieldErrors?.password?.[0];
  const passwordConfirmError =
    errors.passwordConfirm?.message ?? serverFieldErrors?.passwordConfirm?.[0];

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          type="text"
          autoComplete="name"
          aria-invalid={!!nameError}
          {...register('name')}
        />
        {nameError && <p className="text-sm text-destructive">{nameError}</p>}
      </div>

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

      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
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
        <Label htmlFor="passwordConfirm">Confirm password</Label>
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

      {serverFormError && (
        <p className="text-sm text-destructive" role="alert">
          {serverFormError}
        </p>
      )}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? 'Creating account…' : 'Create account'}
      </Button>
    </form>
  );
}
