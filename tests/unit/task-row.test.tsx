// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaskRow } from '@/components/task-row';
import { TaskBand } from '@/components/task-band';

const baseTask = { id: 't1', name: 'Wipe benches', frequency_days: 7 };

/**
 * 03-02 Task 1 component tests for TaskRow.
 * Covers: 44px tap target, onComplete callback, pending disable,
 * overdue border variant, label copy variants.
 */
describe('TaskRow', () => {
  it('renders with the min-h-[44px] class for the 44px tap target', () => {
    const { container } = render(
      <TaskRow
        task={baseTask}
        onComplete={() => {}}
        pending={false}
        daysDelta={3}
      />,
    );
    expect(container.querySelector('button.min-h-\\[44px\\]')).toBeTruthy();
  });

  it('invokes onComplete(task.id) on click when no onDetail is provided', () => {
    const onComplete = vi.fn();
    render(
      <TaskRow
        task={baseTask}
        onComplete={onComplete}
        pending={false}
        daysDelta={3}
      />,
    );
    fireEvent.click(screen.getByText('Wipe benches'));
    expect(onComplete).toHaveBeenCalledWith('t1');
  });

  it('v1.2.1 PATCH2-06: invokes onDetail(task.id) on click by default when onDetail is provided', () => {
    const onComplete = vi.fn();
    const onDetail = vi.fn();
    render(
      <TaskRow
        task={baseTask}
        onComplete={onComplete}
        onDetail={onDetail}
        pending={false}
        daysDelta={3}
      />,
    );
    fireEvent.click(screen.getByText('Wipe benches'));
    expect(onDetail).toHaveBeenCalledWith('t1');
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('v1.2.1 PATCH2-06: primaryTap="complete" restores pre-v1.2.1 tap=complete behavior', () => {
    const onComplete = vi.fn();
    const onDetail = vi.fn();
    render(
      <TaskRow
        task={baseTask}
        onComplete={onComplete}
        onDetail={onDetail}
        primaryTap="complete"
        pending={false}
        daysDelta={3}
      />,
    );
    fireEvent.click(screen.getByText('Wipe benches'));
    expect(onComplete).toHaveBeenCalledWith('t1');
    expect(onDetail).not.toHaveBeenCalled();
  });

  it('is disabled when pending=true and swallows clicks', () => {
    const onComplete = vi.fn();
    render(
      <TaskRow
        task={baseTask}
        onComplete={onComplete}
        pending={true}
        daysDelta={3}
      />,
    );
    const btn = screen.getByRole('button');
    expect(btn.hasAttribute('disabled')).toBe(true);
    fireEvent.click(btn);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('applies the border-l-4 warm-accent when variant=overdue', () => {
    const { container } = render(
      <TaskRow
        task={baseTask}
        onComplete={() => {}}
        pending={false}
        daysDelta={-5}
        variant="overdue"
      />,
    );
    expect(container.querySelector('button.border-l-4')).toBeTruthy();
  });

  describe('due label copy', () => {
    const labelFor = (daysDelta: number, variant?: 'overdue' | 'thisWeek' | 'horizon') => {
      const { container, unmount } = render(
        <TaskRow
          task={baseTask}
          onComplete={() => {}}
          pending={false}
          daysDelta={daysDelta}
          variant={variant}
        />,
      );
      const text = container.querySelector('[data-due-label]')?.textContent;
      unmount();
      return text;
    };

    it.each([
      [-1, 'yesterday'],
      [-0.4, 'yesterday'],
      [-1.5, '2 days late'],
      [-2, '2 days late'],
      [-3, '3 days late'],
      [-13, '13 days late'],
      [-30, '30 days late'],
      [-31, '30+ days late'],
      [-400, '30+ days late'],
    ])('overdue %d → "%s"', (delta, expected) => {
      expect(labelFor(delta, 'overdue')).toBe(expected);
    });

    it.each([
      [0, 'today'],
      [0.2, 'today'],
      [1, 'tomorrow'],
      [1.8, 'tomorrow'],
      [4, 'in 4 days'],
      [6.6, 'in 6 days'],
      [120, 'in 120 days'],
    ])('upcoming %d → "%s"', (delta, expected) => {
      expect(labelFor(delta, 'thisWeek')).toBe(expected);
    });

    it('never exceeds 13 characters', () => {
      for (let d = -500; d <= 0; d++) {
        expect(labelFor(d, 'overdue')!.length).toBeLessThanOrEqual(13);
      }
    });
  });

  it('renders singular "day" when frequency_days=1', () => {
    render(
      <TaskRow
        task={{ id: 't2', name: 'Daily', frequency_days: 1 }}
        onComplete={() => {}}
        pending={false}
        daysDelta={1}
      />,
    );
    expect(screen.getByText(/Every 1 day/)).toBeDefined();
  });

  it('invokes onDetail on contextmenu when onDetail is provided', () => {
    const onDetail = vi.fn();
    render(
      <TaskRow
        task={baseTask}
        onComplete={() => {}}
        onDetail={onDetail}
        pending={false}
        daysDelta={3}
      />,
    );
    fireEvent.contextMenu(screen.getByRole('button'));
    expect(onDetail).toHaveBeenCalledWith('t1');
  });
  describe('one-tap complete button', () => {
    it('renders no complete button when onQuickComplete is absent', () => {
      render(
        <TaskRow
          task={baseTask}
          onComplete={() => {}}
          onDetail={() => {}}
          pending={false}
          daysDelta={3}
        />,
      );
      expect(
        screen.queryByRole('button', { name: 'Complete Wipe benches' }),
      ).toBeNull();
    });

    it('renders a button with the accessible name "Complete <task name>"', () => {
      render(
        <TaskRow
          task={baseTask}
          onComplete={() => {}}
          onDetail={() => {}}
          onQuickComplete={() => {}}
          pending={false}
          daysDelta={3}
        />,
      );
      expect(
        screen.getByRole('button', { name: 'Complete Wipe benches' }),
      ).toBeTruthy();
    });

    it('calls onQuickComplete with the id and does not open the detail sheet', () => {
      const onQuickComplete = vi.fn();
      const onDetail = vi.fn();
      const onComplete = vi.fn();
      render(
        <TaskRow
          task={baseTask}
          onComplete={onComplete}
          onDetail={onDetail}
          onQuickComplete={onQuickComplete}
          pending={false}
          daysDelta={3}
        />,
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'Complete Wipe benches' }),
      );
      expect(onQuickComplete).toHaveBeenCalledWith('t1');
      expect(onDetail).not.toHaveBeenCalled();
      expect(onComplete).not.toHaveBeenCalled();
    });

    it('clicking the row body still calls onDetail only', () => {
      const onQuickComplete = vi.fn();
      const onDetail = vi.fn();
      render(
        <TaskRow
          task={baseTask}
          onComplete={() => {}}
          onDetail={onDetail}
          onQuickComplete={onQuickComplete}
          pending={false}
          daysDelta={3}
        />,
      );
      fireEvent.click(screen.getByText('Wipe benches'));
      expect(onDetail).toHaveBeenCalledWith('t1');
      expect(onQuickComplete).not.toHaveBeenCalled();
    });

    it('is disabled and marked pressed while pending', () => {
      const onQuickComplete = vi.fn();
      render(
        <TaskRow
          task={baseTask}
          onComplete={() => {}}
          onDetail={() => {}}
          onQuickComplete={onQuickComplete}
          pending={true}
          daysDelta={3}
        />,
      );
      const btn = screen.getByRole('button', { name: 'Complete Wipe benches' });
      expect(btn.hasAttribute('disabled')).toBe(true);
      expect(btn.getAttribute('data-pending')).toBe('true');
      fireEvent.click(btn);
      expect(onQuickComplete).not.toHaveBeenCalled();
    });
  });
});

describe('TaskBand empty copy', () => {
  const now = new Date('2026-10-09T00:00:00Z');
  const band = (variant: 'overdue' | 'thisWeek', showEmpty?: boolean) =>
    render(
      <TaskBand
        label={variant === 'overdue' ? 'Overdue' : 'This week'}
        tasks={[]}
        onComplete={() => {}}
        pendingTaskId={null}
        timezone="UTC"
        variant={variant}
        now={now}
        showEmpty={showEmpty}
      />,
    );

  it('renders nothing for an empty band by default', () => {
    const { container } = band('overdue');
    expect(container.innerHTML).toBe('');
  });

  it('says "Nothing overdue. Nice." when showEmpty is set', () => {
    band('overdue', true);
    expect(screen.getByText('Nothing overdue. Nice.')).toBeTruthy();
  });

  it('says "Nothing due this week." when showEmpty is set', () => {
    band('thisWeek', true);
    expect(screen.getByText('Nothing due this week.')).toBeTruthy();
  });
});
