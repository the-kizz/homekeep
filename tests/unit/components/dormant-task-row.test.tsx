// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep

/**
 * Phase 14 Plan 02 (SEAS-06, D-07, D-08) — DormantTaskRow render tests.
 *
 * Locks the LOAD-BEARING contract between classifyDormantTasks and the
 * presentational component:
 *   - "Sleeps until MMM yyyy" badge literal prefix + date-fns-tz format.
 *   - opacity-50 dim class.
 *   - data-dormant="true" + data-task-id data attrs (future E2E hooks).
 *   - No onComplete prop; the click is a silent no-op (D-08).
 */

import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { DormantTaskRow } from '@/components/dormant-task-row';

// Perth midnight Oct 1 2026 as a UTC instant = Sep 30 16:00 UTC.
const NEXT_OPEN_OCT_2026 = new Date('2026-09-30T16:00:00.000Z');
const PERTH = 'Australia/Perth';

describe('DormantTaskRow (Phase 14 SEAS-06)', () => {
  it('renders exact "Sleeps until Oct 2026" badge text for Oct-1-Perth wake-up', () => {
    const { getByText } = render(
      <DormantTaskRow
        task={{
          id: 't1',
          name: 'Mow lawn (warm)',
          nextOpenDate: NEXT_OPEN_OCT_2026,
        }}
        timezone={PERTH}
      />,
    );
    expect(getByText('Sleeps until Oct 2026')).toBeTruthy();
  });

  it('container has opacity-50 dim class', () => {
    const { container } = render(
      <DormantTaskRow
        task={{
          id: 't1',
          name: 'Mow',
          nextOpenDate: NEXT_OPEN_OCT_2026,
        }}
        timezone={PERTH}
      />,
    );
    const root = container.querySelector('[data-dormant="true"]');
    expect(root).toBeTruthy();
    expect(root!.className).toContain('opacity-50');
  });

  it('carries data-task-id + data-dormant + data-next-open-iso attributes', () => {
    const { container } = render(
      <DormantTaskRow
        task={{
          id: 't-abc',
          name: 'Service AC',
          nextOpenDate: NEXT_OPEN_OCT_2026,
        }}
        timezone={PERTH}
      />,
    );
    const root = container.querySelector('[data-task-id="t-abc"]');
    expect(root).toBeTruthy();
    expect(root!.getAttribute('data-dormant')).toBe('true');
    expect(root!.getAttribute('data-next-open-iso')).toBe(
      NEXT_OPEN_OCT_2026.toISOString(),
    );
    expect(root!.getAttribute('aria-disabled')).toBe('true');
  });

  it('click is a silent no-op — component accepts no onComplete prop', () => {
    // Documents D-08: the component has no onComplete prop (no way to wire
    // a completion from this surface). Clicking the row must not throw.
    const { container } = render(
      <DormantTaskRow
        task={{
          id: 't1',
          name: 'Mow',
          nextOpenDate: NEXT_OPEN_OCT_2026,
        }}
        timezone={PERTH}
      />,
    );
    const root = container.querySelector('[data-task-id="t1"]');
    expect(root).toBeTruthy();
    // No throw — silent no-op.
    expect(() => fireEvent.click(root!)).not.toThrow();
  });
});
