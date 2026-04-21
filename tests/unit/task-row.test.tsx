// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaskRow } from '@/components/task-row';

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

  it('invokes onComplete(task.id) on click', () => {
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

  it('renders "{N}d late" label for overdue variant', () => {
    render(
      <TaskRow
        task={baseTask}
        onComplete={() => {}}
        pending={false}
        daysDelta={-3}
        variant="overdue"
      />,
    );
    expect(screen.getByText(/3d late/)).toBeDefined();
  });

  it('renders "in Nd" label for future-due tasks', () => {
    render(
      <TaskRow
        task={baseTask}
        onComplete={() => {}}
        pending={false}
        daysDelta={4}
        variant="thisWeek"
      />,
    );
    expect(screen.getByText(/in 4d/)).toBeDefined();
  });

  it('renders "today" label when daysDelta is between 0 and 1', () => {
    render(
      <TaskRow
        task={baseTask}
        onComplete={() => {}}
        pending={false}
        daysDelta={0.2}
        variant="thisWeek"
      />,
    );
    expect(screen.getByText(/today/i)).toBeDefined();
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
});
