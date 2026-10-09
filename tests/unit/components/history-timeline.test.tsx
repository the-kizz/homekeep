import { describe, test, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import {
  HistoryTimeline,
  type HistoryEntry,
} from '@/components/history-timeline';

/**
 * The Today / Yesterday day headers must be computed in the home's
 * timezone regardless of the server's own TZ (the container runs
 * Australia/Melbourne while homes may be anywhere).
 */

const DAY = 86_400_000;

function entry(id: string, at: Date): HistoryEntry {
  return {
    id,
    completed_at: at.toISOString(),
    user: { id: 'u1', name: 'Dave' },
    task: { id: `t-${id}`, name: `Task ${id}` },
    area: { id: 'a1', name: 'Kitchen', color: '#888888' },
  };
}

function headers(): string[] {
  return Array.from(
    document.querySelectorAll('[data-history-day-header]'),
  ).map((h) => h.textContent ?? '');
}

const ORIGINAL_TZ = process.env.TZ;

afterEach(() => {
  cleanup();
  process.env.TZ = ORIGINAL_TZ;
});

describe('HistoryTimeline day headers', () => {
  test('wall-clock now: entries now and 24 h ago read Today and Yesterday', () => {
    const now = new Date();
    render(
      <HistoryTimeline
        entries={[entry('1', now), entry('2', new Date(now.getTime() - DAY))]}
        timezone="Australia/Perth"
      />,
    );
    expect(headers()).toEqual(['Today', 'Yesterday']);
  });

  test('pinned now just after Perth midnight', () => {
    // 2026-10-08T16:30Z is 00:30 on Oct 9 in Perth.
    const now = new Date('2026-10-08T16:30:00.000Z');
    render(
      <HistoryTimeline
        entries={[entry('1', now), entry('2', new Date(now.getTime() - DAY))]}
        timezone="Australia/Perth"
        now={now}
      />,
    );
    expect(headers()).toEqual(['Today', 'Yesterday']);
    expect(screen.getByText('Today').getAttribute('data-history-day-header')).toBe(
      '2026-10-09',
    );
  });

  test('server running in Melbourne, home in Perth', () => {
    process.env.TZ = 'Australia/Melbourne';
    const now = new Date('2026-10-08T03:00:00.000Z'); // 11:00 Perth, 14:00 Melbourne
    render(
      <HistoryTimeline
        entries={[entry('1', now), entry('2', new Date(now.getTime() - DAY))]}
        timezone="Australia/Perth"
        now={now}
      />,
    );
    expect(headers()).toEqual(['Today', 'Yesterday']);
  });

  test('yesterday crosses a month boundary', () => {
    const now = new Date('2026-10-01T04:00:00.000Z'); // Oct 1 noon in Perth
    render(
      <HistoryTimeline
        entries={[entry('1', now), entry('2', new Date(now.getTime() - DAY))]}
        timezone="Australia/Perth"
        now={now}
      />,
    );
    expect(headers()).toEqual(['Today', 'Yesterday']);
  });
});
