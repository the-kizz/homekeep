'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/pocketbase-server';
import { assertMembership } from '@/lib/membership';

/**
 * Onboarding skip server action (05-03 Task 1).
 *
 * `skipOnboarding(homeId)` is called by the wizard's "Skip all" link.
 * It sets `homes.onboarded = true` without creating any tasks, so the
 * dashboard redirect stops firing.
 *
 * Security:
 *   - assertMembership verifies the caller is a member of the home
 *     (defence-in-depth; only members can reach the wizard URL anyway).
 *   - PB's homes.updateRule enforces `owner_id = @request.auth.id` —
 *     if a non-owner member ever reaches this code path (edge case —
 *     invitees join pre-onboarded homes), the PB write fails and we
 *     surface a friendly formError (T-05-03-05).
 */

export type SkipOnboardingResult =
  | { ok: true }
  | { ok: false; formError: string };

export async function skipOnboarding(
  homeId: string,
): Promise<SkipOnboardingResult> {
  if (typeof homeId !== 'string' || homeId.length !== 15) {
    return { ok: false, formError: 'Invalid home id' };
  }

  const pb = await createServerClient();
  if (!pb.authStore.isValid) {
    return { ok: false, formError: 'Not signed in' };
  }

  try {
    await assertMembership(pb, homeId);
  } catch {
    return { ok: false, formError: 'You are not a member of this home' };
  }

  try {
    await pb.collection('homes').update(homeId, {
      onboarded: true,
    });
  } catch {
    // Most likely failure: updateRule rejects a non-owner member. Surface
    // a friendly error without leaking PB's 403 internals (T-05-03-05).
    return {
      ok: false,
      formError: 'Only the owner can complete onboarding',
    };
  }

  revalidatePath(`/h/${homeId}`);
  return { ok: true };
}
