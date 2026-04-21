'use client';

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { isSecureContext, isStandaloneMode } from '@/lib/secure-context';

/**
 * 07-01 (D-07, D-08) — Dismissible warm banner shown on HTTP deploys.
 *
 * Degrades the PWA experience gracefully rather than blocking: the app
 * still works over HTTP, but install-to-home-screen and offline support
 * both require HTTPS (browser-enforced), so we explain this in a calm,
 * dismissible banner. Copy from D-07: "You're on HTTP — install-to-
 * home-screen and offline support require HTTPS."
 *
 * Decision-tree for visibility (all three must hold for the banner to show):
 *   1. window.isSecureContext is false (we're on HTTP).
 *   2. User has NOT previously dismissed (localStorage flag absent).
 *   3. User is NOT in standalone mode (D-08: installed PWAs never see
 *      this nag — by definition they installed over HTTPS, and even in
 *      the edge case of a dev shim, there's no install path to suggest).
 *
 * Rendering pattern: `useSyncExternalStore` with a `getServerSnapshot`
 * of `false` — on the server the banner is always `null`, avoiding SSR
 * flash on HTTPS deploys. On the client the subscribe/getSnapshot pair
 * runs during hydration and reads window.isSecureContext synchronously.
 * This satisfies the React 19 `react-hooks/set-state-in-effect` rule
 * (no setState-in-effect; the store is the single source of truth).
 *
 * A separate `dismissed` `useState` tracks the ephemeral click-to-hide:
 * on click we persist to localStorage (so reload respects it) AND flip
 * state immediately (so the current render unmounts without waiting
 * for a store re-subscription).
 */

const STORAGE_KEY = 'dismissed_insecure_banner';

/** No-op subscribe — visibility never changes after hydration (dismissal
 * uses a local useState below, not the external store). The subscribe
 * contract requires a function even when there's nothing to observe. */
function subscribe(): () => void {
  return () => {};
}

/** Client snapshot: returns `true` when the HTTP banner should show. */
function getClientSnapshot(): boolean {
  if (typeof window === 'undefined') return false;
  if (isSecureContext(window)) return false;
  if (isStandaloneMode(window)) return false;
  if (window.localStorage.getItem(STORAGE_KEY) === 'true') return false;
  return true;
}

/** Server snapshot: always false — never render the banner during SSR
 * (fail-OPEN on unknown secure-context — matches lib/secure-context.ts). */
function getServerSnapshot(): boolean {
  return false;
}

export function InsecureContextBanner() {
  const shouldShow = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );
  const [dismissed, setDismissed] = useState(false);

  if (!shouldShow || dismissed) return null;

  return (
    <div
      role="status"
      data-testid="insecure-context-banner"
      className="bg-accent text-accent-foreground border-b border-border px-4 py-3 text-sm flex items-center justify-between gap-3"
    >
      <p className="flex-1">
        You&apos;re on HTTP — install-to-home-screen and offline support require HTTPS.{' '}
        <Link
          href="/deployment"
          className="underline underline-offset-4 font-medium"
        >
          Learn more
        </Link>
      </p>
      <button
        type="button"
        className="rounded-md px-2 py-1 text-sm hover:bg-background/50"
        onClick={() => {
          window.localStorage.setItem(STORAGE_KEY, 'true');
          setDismissed(true);
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
