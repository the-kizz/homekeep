import PocketBase from 'pocketbase';
import { cookies } from 'next/headers';

/**
 * Creates a fresh, request-scoped PocketBase client for Server Components,
 * Route Handlers, and Server Actions.
 *
 * Reads the HttpOnly `pb_auth` cookie (D-03) via Next 16's async cookies() API
 * and hydrates the SDK authStore with loadFromCookie. When the cookie is
 * absent the client is returned with an empty authStore — callers can still
 * make unauthenticated requests (e.g. signup / login) against the PB API.
 *
 * CRITICAL: Do NOT cache this client or module-level instantiate it. Each
 * request must get its own `new PocketBase(...)` so two concurrent requests
 * from different users cannot share an authStore. A unit test asserts that
 * two consecutive calls produce distinct instances.
 *
 * Base URL is the loopback 127.0.0.1:8090 because in production the Next.js
 * server runs in the same container as PocketBase (s6-overlay supervises
 * both). In dev, scripts/dev-pb.js binds to 127.0.0.1:8090 too, so this works
 * uniformly (matches Phase 1 D-03).
 */
export async function createServerClient(): Promise<PocketBase> {
  const pb = new PocketBase('http://127.0.0.1:8090');

  const cookieStore = await cookies();
  const pbAuth = cookieStore.get('pb_auth');

  if (pbAuth?.value) {
    // loadFromCookie accepts a full Cookie header string OR a bare "name=value"
    // pair. The value coming from cookieStore.get is URL-encoded JSON (that
    // is what exportToCookie wrote on the server); passing it back through
    // loadFromCookie round-trips the authStore.
    pb.authStore.loadFromCookie(`pb_auth=${pbAuth.value}`);
  }

  return pb;
}

/**
 * Variant of createServerClient that additionally performs an authRefresh
 * when the cookie-loaded authStore is valid — useful at trust boundaries
 * such as the proxy.ts route guard where you want the most current token
 * and user record before rendering an authenticated route.
 *
 * For plain reads against collections, createServerClient is sufficient —
 * PB re-validates the token on every request server-side, so a stale token
 * surfaces as a 401 from the specific call rather than silently succeeding.
 */
export async function createServerClientWithRefresh(): Promise<PocketBase> {
  const pb = await createServerClient();
  if (pb.authStore.isValid) {
    try {
      await pb.collection('users').authRefresh();
    } catch {
      // v1.3 TESTFIX-03: transient PB failure under concurrent
      // signup/login load can briefly reject a freshly-issued
      // token (the race is visible to CI when rate-limits are
      // disabled and 15+ parallel users signup in a window).
      // Retry once after a short pause before treating the token
      // as definitively invalid. Only the error path pays the
      // extra round-trip; the happy path is untouched.
      try {
        await new Promise((r) => setTimeout(r, 150));
        await pb.collection('users').authRefresh();
      } catch {
        // Token rejected on retry — really is expired / revoked.
        // Clear the in-memory authStore so downstream code sees
        // the user as logged out; the stale cookie is handled by
        // the caller (usually by deleting it via cookies().delete
        // in the same response).
        pb.authStore.clear();
      }
    }
  }
  return pb;
}
