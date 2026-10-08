// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep

/**
 * ThemeToggle cycles system → light → dark → system and labels the
 * current choice. next-themes is mocked with a tiny store so the test
 * exercises the component, not localStorage or matchMedia.
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function renderOpenMenu() {
  return render(
    <DropdownMenu open>
      <DropdownMenuTrigger>Account</DropdownMenuTrigger>
      <DropdownMenuContent>
        <ThemeToggle />
      </DropdownMenuContent>
    </DropdownMenu>,
  );
}

describe('ThemeToggle', () => {
  beforeEach(() => {
    store = { theme: undefined, listeners: new Set() };
  });

  it('shows Appearance: System before a theme is chosen', () => {
    renderOpenMenu();
    expect(screen.getByText('Appearance: System')).toBeTruthy();
  });

  it('cycles System → Light → Dark → System on each select', () => {
    renderOpenMenu();
    const item = () => screen.getByRole('menuitem');
    act(() => {
      fireEvent.click(item());
    });
    expect(screen.getByText('Appearance: Light')).toBeTruthy();
    expect(store.theme).toBe('light');
    act(() => {
      fireEvent.click(item());
    });
    expect(screen.getByText('Appearance: Dark')).toBeTruthy();
    act(() => {
      fireEvent.click(item());
    });
    expect(screen.getByText('Appearance: System')).toBeTruthy();
    expect(store.theme).toBe('system');
  });
});
