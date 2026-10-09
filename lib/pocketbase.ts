/**
 * Phase 1 back-compat shim.
 *
 * This factory exists so tests/unit/pocketbase.test.ts (Phase 1 regression
 * sentinel) keeps passing after Phase 2 split the factory into two
 * specialised entry points.
 *
 * NEW CODE MUST use:
 *   - lib/pocketbase-server.ts → createServerClient() — Server Components,
 *     Route Handlers, Server Actions. Hydrates from the pb_auth cookie.
 *   - lib/pocketbase-browser.ts → getBrowserClient() — Client Components.
 *     Singleton pointed at window.location.origin.
 *
 * See D-03 and RESEARCH §Pattern: SSR Cookie Bridge.
 */
import PocketBase from 'pocketbase';
import { PB_URL } from '@/lib/constants';

export function createClient(): PocketBase {
  if (typeof window === 'undefined') {
    // Server-side: loopback by default (same container in production,
    // scripts/dev-pb.js in dev); PB_URL overrides it.
    return new PocketBase(PB_URL);
  }
  // Browser: same origin. Caddy proxies /api/* and /_/* to PocketBase in production.
  // Per D-03, no build-time URL env is used — the SDK always matches the page origin.
  return new PocketBase(window.location.origin);
}
