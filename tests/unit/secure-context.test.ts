// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isSecureContext, isStandaloneMode } from '@/lib/secure-context';

/**
 * 07-01 Task 1 — lib/secure-context.ts + PWA manifest shape (TDD RED).
 *
 * Seven cases covering the pure detection helpers + a manifest-integrity
 * check that the static public/manifest.webmanifest matches CONTEXT D-01
 * (name, start_url, display, colors, icon set).
 *
 * The helpers are deliberately SSR-safe: `isSecureContext(undefined)`
 * fails OPEN (returns true) so the HTTP banner never flashes during
 * server render on an HTTPS deploy — the client then reads the real
 * `window.isSecureContext` during hydration and flips the banner on if
 * needed. This is the only "safe" default: false-positives (briefly
 * hiding the banner) are preferable to false-negatives (flashing a
 * scary banner on every HTTPS request).
 */

describe('isSecureContext', () => {
  it('returns true when window is undefined (SSR fail-open)', () => {
    expect(isSecureContext(undefined)).toBe(true);
  });

  it('returns false when window.isSecureContext is false (HTTP)', () => {
    expect(isSecureContext({ isSecureContext: false })).toBe(false);
  });

  it('returns true when window.isSecureContext is true (HTTPS)', () => {
    expect(isSecureContext({ isSecureContext: true })).toBe(true);
  });
});

describe('isStandaloneMode', () => {
  it('returns true when matchMedia(display-mode: standalone) matches', () => {
    const win = {
      matchMedia: () => ({ matches: true }),
      navigator: {},
    } as unknown as Window;
    expect(isStandaloneMode(win)).toBe(true);
  });

  it('returns true when navigator.standalone is true (iOS Safari quirk)', () => {
    const win = {
      matchMedia: () => ({ matches: false }),
      navigator: { standalone: true },
    } as unknown as Window;
    expect(isStandaloneMode(win)).toBe(true);
  });

  it('returns false when neither signal is present', () => {
    const win = {
      matchMedia: () => ({ matches: false }),
      navigator: {},
    } as unknown as Window;
    expect(isStandaloneMode(win)).toBe(false);
  });
});

describe('public/manifest.webmanifest (D-01 shape)', () => {
  it('is valid JSON with all HomeKeep PWA fields + 3 icons (192, 512, 512-maskable)', () => {
    const path = join(process.cwd(), 'public/manifest.webmanifest');
    const raw = readFileSync(path, 'utf-8');
    const json = JSON.parse(raw) as {
      name: string;
      short_name: string;
      start_url: string;
      display: string;
      background_color: string;
      theme_color: string;
      icons: { src: string; sizes: string; type: string; purpose?: string }[];
    };

    expect(json.name).toBe('HomeKeep');
    expect(json.short_name).toBe('HomeKeep');
    expect(json.start_url).toBe('/');
    expect(json.display).toBe('standalone');
    expect(json.background_color).toBe('#F5EEE0');
    expect(json.theme_color).toBe('#D4A574');

    expect(Array.isArray(json.icons)).toBe(true);
    expect(json.icons).toHaveLength(3);

    const sizes = json.icons.map((i) => i.sizes).sort();
    expect(sizes).toEqual(['192x192', '512x512', '512x512']);

    const maskable = json.icons.find((i) => i.purpose === 'maskable');
    expect(maskable).toBeDefined();
    expect(maskable!.sizes).toBe('512x512');
    expect(maskable!.src).toBe('/icons/icon-512-maskable.png');

    // All icon srcs are rooted at /icons/
    for (const icon of json.icons) {
      expect(icon.src.startsWith('/icons/')).toBe(true);
      expect(icon.type).toBe('image/png');
    }
  });
});
