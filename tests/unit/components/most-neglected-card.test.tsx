// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MostNeglectedCard } from '@/components/most-neglected-card';

/**
 * 06-03 Task 2 — MostNeglectedCard rendering matrix (D-14, GAME-05).
 * Covers: null-task hides the component (hidden-when-no-overdue, critical
 * per CONTEXT), rendered-task shows name + area + daysOverdue chip +
 * tappable Complete button that invokes onComplete(task.id).
 */
describe('MostNeglectedCard', () => {
  it('returns null when task=null (hidden-when-no-overdue)', () => {
    const { container } = render(
      <MostNeglectedCard
        task={null}
        onComplete={() => {}}
        pending={false}
      />,
    );
    expect(
      container.querySelector('[data-most-neglected-card]'),
    ).toBeNull();
  });

  it('renders task name + area + "3 days overdue" + Complete button when task present', () => {
    const onComplete = vi.fn();
    const { container, getByText } = render(
      <MostNeglectedCard
        task={{
          id: 't1',
          name: 'Clean kitchen',
          daysOverdue: 3,
          area_name: 'Kitchen',
        }}
        onComplete={onComplete}
        pending={false}
      />,
    );
    const root = container.querySelector('[data-most-neglected-card]');
    expect(root).toBeTruthy();
    expect(root!.getAttribute('data-task-id')).toBe('t1');
    expect(root!.getAttribute('data-days-overdue')).toBe('3');
    expect(container.textContent).toMatch(/clean kitchen/i);
    expect(container.textContent).toMatch(/kitchen/i); // area chip
    expect(container.textContent).toMatch(/3 days overdue/i);

    const btn = getByText(/do it now/i).closest('button');
    expect(btn).toBeTruthy();
    fireEvent.click(btn!);
    expect(onComplete).toHaveBeenCalledWith('t1');
  });
});
