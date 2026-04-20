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

export function createClient(): PocketBase {
  if (typeof window === 'undefined') {
    // Server-side: inside the container, PocketBase is on loopback.
    // In dev, scripts/dev-pb.js also binds to 127.0.0.1:8090 so this works uniformly.
    return new PocketBase('http://127.0.0.1:8090');
  }
  // Browser: same origin. Caddy proxies /api/* and /_/* to PocketBase in production.
  // Per D-03, no build-time URL env is used — the SDK always matches the page origin.
  return new PocketBase(window.location.origin);
}
