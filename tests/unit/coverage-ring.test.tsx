// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CoverageRing } from '@/components/coverage-ring';

/**
 * 03-02 Task 1 component tests for CoverageRing.
 * Covers: aria-label, clamp low/high, rounding, dashoffset math.
 */
describe('CoverageRing', () => {
  it('renders role=img with aria-label reflecting the rounded percentage', () => {
    render(<CoverageRing percentage={73} />);
    expect(screen.getByRole('img', { name: /coverage 73%/i })).toBeDefined();
  });

  it('clamps negative values to 0', () => {
    render(<CoverageRing percentage={-10} />);
    expect(screen.getByRole('img', { name: /coverage 0%/i })).toBeDefined();
  });

  it('clamps values above 100 to 100', () => {
    render(<CoverageRing percentage={150} />);
    expect(screen.getByRole('img', { name: /coverage 100%/i })).toBeDefined();
  });

  it('rounds fractional percentages and renders the integer in the center', () => {
    render(<CoverageRing percentage={42.6} />);
    expect(screen.getByText('43%')).toBeDefined();
  });

  it('sets stroke-dashoffset = 100 - clamped on the progress circle', () => {
    const { container } = render(<CoverageRing percentage={60} />);
    const progress = container.querySelectorAll('circle')[1];
    expect(progress).toBeDefined();
    expect(progress!.getAttribute('stroke-dashoffset')).toBe('40');
  });

  it('renders 0% as stroke-dashoffset=100 (empty ring)', () => {
    const { container } = render(<CoverageRing percentage={0} />);
    const progress = container.querySelectorAll('circle')[1];
    expect(progress!.getAttribute('stroke-dashoffset')).toBe('100');
  });

  it('renders 100% as stroke-dashoffset=0 (full ring)', () => {
    const { container } = render(<CoverageRing percentage={100} />);
    const progress = container.querySelectorAll('circle')[1];
    expect(progress!.getAttribute('stroke-dashoffset')).toBe('0');
  });
});
