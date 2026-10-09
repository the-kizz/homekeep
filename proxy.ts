import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getBuildIdPublic } from '@/lib/constants';

/**
 * Next 16 proxy.ts (formerly middleware.ts — renamed per
 * https://nextjs.org/docs/messages/middleware-to-proxy).
 *
 * Runs on the Node.js runtime (proxy.ts does NOT support edge). Guards the
 * (app) route group by a pb_auth cookie presence check. No cryptographic
 * validation happens here — that would add latency on every navigation and
 * PocketBase re-validates the token on every API call anyway. A forged or
 * expired cookie that reaches a Server Component will fail the first
 * pb.collection().getList() call, and the `(app)/layout.tsx` Server
 * Component adds defense-in-depth by re-checking pb.authStore.isValid.
 *
 * Phase 24 HDR-04: emits `HomeKeep-Build` response header on every response
 * (provenance marker). Value honours the `HK_BUILD_STEALTH` env flag via
 * `getBuildIdPublic()` — when stealth is on, the header is `hk-hidden`
 * instead of the real UUID so fingerprint-based CVE targeting gets one
 * fewer breadcrumb. Real HK_BUILD_ID still lands in the scheduler boot
 * log + container image label for server-side forensics.
 */

// Routes that require auth. Everything under `/h` and `/settings` is protected.
const PROTECTED_PREFIXES = ['/h', '/settings'];

// Routes that should redirect to /h if already authed.
const GUEST_ONLY_PREFIXES = ['/login', '/signup', '/reset-password'];

/**
 * HDR-04: tag every response with the public build id. The header is
 * attached for redirects and passthroughs alike so fingerprint stealth
 * applies uniformly — there is no code path that returns a response without
 * this tag.
 */
function tagBuild(res: NextResponse): NextResponse {
  res.headers.set('HomeKeep-Build', getBuildIdPublic());
  return res;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const pbAuth = request.cookies.get('pb_auth')?.value;

  // Presence check only — see module JSDoc.
  const isAuthed = !!pbAuth && pbAuth.length > 10;

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  const isGuestOnly = GUEST_ONLY_PREFIXES.some((p) => pathname.startsWith(p));

  if (isProtected && !isAuthed) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return tagBuild(NextResponse.redirect(loginUrl));
  }

  if (isGuestOnly && isAuthed) {
    return tagBuild(NextResponse.redirect(new URL('/h', request.url)));
  }

  return tagBuild(NextResponse.next());
}

export const config = {
  // Skip static assets, API routes (PB proxy handles those), and PWA icons
  // / manifest (Phase 7 will add the manifest.json; excluding it here is
  // harmless today and saves an edit later).
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|icons|manifest\\.json).*)',
  ],
};
