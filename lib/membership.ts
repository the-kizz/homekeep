import type PocketBase from 'pocketbase';

/**
 * Membership helpers (04-02, Pattern 9).
 *
 * With Phase 4's DB-layer rule swap in place (migration
 * `1714953602_update_rules_multi_member.js`), every mutation on
 * homes/areas/tasks/completions is gated by the PB rule
 * `@request.auth.home_members_via_user_id.home_id ?= <target>` — so PB is
 * the source of ownership/membership truth. These helpers are
 * defence-in-depth: they surface a friendly `formError` before a PB
 * write turns into a cryptic 404/403, and they let server actions
 * branch on role (owner vs member) without a second round-trip.
 *
 * Performance: each call is a single lookup on (home_id, user_id),
 * which has a UNIQUE INDEX per 04-01 Task 1.
 *
 * Filter safety: `pb.filter('home_id = {:h} && user_id = {:u}', ...)`
 * uses PB parameter binding (02-04 anti-SQLi pattern). No template-
 * literal concatenation of user input.
 */

/**
 * Throws if the authenticated user is not a member of `homeId`.
 * Returns `{ role }` on success so callers can branch on owner/member.
 */
export async function assertMembership(
  pb: PocketBase,
  homeId: string,
): Promise<{ role: 'owner' | 'member' }> {
  const authId = pb.authStore.record?.id;
  if (!authId) throw new Error('Not authenticated');

  const row = await pb
    .collection('home_members')
    .getFirstListItem(
      pb.filter('home_id = {:h} && user_id = {:u}', { h: homeId, u: authId }),
    );

  return { role: row.role as 'owner' | 'member' };
}

/**
 * Throws if the authenticated user is not the OWNER of `homeId`.
 * Used by createInvite, removeMember, revokeInvite, updateHome,
 * deleteHome — any action that should refuse non-owners (D-13).
 */
export async function assertOwnership(
  pb: PocketBase,
  homeId: string,
): Promise<void> {
  const { role } = await assertMembership(pb, homeId);
  if (role !== 'owner') throw new Error('Not home owner');
}
