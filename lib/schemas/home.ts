import { z } from 'zod';

/**
 * Home form schema (02-04 Plan, CONTEXT D-09).
 *
 * Shared between client (react-hook-form zodResolver) and server
 * (lib/actions/homes.ts safeParse). NEVER trust the client — server
 * re-parses every FormData payload before hitting PB.
 *
 * `address` is optional AND accepts the empty string so the HTML form can
 * post an unfilled text input without triggering a validator error — the
 * server action coerces empty -> undefined before passing to PB.
 *
 * `timezone` is validated loosely (length 3-50). True IANA validation is
 * left to PB which rejects bad timezone strings with its own error surface
 * on save.
 */

export const homeSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name too long'),
  address: z
    .string()
    .max(200, 'Address too long')
    .optional()
    .or(z.literal('')),
  timezone: z
    .string()
    .min(3, 'Timezone is required')
    .max(50, 'Timezone too long'),
});

export type HomeInput = z.infer<typeof homeSchema>;
