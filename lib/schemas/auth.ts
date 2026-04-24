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

/**
 * v1.2.1 PATCH2-05: configurable password policy.
 *
 * Phase 23 SEC-06 raised the signup/reset-confirm floor 8 → 12 chars for
 * public-facing deployments. Self-hosted operators on LAN / Tailscale
 * don't need that bar — and the mismatch between login (8) and signup
 * (12) made for a confusing UX. The env flag lets operators opt in:
 *
 *   PASSWORD_POLICY (or NEXT_PUBLIC_PASSWORD_POLICY for client bundles)
 *   = 'simple' (default) → signup/reset min 8, login min 8
 *   = 'strong'           → signup/reset min 12, login min 8 (back-compat
 *                          so pre-flip accounts can still authenticate)
 *
 * The refine reads `process.env` at parse time (not module load) so
 * tests can stub via vi.stubEnv() without module cache juggling. Next.js
 * inlines `NEXT_PUBLIC_*` at build time in the client bundle; docker
 * compose passes both at runtime for the server action path.
 */
function isStrongPolicy(): boolean {
  const v =
    process.env.NEXT_PUBLIC_PASSWORD_POLICY ??
    process.env.PASSWORD_POLICY ??
    'simple';
  return v === 'strong';
}

function signupPasswordMin(): number {
  return isStrongPolicy() ? 12 : 8;
}

// Login always tolerates 8-char minimums so pre-SEC-06 accounts
// (and simple-mode accounts after flipping to strong) can still log in.
const LOGIN_PASSWORD_MIN = 8;

export const loginSchema = z.object({
  email: z.string().email('Please enter a valid email'),
  password: z
    .string()
    .min(LOGIN_PASSWORD_MIN, `Password must be at least ${LOGIN_PASSWORD_MIN} characters`),
});

export const signupSchema = z
  .object({
    email: z.string().email('Please enter a valid email'),
    password: z.string().superRefine((val, ctx) => {
      const min = signupPasswordMin();
      if (val.length < min) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_small,
          minimum: min,
          type: 'string',
          inclusive: true,
          message: `Password must be at least ${min} characters`,
        });
      }
    }),
    name: z.string().min(1, 'Name is required').max(80, 'Name too long'),
    passwordConfirm: z.string().superRefine((val, ctx) => {
      const min = signupPasswordMin();
      if (val.length < min) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_small,
          minimum: min,
          type: 'string',
          inclusive: true,
          message: `Password must be at least ${min} characters`,
        });
      }
    }),
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
    password: z.string().superRefine((val, ctx) => {
      const min = signupPasswordMin();
      if (val.length < min) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_small,
          minimum: min,
          type: 'string',
          inclusive: true,
          message: `Password must be at least ${min} characters`,
        });
      }
    }),
    passwordConfirm: z.string().superRefine((val, ctx) => {
      const min = signupPasswordMin();
      if (val.length < min) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_small,
          minimum: min,
          type: 'string',
          inclusive: true,
          message: `Password must be at least ${min} characters`,
        });
      }
    }),
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
