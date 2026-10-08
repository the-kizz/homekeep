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

describe('TaskForm progressive disclosure', () => {
  const openMore = () =>
    fireEvent.click(screen.getByRole('button', { name: /more options/i }));

  test('first screen shows name, area, frequency and who; the rest is collapsed', () => {
    const { container } = render(
      <TaskForm mode="create" homeId="home-1" areas={AREAS} />,
    );
    expect(screen.getByLabelText(/^name$/i)).toBeTruthy();
    expect(screen.getByLabelText(/^area$/i)).toBeTruthy();
    expect(
      screen.getByLabelText(/^frequency$/i, { selector: 'input' }),
    ).toBeTruthy();
    expect(screen.getByTestId('task-assignee-select')).toBeTruthy();

    const more = container.querySelector('[data-more-options]');
    expect(more).toBeTruthy();
    expect(more!.hasAttribute('hidden')).toBe(true);
    // The task-type radios live inside the collapsed section.
    expect(more!.contains(screen.getByLabelText(/^one-off$/i))).toBe(true);
    expect(more!.contains(screen.getByLabelText(/^notes/i))).toBe(true);
  });

  test('frequency chips include daily and every 2 weeks', () => {
    render(<TaskForm mode="create" homeId="home-1" areas={AREAS} />);
    for (const label of [
      'Daily',
      'Weekly',
      'Every 2 weeks',
      'Monthly',
      'Quarterly',
      'Yearly',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Every 2 weeks' }));
    const freq = screen.getByLabelText(/^frequency$/i, {
      selector: 'input',
    }) as HTMLInputElement;
    expect(freq.value).toBe('14');
  });

  test('opening More options then choosing One-off reveals the Do by input', () => {
    const { container } = render(
      <TaskForm mode="create" homeId="home-1" areas={AREAS} />,
    );
    openMore();
    expect(
      container.querySelector('[data-more-options]')!.hasAttribute('hidden'),
    ).toBe(false);
    fireEvent.click(screen.getByLabelText(/^one-off$/i));
    expect(screen.getByLabelText(/^do by/i)).toBeTruthy();
  });

  test('schedule mode carries the plain-English helper', () => {
    render(<TaskForm mode="create" homeId="home-1" areas={AREAS} />);
    openMore();
    expect(
      screen.getByText(
          'Cycle: counts from the last time you did it. Anchored: fixed calendar dates, e.g. "every 1 July".',
      ),
    ).toBeTruthy();
  });

  test('FormData field names are unchanged after expanding', () => {
    const { container } = render(
      <TaskForm mode="create" homeId="home-1" areas={AREAS} />,
    );
    openMore();
    for (const name of [
      'home_id',
      'name',
      'area_id',
      'assigned_to_id',
      'frequency_days',
      'schedule_mode',
      'last_done',
      'active_from_month',
      'active_to_month',
      'notes',
    ]) {
      expect(container.querySelector(`[name="${name}"]`)).toBeTruthy();
    }
    fireEvent.click(screen.getByLabelText(/^one-off$/i));
    expect(container.querySelector('input[name="due_date"]')).toBeTruthy();
  });

  test('collapsed fields still submit (notes are not dropped on save)', () => {
    const { container } = render(
      <TaskForm
        mode="edit"
        homeId="home-1"
        areas={AREAS}
        task={{
          id: 't1',
          home_id: 'home-1',
          area_id: 'area-1',
          name: 'Wipe benches',
          frequency_days: 7,
          schedule_mode: 'cycle',
          anchor_date: null,
          notes: '',
        }}
      />,
    );
    const form = container.querySelector('form')!;
    const fd = new FormData(form);
    expect(fd.get('schedule_mode')).toBe('cycle');
    expect(fd.has('notes')).toBe(true);
    expect(
      container.querySelector('[data-more-options]')!.hasAttribute('hidden'),
    ).toBe(true);
  });

  test('edit mode opens More options when a non-default value is set', () => {
    const { container } = render(
      <TaskForm
        mode="edit"
        homeId="home-1"
        areas={AREAS}
        task={{
          id: 't1',
          home_id: 'home-1',
          area_id: 'area-1',
          name: 'Service heater',
          frequency_days: 365,
          schedule_mode: 'anchored',
          anchor_date: '2026-07-01',
          notes: '',
        }}
      />,
    );
    expect(
      container.querySelector('[data-more-options]')!.hasAttribute('hidden'),
    ).toBe(false);
  });
});
