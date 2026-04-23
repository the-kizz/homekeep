// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/conroyke56/homekeep

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  ensureDemoSession,
  DEMO_SESSION_COOKIE_NAME,
  DEMO_SESSION_COOKIE_MAX_AGE,
} from '@/lib/demo-session';

/**
 * Phase 26 DEMO-02 — demo-mode session bootstrap.
 *
 * GET /api/demo/session
 *
 * Behaviour:
 *   - If DEMO_MODE !== 'true': return 404 (this route is dead-code in
 *     production).
 *   - Otherwise: call ensureDemoSession(), set the pb_auth cookie from
 *     the PocketBase-minted Set-Cookie header, set the homekeep_demo_session
 *     tracking cookie keyed to the user id, and redirect to /h/<homeId>.
 *
 * First-visit link pattern: the demo landing page (or any button on
 * homekeep.demo.kizz.space) should link to `/api/demo/session` instead
 * of `/login`. The handler creates the ephemeral user + home + 15 seed
 * tasks on the first hit, then redirects to the newly-minted dashboard
 * with the user already authenticated.
 *
 * Resume: subsequent visits with the `homekeep_demo_session` cookie
 * intact skip creation and redirect to the existing home.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  // D-03 dead-code guard. Duplicates the lib-level assertDemoMode but
  // means we return 404 (not 500) when DEMO_MODE is unset — standard
  // practice for gated routes.
  if (process.env.DEMO_MODE !== 'true') {
    return new NextResponse('Not found', { status: 404 });
  }

  let result;
  try {
    const store = await cookies();
    result = await ensureDemoSession(store);
  } catch (err) {
    console.error('[demo/session] failed:', err);
    return NextResponse.json(
      { ok: false, error: 'Could not start demo session' },
      { status: 500 },
    );
  }

  // Extract the pb_auth value from the Set-Cookie header PocketBase
  // exported (same pattern as lib/actions/auth.ts::extractPbAuthValue).
  const pbAuthValue = extractPbAuthValue(result.pbAuthCookie);

  // Build the redirect response so we can attach cookies to it directly.
  // The `origin` from the request is the same-origin demo host; we
  // redirect relative to it so the pb_auth cookie binds correctly.
  const url = new URL(request.url);
  url.pathname = `/h/${result.homeId}`;
  url.search = '';

  const response = NextResponse.redirect(url, { status: 303 });

  // pb_auth cookie — mirrors lib/actions/auth.ts cookieOptions(), but
  // `secure: true` is HARDCODED here because the demo ALWAYS runs behind
  // Caddy TLS (unlike LAN-HTTP personal instances).
  response.cookies.set('pb_auth', pbAuthValue, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 14, // 14d, matches PB authTokenDuration
  });

  // homekeep_demo_session tracking cookie — value is the demo user id
  // so ensureDemoSession can locate the user on resume. HttpOnly so
  // client JS can't tamper; SameSite=Lax so redirect-from-link works.
  response.cookies.set(DEMO_SESSION_COOKIE_NAME, result.userId, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: DEMO_SESSION_COOKIE_MAX_AGE,
  });

  return response;
}

/**
 * exportToCookie returns a full Set-Cookie header:
 *   "pb_auth=<url-encoded-json>; HttpOnly; Path=/; Max-Age=..."
 * Strip everything after the first ';' and return just the value slice
 * past the first '='. Identical helper pattern to lib/actions/auth.ts.
 */
function extractPbAuthValue(setCookieHeader: string): string {
  const first = setCookieHeader.split(';')[0] ?? '';
  const eq = first.indexOf('=');
  return eq === -1 ? '' : first.slice(eq + 1);
}
