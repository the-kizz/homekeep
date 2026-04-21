'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/pocketbase-server';
import { assertMembership, assertOwnership } from '@/lib/membership';
import { leaveHomeSchema, removeMemberSchema } from '@/lib/schemas/member';

/**
 * Member server actions (04-02 Plan, Pattern 13).
 *
 * Exports:
 *   - removeMember(homeId, memberUserId) → owner-only; deletes the
 *     target's home_members row. Cannot remove self (use leaveHome)
 *     and cannot remove the owner row.
 *   - leaveHome(homeId) → non-owner self-leave; deletes own row +
 *     clears `users.last_viewed_home_id` if it matched.
 *
 * Security posture (threat_model T-04-02-06):
 *   - removeMember: authId === memberUserId short-circuit returns a
 *     friendly "use Leave Home" formError before assertOwnership —
 *     prevents the owner from accidentally bricking their own home.
 *   - owner-role row protection: a subsequent guard blocks deletion of
 *     any row with role === 'owner'. Combined with the self-short-
 *     circuit, this means removeMember cannot touch ownership.
 *   - leaveHome: owners are refused via assertMembership's role check.
 *
 * Downstream effects (Pitfall 6):
 *   - When a member is removed, tasks assigned to them still point at
 *     their user record, but resolveAssignee (Wave 3) filters by
 *     current-home members and falls through to area default /
 *     'anyone'. No DB cascade is needed — the UI updates organically
 *     on next read.
 */

export type RemoveMemberResult = { ok: true } | { ok: false; formError: string };

export async function removeMember(
  homeId: string,
  memberUserId: string,
): Promise<RemoveMemberResult> {
  const parsed = removeMemberSchema.safeParse({ homeId, memberUserId });
  if (!parsed.success) {
    return { ok: false, formError: 'Missing fields' };
  }

  const pb = await createServerClient();
  if (!pb.authStore.isValid || !pb.authStore.record) {
    return { ok: false, formError: 'Not signed in' };
  }
  const authId = pb.authStore.record.id;

  if (authId === parsed.data.memberUserId) {
    return { ok: false, formError: 'Use Leave Home instead of Remove' };
  }

  try {
    await assertOwnership(pb, parsed.data.homeId);
  } catch {
    return { ok: false, formError: 'Only the home owner can remove members' };
  }

  try {
    const row = await pb
      .collection('home_members')
      .getFirstListItem(
        pb.filter('home_id = {:h} && user_id = {:u}', {
          h: parsed.data.homeId,
          u: parsed.data.memberUserId,
        }),
      );
    if (row.role === 'owner') {
      return { ok: false, formError: 'Cannot remove the home owner' };
    }
    await pb.collection('home_members').delete(row.id);
  } catch (err) {
    // Distinguish the "cannot remove owner" short-circuit from a real
    // delete failure: if the err is our own thrown Error, re-use that.
    if (err instanceof Error && err.message === 'Cannot remove the home owner') {
      return { ok: false, formError: err.message };
    }
    return { ok: false, formError: 'Could not remove member' };
  }

  // Per RESEARCH Open Q #2: clear the removed user's last_viewed_home_id
  // if it matched this home, so their next login lands somewhere valid
  // instead of a 404. Non-fatal try/catch — the membership delete is the
  // primary effect; this is polish.
  try {
    const target = await pb.collection('users').getOne(parsed.data.memberUserId);
    if (target.last_viewed_home_id === parsed.data.homeId) {
      await pb.collection('users').update(parsed.data.memberUserId, {
        last_viewed_home_id: null,
      });
    }
  } catch {
    /* non-fatal */
  }

  revalidatePath(`/h/${parsed.data.homeId}`, 'layout');
  revalidatePath(`/h/${parsed.data.homeId}/members`);
  return { ok: true };
}

export type LeaveHomeResult =
  | { ok: true; redirectTo: string }
  | { ok: false; formError: string };

export async function leaveHome(homeId: string): Promise<LeaveHomeResult> {
  const parsed = leaveHomeSchema.safeParse({ homeId });
  if (!parsed.success) {
    return { ok: false, formError: 'Missing home id' };
  }

  const pb = await createServerClient();
  if (!pb.authStore.isValid || !pb.authStore.record) {
    return { ok: false, formError: 'Not signed in' };
  }
  const authId = pb.authStore.record.id;

  let role: 'owner' | 'member';
  try {
    const m = await assertMembership(pb, parsed.data.homeId);
    role = m.role;
  } catch {
    return { ok: false, formError: 'You are not a member of this home' };
  }
  if (role === 'owner') {
    return {
      ok: false,
      formError:
        'Home owners must delete the home or transfer ownership before leaving',
    };
  }

  try {
    const row = await pb
      .collection('home_members')
      .getFirstListItem(
        pb.filter('home_id = {:h} && user_id = {:u}', {
          h: parsed.data.homeId,
          u: authId,
        }),
      );
    await pb.collection('home_members').delete(row.id);
  } catch {
    return { ok: false, formError: 'Could not leave home' };
  }

  // Clear last_viewed_home_id if it pointed at the left home.
  try {
    const me = await pb.collection('users').getOne(authId);
    if (me.last_viewed_home_id === parsed.data.homeId) {
      await pb.collection('users').update(authId, {
        last_viewed_home_id: null,
      });
    }
  } catch {
    /* non-fatal */
  }

  revalidatePath('/h', 'layout');
  return { ok: true, redirectTo: '/h' };
}
