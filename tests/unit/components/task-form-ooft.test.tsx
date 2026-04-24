// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep

/**
 * Phase 15 Plan 02 (OOFT-04, D-01, D-02, D-03) — task-form OOFT toggle
 * tests.
 *
 * Locks the Recurring/One-off toggle behavior:
 *   (1) Default task_type = "Recurring" (radio checked).
 *   (2) Selecting "One-off" hides the frequency input + shows the
 *       due_date input (required semantics).
 *   (3) Selecting "One-off" removes the Anchored radio from the DOM
 *       (D-02: one-off + anchored incompatible; hidden entirely).
 *   (4) Switching back to Recurring restores the frequency input and
 *       hides the due_date input.
 */

import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaskForm } from '@/components/forms/task-form';

// Next.js useRouter — the form's useEffect on success calls
// router.refresh(). Stub it so render doesn't crash in jsdom.
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
  }),
}));

// Server actions are imported by TaskForm; stub so the form's
// useActionState binding doesn't trigger network calls in render.
vi.mock('@/lib/actions/tasks', () => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
}));

const AREAS = [
  { id: 'area-1', name: 'Kitchen' },
  { id: 'area-2', name: 'Bathroom' },
];

describe('TaskForm OOFT toggle (Phase 15 OOFT-04, D-01..D-03)', () => {
  test('renders with default task_type = "Recurring" checked', () => {
    render(<TaskForm mode="create" homeId="home-1" areas={AREAS} />);

    const recurring = screen.getByLabelText(/^recurring$/i) as HTMLInputElement;
    const oneOff = screen.getByLabelText(/^one-off$/i) as HTMLInputElement;

    expect(recurring).toBeTruthy();
    expect(oneOff).toBeTruthy();
    expect(recurring.checked).toBe(true);
    expect(oneOff.checked).toBe(false);
  });

  test('selecting "One-off" hides frequency input and shows due_date input', () => {
    render(<TaskForm mode="create" homeId="home-1" areas={AREAS} />);

    // Baseline: frequency input is visible, due_date is not.
    expect(screen.queryByLabelText(/^do by/i)).toBeNull();
    expect(screen.getByLabelText(/^frequency$/i, { selector: 'input' })).toBeTruthy();

    // Flip to One-off.
    fireEvent.click(screen.getByLabelText(/^one-off$/i));

    // After flip: due_date input present, frequency input gone.
    expect(screen.getByLabelText(/^do by/i)).toBeTruthy();
    expect(
      screen.queryByLabelText(/^frequency$/i, { selector: 'input' }),
    ).toBeNull();
  });

  test('selecting "One-off" removes the Anchored radio from the DOM (D-02)', () => {
    render(<TaskForm mode="create" homeId="home-1" areas={AREAS} />);

    // Baseline: anchored radio present.
    expect(screen.queryByLabelText(/anchored/i)).toBeTruthy();

    fireEvent.click(screen.getByLabelText(/^one-off$/i));

    // After flip: anchored radio is NOT in the DOM.
    expect(screen.queryByLabelText(/anchored/i)).toBeNull();
  });

  test('switching back to Recurring restores frequency input and hides due_date', () => {
    render(<TaskForm mode="create" homeId="home-1" areas={AREAS} />);

    fireEvent.click(screen.getByLabelText(/^one-off$/i));
    // due_date visible now
    expect(screen.getByLabelText(/^do by/i)).toBeTruthy();

    fireEvent.click(screen.getByLabelText(/^recurring$/i));

    // After revert: frequency input back, due_date gone.
    expect(screen.getByLabelText(/^frequency$/i, { selector: 'input' })).toBeTruthy();
    expect(screen.queryByLabelText(/^do by/i)).toBeNull();
  });
});
