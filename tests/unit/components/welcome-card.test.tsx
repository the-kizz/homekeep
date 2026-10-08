// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep

/**
 * WelcomeCard — first-run explainer above the dashboard bands.
 * Shown when ?welcome=1 is present or this browser has never dismissed
 * it for the home; "Got it" persists the dismissal and strips the param.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const replace = vi.fn();
let params = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => params,
  usePathname: () => '/h/home-1',
}));

import { WelcomeCard } from '@/components/welcome-card';

const KEY = 'hk:welcomed:home-1';

describe('WelcomeCard', () => {
  beforeEach(() => {
    window.localStorage.clear();
    replace.mockClear();
    params = new URLSearchParams();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  test('renders when ?welcome=1 is present, even if dismissed before', () => {
    window.localStorage.setItem(KEY, '1');
    params = new URLSearchParams('welcome=1');
    render(<WelcomeCard homeId="home-1" />);
    const region = screen.getByRole('region', { name: 'Welcome' });
    expect(region.textContent).toContain(
      'Overdue — things that slipped, no judgement.',
    );
    expect(region.textContent).toContain(
      "This week — what's coming up next.",
    );
    expect(region.textContent).toContain(
      'Horizon — the year at a glance; a stronger tint means a busier month.',
    );
    const invite = screen.getByRole('link', { name: 'Invite someone' });
    expect(invite.getAttribute('href')).toBe('/h/home-1/settings');
  });

  test('renders on a first visit with no stored key', () => {
    render(<WelcomeCard homeId="home-1" />);
    expect(screen.getByRole('region', { name: 'Welcome' })).toBeTruthy();
  });

  test('"Got it" hides the card, writes the key and strips the param', () => {
    params = new URLSearchParams('welcome=1&x=2');
    render(<WelcomeCard homeId="home-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('region', { name: 'Welcome' })).toBeNull();
    expect(window.localStorage.getItem(KEY)).not.toBeNull();
    expect(replace).toHaveBeenCalledWith('/h/home-1?x=2', { scroll: false });
  });

  test('not rendered when the key exists and there is no param', () => {
    window.localStorage.setItem(KEY, '1');
    render(<WelcomeCard homeId="home-1" />);
    expect(screen.queryByRole('region', { name: 'Welcome' })).toBeNull();
  });

  test('renders and dismisses cleanly when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<WelcomeCard homeId="home-1" />);
    expect(screen.getByRole('region', { name: 'Welcome' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('region', { name: 'Welcome' })).toBeNull();
  });
});
