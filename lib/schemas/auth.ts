import { z } from 'zod';

/**
 * Shared zod schemas for the auth surface (02-03 Plan).
 *
 * Used in TWO places per plan:
 *  1. Client-side — react-hook-form's zodResolver consumes the schema to
 *     surface field errors inline as the user types.
 *  2. Server-side — lib/actions/auth.ts safeParse's the FormData before
 *     calling PocketBase. Never trust the client; always re-parse on the
 *     server.
 *
 * CRITICAL (RESEARCH §Pitfall 12): every `.refine()` on cross-field
 * validation MUST pass the `path: [...]` option. Without it, the refine
 * error lands under a mystery '' key in `.flatten().fieldErrors` and the
 * UI has no clean way to map it back to the field.
 */

export const loginSchema = z.object({
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const signupSchema = loginSchema
  .extend({
    name: z.string().min(1, 'Name is required').max(80, 'Name too long'),
    passwordConfirm: z.string().min(8, 'Password must be at least 8 characters'),
  })
  .refine((d) => d.password === d.passwordConfirm, {
    message: 'Passwords do not match',
    path: ['passwordConfirm'],
  });

export const resetRequestSchema = z.object({
  email: z.string().email('Please enter a valid email').min(1, 'Email is required'),
});

export const resetConfirmSchema = z
  .object({
    token: z.string().min(1, 'Reset token is required'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    passwordConfirm: z.string().min(8, 'Password must be at least 8 characters'),
  })
  .refine((d) => d.password === d.passwordConfirm, {
    message: 'Passwords do not match',
    path: ['passwordConfirm'],
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
export type ResetRequestInput = z.infer<typeof resetRequestSchema>;
export type ResetConfirmInput = z.infer<typeof resetConfirmSchema>;

/**
 * Server action return shape consumed by useActionState (React 19).
 *
 * `fieldErrors` — from zod's .flatten().fieldErrors (Record<field, string[]>).
 * `formError`   — non-field-specific error (e.g., "Invalid email or password").
 * On success, the action typically `redirect()`s and never actually returns
 * `{ ok: true }`, but the type union is exhaustive so `useActionState` stays
 * happy.
 */
export type ActionState =
  | { ok: true; redirectTo?: string }
  | { ok: false; fieldErrors?: Record<string, string[]>; formError?: string };
