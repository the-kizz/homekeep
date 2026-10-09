// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep

/**
 * Phase 16 Plan 01 Task 2 — ShiftBadge component tests (RED gate).
 *
 * Covers D-05 (balance icon + title attr) + LVIZ-03 (badge render shape).
 */

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ShiftBadge } from '@/components/shift-badge';

describe('ShiftBadge', () => {
  const idealDate = new Date('2026-04-24T00:00:00Z');
  const scheduledDate = new Date('2026-04-27T00:00:00Z');
  const timezone = 'Australia/Perth';

  it('renders the balance-scale icon, not an emoji', () => {
    const { container } = render(
      <ShiftBadge
        idealDate={idealDate}
        scheduledDate={scheduledDate}
        timezone={timezone}
      />,
    );
    expect(container.querySelector('[data-shift-badge] svg')).toBeTruthy();
    expect(container.textContent).not.toContain('⚖️');
  });

  it('carries aria-label="Moved to balance the month" and a title attribute containing both dates', () => {
    const { container } = render(
      <ShiftBadge
        idealDate={idealDate}
        scheduledDate={scheduledDate}
        timezone={timezone}
      />,
    );
    const el = container.querySelector('[data-shift-badge]');
    expect(el).toBeTruthy();
    expect(el!.getAttribute('aria-label')).toBe('Moved to balance the month');
    const title = el!.getAttribute('title') ?? '';
    expect(title).toContain('Shifted from');
    // "Apr 24" in Australia/Perth formatting.
    expect(title).toContain('Apr 24');
    expect(title).toContain('Apr 27');
  });

  it('exposes data-shift-badge attribute for grep-friendly E2E hooks', () => {
    const { container } = render(
      <ShiftBadge
        idealDate={idealDate}
        scheduledDate={scheduledDate}
        timezone={timezone}
      />,
    );
    expect(container.querySelector('[data-shift-badge]')).toBeTruthy();
  });
});
