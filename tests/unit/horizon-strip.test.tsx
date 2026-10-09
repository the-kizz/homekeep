// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { HorizonStrip } from '@/components/horizon-strip';
import type { ClassifiedTask } from '@/lib/band-classification';

/**
 * 03-02 Task 2 component tests for HorizonStrip.
 *
 * Covers:
 *   - Empty-tasks branch shows "looking clear" text + NO cells.
 *   - 12 cells render with correct month abbreviations in UTC.
 *   - Tasks bucketed into the right month (UTC + non-UTC tz).
 *   - Melbourne/LA-style cross-midnight bucketing (Pitfall 2).
 */
const mkTask = (
  id: string,
  name: string,
  nextDue: Date,
): ClassifiedTask =>
  ({
    id,
    created: '2026-01-01T00:00:00Z',
    archived: false,
    frequency_days: 30,
    schedule_mode: 'cycle',
    anchor_date: null,
    nextDue,
    daysDelta: 30,
    name,
  }) as ClassifiedTask & { name: string };

describe('HorizonStrip', () => {
  const now = new Date('2026-04-20T12:00:00Z');
  const tz = 'UTC';

  it('renders the empty-state message when tasks=[]', () => {
    const { container } = render(
      <HorizonStrip tasks={[]} now={now} timezone={tz} />,
    );
    expect(container.textContent).toMatch(/looking clear/i);
    expect(container.querySelector('button[data-month-key]')).toBeNull();
  });

  it('renders 12 month cells with labels starting at the current month (UTC)', () => {
    const t = mkTask('x', 'X', new Date('2026-06-15T00:00:00Z'));
    const { container } = render(
      <HorizonStrip tasks={[t]} now={now} timezone={tz} />,
    );
    const buttons = container.querySelectorAll('button[data-month-key]');
    expect(buttons.length).toBe(12);
    // April is index 0, May index 1, June index 2, and so on.
    expect(buttons[0].textContent).toMatch(/Apr/);
    expect(buttons[1].textContent).toMatch(/May/);
    expect(buttons[2].textContent).toMatch(/Jun/);
    expect(buttons[11].textContent).toMatch(/Mar/);
  });

  it('starts at the home-timezone month when host and home disagree', () => {
    // 20:00 UTC on 30 Apr is already 1 May in Melbourne (UTC+10).
    const lateApril = new Date('2026-04-30T20:00:00Z');
    const t = mkTask('x', 'X', new Date('2026-06-15T00:00:00Z'));
    const { container } = render(
      <HorizonStrip
        tasks={[t]}
        now={lateApril}
        timezone="Australia/Melbourne"
      />,
    );
    const buttons = container.querySelectorAll('button[data-month-key]');
    expect(buttons[0].getAttribute('data-month-key')).toBe('2026-05');
    expect(buttons[11].getAttribute('data-month-key')).toBe('2027-04');
  });

  it('buckets a task into its month cell and leaves the cell enabled', () => {
    const t = mkTask('x', 'Paint fence', new Date('2026-07-10T00:00:00Z'));
    const { container } = render(
      <HorizonStrip tasks={[t]} now={now} timezone={tz} />,
    );
    const julBtn = container.querySelector(
      'button[data-month-key="2026-07"]',
    );
    expect(julBtn).toBeTruthy();
    expect(julBtn!.hasAttribute('disabled')).toBe(false);
    expect(julBtn!.getAttribute('data-month-count')).toBe('1');
  });

  it('disables month cells that hold no tasks', () => {
    const t = mkTask('x', 'Paint fence', new Date('2026-07-10T00:00:00Z'));
    const { container } = render(
      <HorizonStrip tasks={[t]} now={now} timezone={tz} />,
    );
    const augBtn = container.querySelector(
      'button[data-month-key="2026-08"]',
    );
    expect(augBtn).toBeTruthy();
    expect(augBtn!.hasAttribute('disabled')).toBe(true);
  });

  it('buckets a task across UTC midnight into its LOCAL month (Melbourne canonical case)', () => {
    // 2026-06-30T15:00Z → Melbourne (UTC+10) = 2026-07-01 01:00 local → July bucket.
    const t = mkTask(
      'y',
      'Melbourne task',
      new Date('2026-06-30T15:00:00Z'),
    );
    const { container } = render(
      <HorizonStrip
        tasks={[t]}
        now={now}
        timezone="Australia/Melbourne"
      />,
    );
    const julBtn = container.querySelector(
      'button[data-month-key="2026-07"]',
    );
    expect(julBtn).toBeTruthy();
    expect(julBtn!.hasAttribute('disabled')).toBe(false);
    expect(julBtn!.getAttribute('data-month-count')).toBe('1');
  });

  it('tracks data-month-count regardless of the number of tasks (Phase 16: dots + +N overflow replaced by density tint per D-01)', () => {
    // Phase 16 Plan 01 swapped the per-cell 3-dot render + `+N` overflow
    // label for a bg-primary/{10,30,50} density tint. `data-month-count`
    // remains the load-bearing E2E hook — assert both the 3-task and
    // 5-task cases surface the correct count attribute.
    const tasks3 = [
      mkTask('a', 'A', new Date('2026-06-05T00:00:00Z')),
      mkTask('b', 'B', new Date('2026-06-15T00:00:00Z')),
      mkTask('c', 'C', new Date('2026-06-25T00:00:00Z')),
    ];
    const { container: c3 } = render(
      <HorizonStrip tasks={tasks3} now={now} timezone={tz} />,
    );
    const junBtn3 = c3.querySelector('button[data-month-key="2026-06"]');
    expect(junBtn3).toBeTruthy();
    expect(junBtn3!.getAttribute('data-month-count')).toBe('3');
    // 3-dot render removed — no matching spans on the button.
    expect(
      junBtn3!.querySelectorAll('span.size-1\\.5.rounded-full.bg-primary')
        .length,
    ).toBe(0);
    // No +N overflow label (D-01 replaces dots with tint).
    expect(junBtn3!.textContent).not.toMatch(/\+/);

    const tasks5 = [
      mkTask('a', 'A', new Date('2026-06-05T00:00:00Z')),
      mkTask('b', 'B', new Date('2026-06-10T00:00:00Z')),
      mkTask('c', 'C', new Date('2026-06-15T00:00:00Z')),
      mkTask('d', 'D', new Date('2026-06-20T00:00:00Z')),
      mkTask('e', 'E', new Date('2026-06-25T00:00:00Z')),
    ];
    const { container: c5 } = render(
      <HorizonStrip tasks={tasks5} now={now} timezone={tz} />,
    );
    const junBtn5 = c5.querySelector('button[data-month-key="2026-06"]');
    expect(junBtn5).toBeTruthy();
    expect(junBtn5!.getAttribute('data-month-count')).toBe('5');
    // Still no +N overflow — the density tint carries the signal.
    expect(junBtn5!.textContent).not.toMatch(/\+/);
  });
});
