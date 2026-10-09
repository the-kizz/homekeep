// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep

/**
 * ThemeToggle is the account menu's "Appearance" section: a Theme row
 * (Notebook / Bold) and a Mode row (System / Light / Dark). next-themes is
 * mocked with a tiny store so the test exercises the component, not
 * matchMedia; the palette goes through the real PaletteProvider.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

let store: { theme: string | undefined; listeners: Set<() => void> } = {
  theme: undefined,
  listeners: new Set(),
};

vi.mock('next-themes', () => ({
  useTheme: () => {
    const [, force] = useState(0);
    store.listeners.add(() => force((n) => n + 1));
    return {
      theme: store.theme,
      setTheme: (t: string) => {
        store.theme = t;
        store.listeners.forEach((l) => l());
      },
    };
  },
}));

import { ThemeToggle } from '@/components/theme-toggle';
import { PaletteProvider } from '@/components/theme-provider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function clearCookie() {
  document.cookie = 'hk_palette=; path=/; max-age=0';
}

function renderOpenMenu() {
  const utils = render(
    <PaletteProvider>
      <DropdownMenu open>
        <DropdownMenuTrigger>Account</DropdownMenuTrigger>
        <DropdownMenuContent>
          <ThemeToggle />
        </DropdownMenuContent>
      </DropdownMenu>
    </PaletteProvider>,
  );
  return utils;
}

const option = (name: string) => screen.getByRole('menuitemradio', { name });

describe('ThemeToggle', () => {
  beforeEach(() => {
    store = { theme: undefined, listeners: new Set() };
    window.localStorage.clear();
    clearCookie();
    document.documentElement.removeAttribute('data-palette');
  });

  it('labels the section Appearance and marks System and Bold before anything is chosen', () => {
    renderOpenMenu();
    expect(screen.getByText('Appearance')).toBeTruthy();
    expect(
      document.querySelector('[data-theme-toggle]')!.getAttribute('data-theme-current'),
    ).toBe('system');
    expect(option('System').getAttribute('aria-checked')).toBe('true');
    expect(option('Bold').getAttribute('aria-checked')).toBe('true');
    expect(option('Notebook').getAttribute('aria-checked')).toBe('false');
  });

  it('sets the mode from the Mode row', () => {
    renderOpenMenu();
    act(() => {
      fireEvent.click(option('Dark'));
    });
    expect(store.theme).toBe('dark');
    expect(option('Dark').getAttribute('aria-checked')).toBe('true');
    act(() => {
      fireEvent.click(option('Light'));
    });
    expect(store.theme).toBe('light');
  });

  it('switches the palette and writes the attribute, localStorage and the cookie', () => {
    renderOpenMenu();
    act(() => {
      fireEvent.click(option('Notebook'));
    });
    expect(option('Notebook').getAttribute('aria-checked')).toBe('true');
    expect(document.documentElement.getAttribute('data-palette')).toBe('notebook');
    expect(window.localStorage.getItem('hk_palette')).toBe('notebook');
    expect(document.cookie).toContain('hk_palette=notebook');

    act(() => {
      fireEvent.click(option('Bold'));
    });
    expect(document.documentElement.getAttribute('data-palette')).toBe('bold');
    expect(window.localStorage.getItem('hk_palette')).toBe('bold');
    expect(document.cookie).toContain('hk_palette=bold');
  });
});
