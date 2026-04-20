'use client';

import PocketBase from 'pocketbase';

let pbInstance: PocketBase | null = null;

/**
 * Browser singleton PocketBase client, scoped to window.location.origin.
 *
 * CAVEAT (RESEARCH §Pitfall 5): The pb_auth cookie is HttpOnly, so
 * document.cookie cannot read its value. Calling
 * `pb.authStore.loadFromCookie(document.cookie)` therefore does NOT hydrate
 * the browser authStore — `pb.authStore.isValid` will be `false` even when
 * the user is logged in.
 *
 * That is fine, because:
 *   1. Same-origin fetches from the browser SDK automatically attach the
 *      pb_auth cookie via the browser's cookie jar, so requests to
 *      /api/collections/... are authenticated at the network layer.
 *   2. PocketBase validates the token server-side on every request; there
 *      is no need for the browser to know the token value.
 *
 * Treat the browser authStore as a display-only cache, NOT a source of
 * truth. When a UI needs the authed user's record, fetch it in a Server
 * Component (via createServerClient) and pass it down as a prop.
 *
 * The singleton ensures realtime subscriptions, record-loader state, and
 * optimistic updates all share one PocketBase instance per tab.
 */
export function getBrowserClient(): PocketBase {
  if (typeof window === 'undefined') {
    throw new Error(
      'getBrowserClient() called in server context — use createServerClient() from @/lib/pocketbase-server instead',
    );
  }
  if (!pbInstance) {
    pbInstance = new PocketBase(window.location.origin);
  }
  return pbInstance;
}
