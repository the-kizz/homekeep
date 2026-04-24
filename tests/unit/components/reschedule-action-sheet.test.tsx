// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep

/**
 * Phase 15 Plan 02 (SNZE-01, SNZE-02, SNZE-03, D-04..D-06) —
 * RescheduleActionSheet tests.
 *
 * Covers:
 *   (1) Header renders "Reschedule '<task.name>'".
 *   (2) Archived task (computeNextDue → null) renders the "Task is not
 *       schedulable right now" body + disabled submit.
 *   (3) Submit with default radio "just-this-time" calls snoozeTaskAction.
 *   (4) Selecting "from-now-on" then submit calls rescheduleTaskAction.
 *   (5) Cancel button triggers onOpenChange(false) without calling
 *       either server action.
 */

import {
  describe,
  test,
  expect,
  vi,
  beforeEach,
} from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { Task } from '@/lib/task-scheduling';

const mockSnooze = vi.fn();
const mockReschedule = vi.fn();
const mockRefresh = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock('@/lib/actions/reschedule', () => ({
  snoozeTaskAction: (...args: unknown[]) => mockSnooze(...args),
  rescheduleTaskAction: (...args: unknown[]) => mockReschedule(...args),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: mockRefresh,
    push: vi.fn(),
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

beforeEach(() => {
  mockSnooze.mockReset();
  mockReschedule.mockReset();
  mockRefresh.mockReset();
  mockToastSuccess.mockReset();
  mockToastError.mockReset();
  mockSnooze.mockResolvedValue({
    ok: true,
    override: { id: 'ov-1', snooze_until: '2026-05-01T00:00:00.000Z' },
  });
  mockReschedule.mockResolvedValue({
    ok: true,
    task: { id: 't-1', reschedule_marker: '2026-04-22T10:00:00.000Z' },
  });
});

// Schedulable task (cycle, no active window) for the happy-path tests.
const SCHEDULABLE_TASK: Task & { name: string } = {
  id: 'task-1',
  name: 'Mop floors',
  created: '2026-03-01T00:00:00.000Z',
  archived: false,
  frequency_days: 7,
  schedule_mode: 'cycle',
  anchor_date: null,
};

// Archived task to exercise the "not schedulable" branch — computeNextDue
// returns null for archived tasks (Phase 2 D-13 + Phase 10 precedent).
const ARCHIVED_TASK: Task & { name: string } = {
  ...SCHEDULABLE_TASK,
  id: 'task-archived',
  name: 'Archived task',
  archived: true,
};

describe('RescheduleActionSheet (Phase 15 SNZE-01/02/03)', () => {
  test('renders header "Reschedule \'<task.name>\'"', async () => {
    const { RescheduleActionSheet } = await import(
      '@/components/reschedule-action-sheet'
    );
    render(
      <RescheduleActionSheet
        open
        onOpenChange={() => {}}
        task={SCHEDULABLE_TASK}
        lastCompletion={null}
        timezone="Australia/Perth"
        onExtendWindow={async () => {}}
      />,
    );

    // The title text uses typographic single-quotes around the task name.
    const title = screen.getByText(/Mop floors/);
    expect(title).toBeTruthy();
    // The full text includes "Reschedule" + task name.
    expect(title.textContent).toMatch(/Reschedule/i);
  });

  test('archived task renders "not schedulable" body + disabled submit', async () => {
    const { RescheduleActionSheet } = await import(
      '@/components/reschedule-action-sheet'
    );
    render(
      <RescheduleActionSheet
        open
        onOpenChange={() => {}}
        task={ARCHIVED_TASK}
        lastCompletion={null}
        timezone="Australia/Perth"
        onExtendWindow={async () => {}}
      />,
    );

    expect(screen.getByText(/not schedulable right now/i)).toBeTruthy();
    // Submit button is not rendered on the "not schedulable" branch;
    // only a Close button. Assert submit testid absent.
    expect(screen.queryByTestId('reschedule-submit')).toBeNull();
  });

  test('default radio is "just-this-time"; submit calls snoozeTaskAction', async () => {
    const onOpenChange = vi.fn();
    const { RescheduleActionSheet } = await import(
      '@/components/reschedule-action-sheet'
    );
    render(
      <RescheduleActionSheet
        open
        onOpenChange={onOpenChange}
        task={SCHEDULABLE_TASK}
        lastCompletion={null}
        timezone="Australia/Perth"
        onExtendWindow={async () => {}}
      />,
    );

    const justThisTime = screen.getByLabelText(/just this time/i) as HTMLInputElement;
    expect(justThisTime.checked).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByTestId('reschedule-submit'));
    });

    expect(mockSnooze).toHaveBeenCalledTimes(1);
    const arg = mockSnooze.mock.calls[0][0] as {
      task_id: string;
      snooze_until: string;
    };
    expect(arg.task_id).toBe('task-1');
    expect(typeof arg.snooze_until).toBe('string');
    // ISO string is parseable into a Date.
    expect(Number.isNaN(new Date(arg.snooze_until).getTime())).toBe(false);
    expect(mockReschedule).not.toHaveBeenCalled();
  });

  test('selecting "from-now-on" + submit calls rescheduleTaskAction', async () => {
    const { RescheduleActionSheet } = await import(
      '@/components/reschedule-action-sheet'
    );
    render(
      <RescheduleActionSheet
        open
        onOpenChange={() => {}}
        task={SCHEDULABLE_TASK}
        lastCompletion={null}
        timezone="Australia/Perth"
        onExtendWindow={async () => {}}
      />,
    );

    fireEvent.click(screen.getByLabelText(/from now on/i));

    await act(async () => {
      fireEvent.click(screen.getByTestId('reschedule-submit'));
    });

    expect(mockReschedule).toHaveBeenCalledTimes(1);
    const arg = mockReschedule.mock.calls[0][0] as {
      task_id: string;
      new_date: string;
    };
    expect(arg.task_id).toBe('task-1');
    expect(typeof arg.new_date).toBe('string');
    expect(mockSnooze).not.toHaveBeenCalled();
  });

  test('Cancel calls onOpenChange(false) without invoking either action', async () => {
    const onOpenChange = vi.fn();
    const { RescheduleActionSheet } = await import(
      '@/components/reschedule-action-sheet'
    );
    render(
      <RescheduleActionSheet
        open
        onOpenChange={onOpenChange}
        task={SCHEDULABLE_TASK}
        lastCompletion={null}
        timezone="Australia/Perth"
        onExtendWindow={async () => {}}
      />,
    );

    fireEvent.click(screen.getByTestId('reschedule-cancel'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockSnooze).not.toHaveBeenCalled();
    expect(mockReschedule).not.toHaveBeenCalled();
  });
});
