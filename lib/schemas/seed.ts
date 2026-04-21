import { z } from 'zod';

/**
 * Seed schemas (05-03 Task 1).
 *
 * Powers the onboarding wizard's `batchCreateSeedTasks` server action.
 * Shared between client (for defensive pre-validation — not strictly
 * required since the client owns the wizard state + submits through a
 * server action) and server (mandatory safeParse of the batched payload).
 *
 * Two schemas:
 *   - seedSelectionSchema   → per-seed accepted payload after user edits
 *                              in the wizard (Edit action in SeedTaskCard)
 *   - batchCreateSeedsSchema → whole submit envelope (home_id + array of
 *                              selections)
 *
 * Defence in depth (threat_model T-05-03-01..06):
 *   - `seed_id` non-empty but also membership-checked against SEED_LIBRARY
 *      inside the server action itself (T-05-03-01; client can't batch-
 *      spawn arbitrary fabricated seeds even if regex-valid).
 *   - `frequency_days` int in [1, 365] mirrors `taskSchema` from Phase 2
 *      (SPEC §7.5 recurrence bounds + T-05-03-03 DoS).
 *   - `area_id` exact 15-char PB record id; cross-home area ids rejected
 *      inside the action by fetching the home's areas.getFullList once
 *      and set-checking (T-05-03-02).
 *   - `selections.max(50)` caps batch size — matches PB's
 *      `settings.batch.maxRequests = 50` from bootstrap_batch.pb.js
 *      (T-05-03-06 DoS + keeps PB batch happy when the homes.update row
 *      is appended to the selections, taking the effective batch size
 *      to 51 which PB tolerates as N+1 within the maxRequests window).
 *      The SEED_LIBRARY size (currently 30) is well under the cap.
 */

export const seedSelectionSchema = z.object({
  seed_id: z.string().min(1, 'seed_id is required'),
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name too long'),
  frequency_days: z
    .number()
    .int('Frequency must be a whole number')
    .min(1, 'Frequency must be at least 1 day')
    .max(365, 'Frequency must be at most 365 days'),
  area_id: z.string().length(15, 'Invalid area id'),
});

export const batchCreateSeedsSchema = z.object({
  home_id: z.string().length(15, 'Invalid home id'),
  selections: z
    .array(seedSelectionSchema)
    .min(1, 'At least one seed is required')
    .max(50, 'At most 50 seeds can be batched'),
});

export type SeedSelectionInput = z.infer<typeof seedSelectionSchema>;
export type BatchCreateSeedsInput = z.infer<typeof batchCreateSeedsSchema>;
