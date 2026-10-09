// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HouseholdStreakBadge } from '@/components/household-streak-badge';

/**
 * 06-03 Task 2 — HouseholdStreakBadge rendering matrix (D-11, D-16,
 * GAME-01). Covers: streak=0 warm "Fresh week" copy, streak=1 singular,
 * streak=N plural, and an a11y / attribute invariant (the Flame icon is
 * presentational; the visible text is the sole a11y label).
 */
describe('HouseholdStreakBadge', () => {
  it('renders "Fresh week" copy when streak=0 (warm, no shame)', () => {
    const { container } = render(<HouseholdStreakBadge streak={0} />);
    expect(container.textContent).toMatch(/fresh week/i);
    expect(container.textContent).not.toMatch(/0-week/);
    const root = container.querySelector('[data-household-streak-badge]');
    expect(root).toBeTruthy();
    expect(root!.getAttribute('data-streak-count')).toBe('0');
  });

  it('renders "1-week streak" when streak=1 (singular)', () => {
    const { container } = render(<HouseholdStreakBadge streak={1} />);
    expect(container.textContent).toMatch(/1-week streak/i);
    const root = container.querySelector('[data-household-streak-badge]');
    expect(root!.getAttribute('data-streak-count')).toBe('1');
  });

  it('renders "{N}-week streak" when streak >= 2', () => {
    const { container } = render(<HouseholdStreakBadge streak={7} />);
    expect(container.textContent).toMatch(/7-week streak/i);
    const root = container.querySelector('[data-household-streak-badge]');
    expect(root!.getAttribute('data-streak-count')).toBe('7');
  });

  it('Flame icon is presentational (aria-hidden); visible text carries the label', () => {
    const { container } = render(<HouseholdStreakBadge streak={3} />);
    // Lucide icons render as SVG elements. Expect at least one <svg>
    // with aria-hidden (either explicit or via focusable=false+role img
    // omitted). Lucide defaults to aria-hidden="true" for decorative icons.
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThan(0);
    // At least the first SVG should be aria-hidden.
    expect(svgs[0].getAttribute('aria-hidden')).toBe('true');
    // Visible text is present for screen readers.
    expect(screen.getByText(/3-week streak/i)).toBeDefined();
  });
});
