// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { InsecureContextBanner } from '@/components/insecure-context-banner';

/**
 * 07-01 Task 2 — InsecureContextBanner (D-07, D-08).
 *
 * Five behaviour cases, all driven by stubbing window-level APIs
 * (isSecureContext, matchMedia, localStorage). jsdom defaults
 * `window.isSecureContext` to true — tests override per-case via
 * Object.defineProperty so the banner's client-side effect can read
 * a deterministic value on mount.
 *
 * Per STATE.md 02-02: clear localStorage in beforeEach so PB-adjacent
 * stores + our own `dismissed_insecure_banner` key don't leak between
 * tests.
 */

function stubSecureContext(value: boolean) {
  Object.defineProperty(window, 'isSecureContext', {
    configurable: true,
    get: () => value,
  });
}

function stubStandalone(standalone: boolean) {
  // matchMedia in jsdom defaults to `undefined` on the prototype for
  // media queries we don't register. Provide a deterministic stub.
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (_q: string) => ({
      matches: standalone,
      media: _q,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

describe('InsecureContextBanner', () => {
  beforeEach(() => {
    window.localStorage.clear();
    stubSecureContext(true);
    stubStandalone(false);
    cleanup();
  });

  it('renders with "You\'re on HTTP" copy when on HTTP and not dismissed', () => {
    stubSecureContext(false);
    render(<InsecureContextBanner />);
    expect(screen.getByText(/You're on HTTP/i)).toBeInTheDocument();
    // v1.2.1 PATCH2-04: "Learn more" link removed — it pointed at
    // `/deployment`, a route that does not exist, producing 9+ console
    // 404s per HTTP session (Next.js prefetches RSC on hydration).
    expect(screen.queryByRole('link', { name: /Learn more/i })).not.toBeInTheDocument();
  });

  it('does NOT render when on HTTPS (isSecureContext=true)', () => {
    stubSecureContext(true);
    render(<InsecureContextBanner />);
    expect(screen.queryByText(/You're on HTTP/i)).not.toBeInTheDocument();
  });

  it('does NOT render when previously dismissed (localStorage persists)', () => {
    stubSecureContext(false);
    window.localStorage.setItem('dismissed_insecure_banner', 'true');
    render(<InsecureContextBanner />);
    expect(screen.queryByText(/You're on HTTP/i)).not.toBeInTheDocument();
  });

  it('dismiss button writes localStorage + unmounts banner', () => {
    stubSecureContext(false);
    render(<InsecureContextBanner />);
    expect(screen.getByText(/You're on HTTP/i)).toBeInTheDocument();

    const dismiss = screen.getByRole('button', { name: /dismiss/i });
    fireEvent.click(dismiss);

    expect(window.localStorage.getItem('dismissed_insecure_banner')).toBe('true');
    expect(screen.queryByText(/You're on HTTP/i)).not.toBeInTheDocument();
  });

  it('does NOT render when in standalone mode (installed PWA — no HTTP install path to nag about)', () => {
    stubSecureContext(false);
    stubStandalone(true);
    render(<InsecureContextBanner />);
    expect(screen.queryByText(/You're on HTTP/i)).not.toBeInTheDocument();
  });
});
