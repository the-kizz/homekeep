// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep

/**
 * Phase 26 DEMO-04 — demo-mode warning banner (D-10, D-11, D-12).
 *
 * Server component that returns null unless process.env.DEMO_MODE === 'true'.
 * When active, renders an amber-bg fixed warning banner above main content
 * with a client-side dismiss button backed by localStorage.
 *
 * The server-component outer wrapper lets us short-circuit render when
 * DEMO_MODE is unset — zero bytes shipped to the client on personal
 * instances. The client-component dismiss button is a tiny leaf that
 * ONLY renders when the banner is active.
 *
 * Copy (D-11): "Demo instance — data resets every 2 hours and after 24
 * hours. Do not enter real personal information."
 *
 * Visibility:
 *   - Personal instance (DEMO_MODE unset/false): null — dead-code.
 *   - Demo instance, never dismissed: visible, top of every page.
 *   - Demo instance, dismissed: hidden until browser session storage clears
 *     (user reloads tab, or localStorage wiped). Dismissal is per-browser,
 *     not per-visitor-account (demo users are ephemeral — we can't use
 *     server-side state).
 */

import { DemoBannerDismissible } from './demo-banner-dismissible';

export function DemoBanner() {
  if (process.env.DEMO_MODE !== 'true') {
    return null;
  }
  return <DemoBannerDismissible />;
}
