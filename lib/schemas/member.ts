import { z } from 'zod';

/**
 * Shared zod schemas for member server actions (04-02 Task 1).
 *
 * The action-layer guards (authId === memberUserId short-circuit,
 * role === 'owner' short-circuit, assertOwnership) are tested at the
 * integration layer — these schemas just validate presence.
 */

export const removeMemberSchema = z.object({
  homeId: z.string().min(1, 'homeId is required'),
  memberUserId: z.string().min(1, 'memberUserId is required'),
});

export const leaveHomeSchema = z.object({
  homeId: z.string().min(1, 'homeId is required'),
});

export type RemoveMemberInput = z.infer<typeof removeMemberSchema>;
export type LeaveHomeInput = z.infer<typeof leaveHomeSchema>;
