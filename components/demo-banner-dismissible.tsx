'use client';

// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/conroyke56/homekeep

/**
 * Phase 26 DEMO-04 — client leaf of the demo banner.
 *
 * Isolated in its own file so the server-component wrapper can gate
 * on DEMO_MODE and ship zero bytes to personal instances. On demo
 * instances, this leaf mounts and reads localStorage via the
 * useSyncExternalStore + getServerSnapshot=false pattern borrowed
 * from insecure-context-banner.tsx (07-01 D-07, D-08 — same SSR-flash
 * avoidance rationale).
 *
 * Dismissal is per-browser, persisted to localStorage. The banner
 * stays hidden until a user wipes localStorage OR the key is manually
 * cleared. This is deliberate: demo users are anonymous, can re-mint
 * a fresh session at will, and don't benefit from per-visitor dismissal
 * state.
 */

import { useState, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'dismissed_demo_banner';

function subscribe(): () => void {
  return () => {};
}

function getClientSnapshot(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.localStorage.getItem(STORAGE_KEY) === 'true') return false;
  return true;
}

function getServerSnapshot(): boolean {
  // Render on SSR too — unlike insecure-context-banner (which is false on
  // SSR to avoid HTTPS flash), the demo-banner SHOULD show on first paint.
  // A demo visitor seeing the banner for the briefest moment before a
  // possible dismiss-hydration is the correct UX. If the banner has been
  // dismissed on a previous visit, getClientSnapshot corrects this on
  // hydration via a single re-render.
  return true;
}

export function DemoBannerDismissible() {
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
      aria-live="polite"
      data-testid="demo-banner"
      className="sticky top-0 z-50 w-full bg-amber-100 text-amber-950 border-b-2 border-amber-400 px-4 py-3 text-sm flex items-center justify-between gap-3 shadow-sm"
    >
      <p className="flex-1 font-medium">
        <span aria-hidden="true" className="mr-2">🧪</span>
        Demo instance — data resets every 2 hours and after 24 hours. Do not
        enter real personal information.
      </p>
      <button
        type="button"
        aria-label="Dismiss demo banner"
        className="rounded-md px-2 py-1 text-sm hover:bg-amber-200 font-medium"
        onClick={() => {
          if (typeof window !== 'undefined') {
            window.localStorage.setItem(STORAGE_KEY, 'true');
          }
          setDismissed(true);
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
