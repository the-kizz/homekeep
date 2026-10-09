import { z } from 'zod';

/**
 * Shared zod schemas for invite server actions (04-02 Task 1).
 *
 * The `acceptInviteSchema` token regex mirrors the PB migration
 * `1714953601_invites.js` field constraint: `^[A-Za-z0-9_-]+$` (base64url
 * alphabet) with length 20..64. 20 is the safety floor; 32 is the actual
 * token length produced by `generateInviteToken()`; 64 is an upper bound
 * for future-proofing.
 *
 * Defense in depth: schema runs BEFORE the PB call, so malformed tokens
 * (length, whitespace, non-base64url chars) get a zod error rather than
 * a PB validation error, which keeps the error surface clean.
 */

export const createInviteSchema = z.object({
  homeId: z.string().min(1, 'homeId is required'),
});

export const acceptInviteSchema = z.object({
  token: z
    .string()
    .regex(/^[A-Za-z0-9_-]{20,64}$/, 'Invalid token format'),
});

export const revokeInviteSchema = z.object({
  inviteId: z.string().min(1, 'inviteId is required'),
});

export type CreateInviteInput = z.infer<typeof createInviteSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
export type RevokeInviteInput = z.infer<typeof revokeInviteSchema>;
