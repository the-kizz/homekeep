// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep

/**
 * Phase 15 Plan 02 (OOFT-04, D-01, D-02, D-03) — task-form OOFT toggle
 * tests.
 *
 * Locks the Recurring/One-off toggle behavior (a two-button segmented
 * control above Frequency, always visible):
 *   (1) Default task_type = "Recurring" (pressed).
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

const typeButton = (name: 'Recurring' | 'One-off') =>
  screen.getByRole('button', { name }) as HTMLButtonElement;

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
  test('renders with default task_type = "Recurring" pressed', () => {
    render(<TaskForm mode="create" homeId="home-1" areas={AREAS} />);

    expect(typeButton('Recurring').getAttribute('aria-pressed')).toBe('true');
    expect(typeButton('One-off').getAttribute('aria-pressed')).toBe('false');
    expect(typeButton('One-off').type).toBe('button');
  });

  test('the switch sits directly above Frequency, outside More options', () => {
    const { container } = render(
      <TaskForm mode="create" homeId="home-1" areas={AREAS} />,
    );
    const toggle = container.querySelector('[data-task-type-toggle]')!;
    const more = container.querySelector('[data-more-options]')!;
    expect(more.contains(toggle)).toBe(false);
    const freq = screen.getByLabelText(/^frequency$/i, { selector: 'input' });
    expect(
      toggle.compareDocumentPosition(freq) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(toggle.nextElementSibling!.contains(freq)).toBe(true);
  });

  test('selecting "One-off" hides frequency input and shows due_date input', () => {
    render(<TaskForm mode="create" homeId="home-1" areas={AREAS} />);

    // Baseline: frequency input is visible, due_date is not.
    expect(screen.queryByLabelText(/^do by/i)).toBeNull();
    expect(screen.getByLabelText(/^frequency$/i, { selector: 'input' })).toBeTruthy();

    // Flip to One-off.
    fireEvent.click(typeButton('One-off'));

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

    fireEvent.click(typeButton('One-off'));

    // After flip: anchored radio is NOT in the DOM.
    expect(screen.queryByLabelText(/anchored/i)).toBeNull();
  });

  test('switching back to Recurring restores frequency input and hides due_date', () => {
    render(<TaskForm mode="create" homeId="home-1" areas={AREAS} />);

    fireEvent.click(typeButton('One-off'));
    // due_date visible now
    expect(screen.getByLabelText(/^do by/i)).toBeTruthy();

    fireEvent.click(typeButton('Recurring'));

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
    // The task type stays on the first screen; notes are collapsed.
    expect(more!.contains(typeButton('One-off'))).toBe(false);
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

  test('choosing One-off reveals the Do by input without opening More options', () => {
    const { container } = render(
      <TaskForm mode="create" homeId="home-1" areas={AREAS} />,
    );
    fireEvent.click(typeButton('One-off'));
    expect(screen.getByLabelText(/^do by/i)).toBeTruthy();
    expect(
      container.querySelector('[data-more-options]')!.hasAttribute('hidden'),
    ).toBe(true);
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
    fireEvent.click(typeButton('One-off'));
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

describe('TaskForm edit mode seeds existing schedule fields', () => {
  test('a one-off shows its due date in "Do by" with One-off pressed', () => {
    const { container } = render(
      <TaskForm
        mode="edit"
        homeId="home-1"
        areas={AREAS}
        task={{
          id: 't-ooft',
          home_id: 'home-1',
          area_id: 'area-1',
          name: 'Replace smoke alarm',
          // PB returns 0 for a cleared number and a full datetime string.
          frequency_days: 0,
          schedule_mode: 'cycle',
          anchor_date: null,
          due_date: '2026-11-01 00:00:00.000Z',
        }}
      />,
    );
    const doBy = screen.getByLabelText(/^do by/i) as HTMLInputElement;
    expect(doBy.value).toBe('2026-11-01');
    expect(typeButton('One-off').getAttribute('aria-pressed')).toBe('true');
    // Nothing else is non-default, so More options stays closed.
    expect(
      container.querySelector('[data-more-options]')!.hasAttribute('hidden'),
    ).toBe(true);
  });

  test('a seasonal task shows its active months with More options open', () => {
    const { container } = render(
      <TaskForm
        mode="edit"
        homeId="home-1"
        areas={AREAS}
        task={{
          id: 't-seasonal',
          home_id: 'home-1',
          area_id: 'area-1',
          name: 'Clean pool filter',
          frequency_days: 14,
          schedule_mode: 'cycle',
          anchor_date: null,
          active_from_month: 10,
          active_to_month: 3,
        }}
      />,
    );
    const from = screen.getByLabelText(/^from month$/i) as HTMLSelectElement;
    const to = screen.getByLabelText(/^to month$/i) as HTMLSelectElement;
    expect(from.value).toBe('10');
    expect(to.value).toBe('3');
    expect(
      container.querySelector('[data-more-options]')!.hasAttribute('hidden'),
    ).toBe(false);
  });
});
