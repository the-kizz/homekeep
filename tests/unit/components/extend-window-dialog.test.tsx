// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep

/**
 * Phase 15 Plan 02 (SNZE-08, D-10, D-11, D-12) — ExtendWindowDialog tests.
 *
 * Covers:
 *   (1) Renders with task.name in the title when open=true.
 *   (2) Cancel button calls onCancel.
 *   (3) "Extend active window" button calls onExtend.
 *   (4) "Continue anyway" button calls onContinueAnyway.
 */

import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ExtendWindowDialog } from '@/components/extend-window-dialog';
import type { Task } from '@/lib/task-scheduling';

const SEASONAL_TASK: Task & { name: string } = {
  id: 'task-1',
  name: 'Service AC',
  created: '2026-03-01T00:00:00.000Z',
  archived: false,
  frequency_days: 30,
  schedule_mode: 'cycle',
  anchor_date: null,
  active_from_month: 4,
  active_to_month: 9,
};

describe('ExtendWindowDialog (Phase 15 SNZE-08)', () => {
  test('renders with task.name in title when open=true', () => {
    render(
      <ExtendWindowDialog
        open
        onOpenChange={() => {}}
        task={SEASONAL_TASK}
        pickedDate="2026-10-15"
        timezone="Australia/Perth"
        onCancel={() => {}}
        onExtend={() => {}}
        onContinueAnyway={() => {}}
      />,
    );

    // Title + body both reference the task name. The description renders
    // the task name between typographic single-quotes.
    expect(screen.getByText(/Service AC/)).toBeTruthy();
  });

  test('Cancel button calls onCancel', () => {
    const onCancel = vi.fn();
    render(
      <ExtendWindowDialog
        open
        onOpenChange={() => {}}
        task={SEASONAL_TASK}
        pickedDate="2026-10-15"
        timezone="Australia/Perth"
        onCancel={onCancel}
        onExtend={() => {}}
        onContinueAnyway={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId('extend-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('"Extend active window" button calls onExtend', async () => {
    const onExtend = vi.fn();
    render(
      <ExtendWindowDialog
        open
        onOpenChange={() => {}}
        task={SEASONAL_TASK}
        pickedDate="2026-10-15"
        timezone="Australia/Perth"
        onCancel={() => {}}
        onExtend={onExtend}
        onContinueAnyway={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('extend-confirm'));
    });
    expect(onExtend).toHaveBeenCalledTimes(1);
  });

  test('"Continue anyway" button calls onContinueAnyway', async () => {
    const onContinueAnyway = vi.fn();
    render(
      <ExtendWindowDialog
        open
        onOpenChange={() => {}}
        task={SEASONAL_TASK}
        pickedDate="2026-10-15"
        timezone="Australia/Perth"
        onCancel={() => {}}
        onExtend={() => {}}
        onContinueAnyway={onContinueAnyway}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('extend-continue'));
    });
    expect(onContinueAnyway).toHaveBeenCalledTimes(1);
  });
});
