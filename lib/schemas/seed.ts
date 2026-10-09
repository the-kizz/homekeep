import { z } from 'zod';

/**
 * Seed schemas for the onboarding wizard's `batchCreateSeedTasks` action.
 *
 * The payload is deliberately thin: the client names a seed and where it
 * should live, and the server fills in everything else from SEED_LIBRARY.
 * `name` and `frequency_days` are optional overrides from the wizard's Edit
 * expand; when omitted the library defaults apply. Seasonal months are never
 * accepted from the client — the server derives them from the seed's season
 * tag and the home's hemisphere, so a client cannot forge a window.
 *
 * `area` is either an existing area id (verified against the home inside the
 * action, so a cross-home id is rejected) or a suggested-area key that the
 * action resolves to an existing same-named area or creates on demand.
 *
 * `selections.max(50)` caps batch size to fit PB's batch maxRequests (50)
 * once the trailing homes.update op is appended.
 */

export const SUGGESTED_AREA_KEYS = [
  'kitchen',
  'bathroom',
  'living',
  'yard',
  'whole_home',
] as const;

export const seedAreaSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('existing'),
    id: z.string().length(15, 'Invalid area id'),
  }),
  z.object({
    kind: z.literal('suggested'),
    key: z.enum(SUGGESTED_AREA_KEYS),
  }),
]);

export const seedSelectionSchema = z.object({
  seed_id: z.string().min(1, 'seed_id is required'),
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(100, 'Name too long')
    .optional(),
  frequency_days: z
    .number()
    .int('Frequency must be a whole number')
    .min(1, 'Frequency must be at least 1 day')
    .max(365, 'Frequency must be at most 365 days')
    .optional(),
  area: seedAreaSchema,
});

export const batchCreateSeedsSchema = z.object({
  home_id: z.string().length(15, 'Invalid home id'),
  selections: z
    .array(seedSelectionSchema)
    .min(1, 'At least one seed is required')
    .max(50, 'At most 50 seeds can be batched'),
});

export type SeedAreaInput = z.infer<typeof seedAreaSchema>;
export type SuggestedAreaKey = (typeof SUGGESTED_AREA_KEYS)[number];
export type SeedSelectionInput = z.infer<typeof seedSelectionSchema>;
export type BatchCreateSeedsInput = z.infer<typeof batchCreateSeedsSchema>;
