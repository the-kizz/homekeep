import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

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
 */

// Routes that require auth. Everything under `/h` and `/settings` is protected.
const PROTECTED_PREFIXES = ['/h', '/settings'];

// Routes that should redirect to /h if already authed.
const GUEST_ONLY_PREFIXES = ['/login', '/signup', '/reset-password'];

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
    return NextResponse.redirect(loginUrl);
  }

  if (isGuestOnly && isAuthed) {
    return NextResponse.redirect(new URL('/h', request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Skip static assets, API routes (PB proxy handles those), and PWA icons
  // / manifest (Phase 7 will add the manifest.json; excluding it here is
  // harmless today and saves an edit later).
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|icons|manifest\\.json).*)',
  ],
};
