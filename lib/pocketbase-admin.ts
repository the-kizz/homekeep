import PocketBase from 'pocketbase';
import { PB_URL } from '@/lib/constants';

/**
 * PB client authenticated as a superuser, used by server actions that
 * need to bypass listRule/viewRule — specifically `acceptInvite`, where
 * the invitee cannot read invites (listRule/viewRule are owner-only per
 * migration `1714953601_invites.js`) but we still need to validate the
 * token server-side.
 *
 * NEVER expose this client through a client component. NEVER pass its
 * auth token through to the browser. It is server-action-only.
 *
 * Requires `PB_ADMIN_EMAIL` + `PB_ADMIN_PASSWORD` env vars (Phase 4.1
 * deploy — see 04-01 SUMMARY §User Setup Required).
 *
 * Module-level TTL cache (Pitfall 3): memoises the authed client for
 * 30 minutes to avoid re-authenticating on every request. PB's bootstrap
 * rate limiter (02-01) caps `*:authWithPassword` at 20/60s, so a busy
 * household spamming invite-accepts could otherwise hit 429. The cache
 * turns "per-request auth" into "per-30-minutes auth".
 *
 * Cache invalidation: on auth-store token expiry (pb.authStore.isValid
 * flips to false), the next call re-authenticates transparently.
 * `resetAdminClientCache()` is exposed for test teardown.
 */

const TOKEN_TTL_MS = 30 * 60_000; // 30 minutes

let cached: { pb: PocketBase; expiresAt: number } | null = null;

export async function createAdminClient(): Promise<PocketBase> {
  // Cache hit: auth still fresh and within TTL window.
  if (cached && Date.now() < cached.expiresAt && cached.pb.authStore.isValid) {
    return cached.pb;
  }

  const email = process.env.PB_ADMIN_EMAIL;
  const password = process.env.PB_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD not configured');
  }

  const pb = new PocketBase(PB_URL);
  // PB 0.23+ renamed `pb.admins.authWithPassword` → `_superusers`
  // collection auth. This project uses PB 0.37.x, so the new form
  // is mandatory.
  await pb.collection('_superusers').authWithPassword(email, password);

  cached = { pb, expiresAt: Date.now() + TOKEN_TTL_MS };
  return pb;
}

/**
 * Testing helper: clears the module-level TTL cache so a test can reset
 * between scenarios. No production caller needs this.
 */
export function resetAdminClientCache(): void {
  cached = null;
}
