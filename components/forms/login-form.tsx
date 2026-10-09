'use client';

import { useActionState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput, type ActionState } from '@/lib/schemas/auth';
import { loginAction } from '@/lib/actions/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const INITIAL: ActionState = { ok: false };

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(
    loginAction,
    INITIAL,
  );

  const {
    register,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    mode: 'onBlur',
    defaultValues: { email: '', password: '' },
  });

  const serverFieldErrors = !state.ok ? state.fieldErrors : undefined;
  const serverFormError = !state.ok ? state.formError : undefined;

  const emailError = errors.email?.message ?? serverFieldErrors?.email?.[0];
  const passwordError = errors.password?.message ?? serverFieldErrors?.password?.[0];

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {next && <input type="hidden" name="next" value={next} />}

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
          autoComplete="current-password"
          aria-invalid={!!passwordError}
          {...register('password')}
        />
        {passwordError && <p className="text-sm text-destructive">{passwordError}</p>}
      </div>

      {/* v1.2.1: Remember me — default checked = 14-day persistent cookie
          (current behavior); unchecked = session cookie that expires when
          the browser is closed. Useful on shared devices. */}
      <div className="flex items-center gap-2">
        <input
          id="rememberMe"
          name="rememberMe"
          type="checkbox"
          defaultChecked
          value="on"
          className="size-4 rounded border-input"
        />
        <Label htmlFor="rememberMe" className="text-sm font-normal">
          Keep me signed in for 14 days
        </Label>
      </div>

      {serverFormError && (
        <p className="text-sm text-destructive" role="alert">
          {serverFormError}
        </p>
      )}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
