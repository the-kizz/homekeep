// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep

/**
 * app/layout.tsx reads the hk_palette cookie on the server and renders it
 * as data-palette on <html>, so the first paint is already in the chosen
 * palette. cookies() is mocked; fonts are stubbed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

let cookieValue: string | undefined;

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'hk_palette' && cookieValue !== undefined
        ? { name, value: cookieValue }
        : undefined,
  }),
}));
vi.mock('next/font/google', () => ({
  Geist: () => ({ variable: 'font-geist' }),
  Lora: () => ({ variable: 'font-lora' }),
}));
vi.mock('@/components/demo-banner', () => ({ DemoBanner: () => null }));
vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null }));

import RootLayout from '@/app/layout';

async function htmlProps() {
  const el = (await RootLayout({ children: null })) as ReactElement<Record<string, unknown>>;
  expect(el.type).toBe('html');
  return el.props;
}

describe('RootLayout palette attribute', () => {
  beforeEach(() => {
    cookieValue = undefined;
  });

  it('defaults to bold without a cookie', async () => {
    expect((await htmlProps())['data-palette']).toBe('bold');
  });

  it('uses the cookie value', async () => {
    cookieValue = 'notebook';
    expect((await htmlProps())['data-palette']).toBe('notebook');
  });

  it('ignores an unknown cookie value', async () => {
    cookieValue = 'neon';
    expect((await htmlProps())['data-palette']).toBe('bold');
  });
});
