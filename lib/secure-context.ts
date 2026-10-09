/**
 * 07-01 (D-06) — Secure-context + standalone detection.
 *
 * Two pure helpers that wrap the browser's built-in signals so UI can
 * degrade gracefully on HTTP deployments (INFR-07) without ever reading
 * `window` at module scope (SSR-safe).
 *
 * `isSecureContext(win)`:
 *   - Returns `win.isSecureContext` when a window-like object is given.
 *   - Returns `true` when `win === undefined` (SSR fail-OPEN). Rationale:
 *     on an HTTPS deploy, the server never has access to `window`, so
 *     rendering `true` avoids flashing a scary HTTP-only banner during
 *     the server pass. The client hydration then reads the real value.
 *     The worst case is a sub-millisecond delay before the banner
 *     appears on an actual HTTP client — acceptable and warm.
 *
 * `isStandaloneMode(win)`:
 *   - Returns `true` if `matchMedia('(display-mode: standalone)').matches`
 *     (Chrome, Firefox, Edge, Safari 17+).
 *   - Also returns `true` if `navigator.standalone === true` (iOS Safari
 *     non-standard — the only way to detect a home-screen install on
 *     iOS 16 and earlier).
 *   - Returns `false` otherwise (browser tab, SSR).
 */

export type SecureContextWindow = Pick<Window, 'isSecureContext'>;

export function isSecureContext(win: SecureContextWindow | undefined): boolean {
  if (!win) return true;
  return win.isSecureContext;
}

export function isStandaloneMode(win: Window | undefined): boolean {
  if (!win) return false;
  if (win.matchMedia?.('(display-mode: standalone)').matches) return true;
  // iOS Safari non-standard: navigator.standalone is not in the
  // TypeScript Navigator type, so narrow via a local intersection.
  const nav = win.navigator as Navigator & { standalone?: boolean };
  return nav?.standalone === true;
}
