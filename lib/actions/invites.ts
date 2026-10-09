'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { createServerClient } from '@/lib/pocketbase-server';
import { createAdminClient } from '@/lib/pocketbase-admin';
import { generateInviteToken } from '@/lib/invite-tokens';
import { assertOwnership } from '@/lib/membership';
import {
  checkLimit,
  isTokenLocked,
  recordTokenFailure,
} from '@/lib/rate-limit';
import {
  acceptInviteSchema,
  createInviteSchema,
  revokeInviteSchema,
} from '@/lib/schemas/invite';

/**
 * Invite server actions (04-02 Plan, Patterns 7 + 8).
 *
 * Exports:
 *   - createInvite(homeId)   → owner-only; generates a 32-char base64url
 *                              token + inserts invite row + returns URL.
 *   - acceptInvite(token)    → authed-user; admin-client reads invite row
 *                              (owner-only listRule), atomic batch writes
 *                              home_members + invites.accepted_at.
 *   - revokeInvite(inviteId) → owner-only; deletes a pending invite.
 *
 * Security posture (threat_model T-04-02-01..10):
 *   - createInvite's `created_by_id` comes from pb.authStore.record.id —
 *     never from client input. (T-04-02-01)
 *   - acceptInvite hardcodes `role: 'member'` in the batch create —
 *     client cannot influence. (T-04-02-02)
 *   - acceptInvite uses the admin client ONLY for the invite read +
 *     invite update (invites.updateRule=null). The home_members create
 *     runs through the admin batch because the user is not yet a member
 *     (no membership rule can authorise). Post-accept, the `users.update`
 *     for last_viewed_home_id uses the user's own authed client.
 *   - The `accepted_by_id` field is set from pb.authStore.record.id on
 *     the user's authed client — server-side attribution. (T-04-02-03)
 *   - Token strings pass the `acceptInviteSchema` regex before any PB
 *     call, rejecting whitespace/length/non-base64url junk. (T-04-02-10)
 *   - Filter strings use pb.filter parameter binding. (T-04-02-08)
 */

const INVITE_TTL_DAYS = 14;

export type CreateInviteResult =
  | { ok: true; token: string; url: string; expiresAt: string }
  | { ok: false; formError: string };

export type AcceptInviteReason =
  | 'not-authed'
  | 'invalid'
  | 'expired'
  | 'already-accepted'
  | 'rate-limited'
  | 'locked'
  | 'error';

export type AcceptInviteResult =
  | { ok: true; homeId: string }
  | { ok: false; reason: AcceptInviteReason };

export type RevokeInviteResult =
  | { ok: true }
  | { ok: false; formError: string };

export async function createInvite(homeId: string): Promise<CreateInviteResult> {
  const parsed = createInviteSchema.safeParse({ homeId });
  if (!parsed.success) {
    return { ok: false, formError: 'Missing home id' };
  }

  const pb = await createServerClient();
  if (!pb.authStore.isValid || !pb.authStore.record) {
    return { ok: false, formError: 'Not signed in' };
  }
  const authId = pb.authStore.record.id;

  // D-13: createInvite is owner-only. assertOwnership throws on
  // non-owner; we translate to a friendly error.
  try {
    await assertOwnership(pb, parsed.data.homeId);
  } catch {
    return { ok: false, formError: 'Only the home owner can create invites' };
  }

  const token = generateInviteToken();
  const expiresAt = new Date(
    Date.now() + INVITE_TTL_DAYS * 86_400_000,
  ).toISOString();

  try {
    await pb.collection('invites').create({
      home_id: parsed.data.homeId,
      token,
      expires_at: expiresAt,
      created_by_id: authId,
    });
  } catch {
    return { ok: false, formError: 'Could not create invite' };
  }

  // Pitfall 9 — no-trailing-slash guard even if operator misconfigures.
  const baseUrl = process.env.SITE_URL?.replace(/\/+$/, '') ?? '';
  const url = `${baseUrl}/invite/${token}`;

  revalidatePath(`/h/${parsed.data.homeId}/settings`);
  revalidatePath(`/h/${parsed.data.homeId}/members`);

  return { ok: true, token, url, expiresAt };
}

export async function acceptInvite(token: string): Promise<AcceptInviteResult> {
  const parsed = acceptInviteSchema.safeParse({ token });
  if (!parsed.success) {
    return { ok: false, reason: 'invalid' };
  }

  // Phase 25 RATE-03: per-IP rate limit (5/60s) + per-token lockout
  // (3 failures → 15-min lock). See lib/rate-limit.ts for the full
  // design note. The IP is sourced from the x-forwarded-for / x-real-ip
  // headers (set by the Next.js edge or a reverse proxy); when the
  // header is missing (direct call, test environment) we fall back to
  // a fixed string so the limiter still tracks per-session state.
  let clientIp = 'unknown';
  try {
    const h = await headers();
    clientIp =
      h.get('x-forwarded-for')?.split(',')[0].trim() ||
      h.get('x-real-ip') ||
      'unknown';
  } catch {
    /* headers() throws outside a request context (e.g. unit tests) —
       keep the 'unknown' default so the limiter still runs */
  }

  // Per-token lockout check — run BEFORE the IP check so an already-
  // locked token cannot re-consume the bucket in anger.
  if (isTokenLocked(parsed.data.token)) {
    return { ok: false, reason: 'locked' };
  }

  // Per-IP rate limit: 5 accept attempts per 60s window.
  if (!checkLimit(`invite-accept:${clientIp}`, 5, 60_000)) {
    return { ok: false, reason: 'rate-limited' };
  }

  const pb = await createServerClient();
  if (!pb.authStore.isValid || !pb.authStore.record) {
    // Not-authed attempts still count against the IP bucket (already
    // consumed above) but should NOT count as a token-failure —
    // the token itself is not proven invalid yet.
    return { ok: false, reason: 'not-authed' };
  }
  const authId = pb.authStore.record.id;

  // The invites.listRule is owner-only; the invitee cannot read their
  // invite row directly. createAdminClient auths as superuser and lets
  // us look up by token. Pattern 8.
  let admin;
  try {
    admin = await createAdminClient();
  } catch {
    return { ok: false, reason: 'error' };
  }

  let invite;
  try {
    invite = await admin
      .collection('invites')
      .getFirstListItem(admin.filter('token = {:t}', { t: parsed.data.token }));
  } catch {
    // Token not found — count against the per-token failure counter.
    const locked = recordTokenFailure(parsed.data.token);
    if (locked) {
      return { ok: false, reason: 'locked' };
    }
    return { ok: false, reason: 'invalid' };
  }

  const inviteId = invite.id;
  const inviteHomeId = invite.home_id as string;

  // Expiry check. Counts against the per-token failure counter so a
  // stale-link brute-force still hits the lockout threshold.
  const expiresAt = new Date(invite.expires_at as string);
  if (Number.isFinite(expiresAt.getTime()) && Date.now() > expiresAt.getTime()) {
    const locked = recordTokenFailure(parsed.data.token);
    if (locked) {
      return { ok: false, reason: 'locked' };
    }
    return { ok: false, reason: 'expired' };
  }

  // Already-accepted bookkeeping.
  if (invite.accepted_at) {
    if (invite.accepted_by_id === authId) {
      // Self-replay: same user re-clicking their own invite link.
      return { ok: true, homeId: inviteHomeId };
    }
    // A different user trying to reuse a consumed token — count as
    // a token-level failure.
    const locked = recordTokenFailure(parsed.data.token);
    if (locked) {
      return { ok: false, reason: 'locked' };
    }
    return { ok: false, reason: 'already-accepted' };
  }

  // Defence: if current user is already a member (e.g., owner re-uses
  // their own invite; shouldn't happen via UI but harmless if it does),
  // short-circuit after marking the invite consumed to keep it single-use.
  let alreadyMember = false;
  try {
    await admin
      .collection('home_members')
      .getFirstListItem(
        admin.filter('home_id = {:h} && user_id = {:u}', {
          h: inviteHomeId,
          u: authId,
        }),
      );
    alreadyMember = true;
  } catch {
    /* not a member yet — proceed to batch below */
  }

  if (alreadyMember) {
    try {
      await admin.collection('invites').update(inviteId, {
        accepted_at: new Date().toISOString(),
        accepted_by_id: authId,
      });
    } catch {
      /* non-fatal — user is already a member, redirect still works */
    }
    return { ok: true, homeId: inviteHomeId };
  }

  // Atomic batch: create home_members row + mark invite accepted in one
  // tx. UNIQUE INDEX on home_members (home_id, user_id) is the backstop
  // against concurrent double-accept.
  try {
    const batch = admin.createBatch();
    batch.collection('home_members').create({
      home_id: inviteHomeId,
      user_id: authId,
      role: 'member',
    });
    batch.collection('invites').update(inviteId, {
      accepted_at: new Date().toISOString(),
      accepted_by_id: authId,
    });
    await batch.send();
  } catch {
    return { ok: false, reason: 'error' };
  }

  // HOME-03: set the joined home as last-viewed so the redirect lands
  // on the shared home dashboard. Non-fatal if it fails.
  try {
    await pb.collection('users').update(authId, {
      last_viewed_home_id: inviteHomeId,
    });
  } catch {
    /* non-fatal */
  }

  // 04-03 deviation (Rule 1): acceptInvite is called from the
  // /invite/[token]/page.tsx Server Component during render. Next 16
  // rejects revalidatePath() during RSC render ("used revalidatePath
  // during render which is unsupported"). The subsequent redirect(...)
  // triggers a fresh RSC render of the destination (/h/[homeId]) so
  // the newly-joined home is visible anyway. The sibling /h listing
  // will re-fetch on the user's next navigation to /h.
  return { ok: true, homeId: inviteHomeId };
}

export async function revokeInvite(inviteId: string): Promise<RevokeInviteResult> {
  const parsed = revokeInviteSchema.safeParse({ inviteId });
  if (!parsed.success) {
    return { ok: false, formError: 'Missing invite id' };
  }

  const pb = await createServerClient();
  if (!pb.authStore.isValid || !pb.authStore.record) {
    return { ok: false, formError: 'Not signed in' };
  }

  // Load the invite to know which home it belongs to (for assertOwnership
  // + redirect). The owner can read their own invites (listRule permits
  // home-owner-only reads), so the authed client works here.
  let invite;
  try {
    invite = await pb.collection('invites').getOne(parsed.data.inviteId);
  } catch {
    return { ok: false, formError: 'Could not find invite' };
  }

  const homeId = invite.home_id as string;

  try {
    await assertOwnership(pb, homeId);
  } catch {
    return { ok: false, formError: 'Only the home owner can revoke invites' };
  }

  // Cannot revoke an already-accepted invite — it's a historical record.
  if (invite.accepted_at) {
    return { ok: false, formError: 'Cannot revoke an already-accepted invite' };
  }

  try {
    await pb.collection('invites').delete(parsed.data.inviteId);
  } catch {
    return { ok: false, formError: 'Could not revoke invite' };
  }

  revalidatePath(`/h/${homeId}/settings`);
  revalidatePath(`/h/${homeId}/members`);
  return { ok: true };
}
