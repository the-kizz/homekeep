// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep

/**
 * PaletteProvider: the server-read cookie seeds the palette; when the
 * cookie is missing, a choice remembered in localStorage is restored and
 * the cookie rewritten; storage that throws never breaks rendering.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { PaletteProvider, usePalette } from '@/components/theme-provider';
import { parsePalette } from '@/lib/palette';

function Probe() {
  const { palette, setPalette } = usePalette();
  return (
    <button type="button" onClick={() => setPalette(palette === 'bold' ? 'notebook' : 'bold')}>
      {palette}
    </button>
  );
}

function clearCookie() {
  document.cookie = 'hk_palette=; path=/; max-age=0';
}

describe('PaletteProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearCookie();
    document.documentElement.removeAttribute('data-palette');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts in bold when there is no server palette, cookie or stored choice', () => {
    render(
      <PaletteProvider>
        <Probe />
      </PaletteProvider>,
    );
    expect(screen.getByRole('button').textContent).toBe('bold');
  });

  it('starts from the server palette (the cookie value)', () => {
    document.cookie = 'hk_palette=bold; path=/';
    render(
      <PaletteProvider initialPalette="bold">
        <Probe />
      </PaletteProvider>,
    );
    expect(screen.getByRole('button').textContent).toBe('bold');
  });

  it('restores a localStorage choice when the cookie is missing, and rewrites the cookie', () => {
    window.localStorage.setItem('hk_palette', 'bold');
    render(
      <PaletteProvider initialPalette="notebook">
        <Probe />
      </PaletteProvider>,
    );
    expect(screen.getByRole('button').textContent).toBe('bold');
    expect(document.documentElement.getAttribute('data-palette')).toBe('bold');
    expect(document.cookie).toContain('hk_palette=bold');
  });

  it('keeps the cookie value over localStorage when both exist', () => {
    document.cookie = 'hk_palette=notebook; path=/';
    window.localStorage.setItem('hk_palette', 'bold');
    render(
      <PaletteProvider initialPalette="notebook">
        <Probe />
      </PaletteProvider>,
    );
    expect(screen.getByRole('button').textContent).toBe('notebook');
  });

  it('still switches when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(
      <PaletteProvider initialPalette="notebook">
        <Probe />
      </PaletteProvider>,
    );
    act(() => {
      screen.getByRole('button').click();
    });
    expect(screen.getByRole('button').textContent).toBe('bold');
    expect(document.documentElement.getAttribute('data-palette')).toBe('bold');
    expect(document.cookie).toContain('hk_palette=bold');
  });

  it('parsePalette falls back to bold for unknown values', () => {
    expect(parsePalette('notebook')).toBe('notebook');
    expect(parsePalette('neon')).toBe('bold');
    expect(parsePalette(undefined)).toBe('bold');
  });
});
