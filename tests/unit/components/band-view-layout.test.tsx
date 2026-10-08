// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep

/**
 * BandView dashboard layout. Desktop (lg) is a 12-column grid: tasks on
 * the left (7), summary pinned on the right (5). Below lg the section and
 * aside are display:contents and order rules restore the single-column
 * phone order: ring, overdue, most neglected, this week, horizon,
 * sleeping. jsdom has no layout engine, so these assertions lock the
 * class contract and the DOM placement that produces it.
 */

import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/h/abc',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/actions/completions', () => ({
  completeTaskAction: vi.fn(),
}));
vi.mock('@/lib/actions/tasks', () => ({
  updateTask: vi.fn(),
}));
vi.mock('@/lib/actions/reschedule', () => ({
  snoozeTaskAction: vi.fn(),
  rescheduleTaskAction: vi.fn(),
}));

import { BandView, type TaskWithName } from '@/components/band-view';

// Some children read prefers-reduced-motion; jsdom ships no matchMedia.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const NOW = '2026-04-20T12:00:00.000Z';

const mkTask = (
  id: string,
  name: string,
  frequency_days: number,
  created: string,
): TaskWithName =>
  ({
    id,
    name,
    created,
    archived: false,
    frequency_days,
    schedule_mode: 'cycle',
    anchor_date: null,
    icon: '',
    color: '#D4A574',
    area_id: 'area1',
    area_name: 'Kitchen',
  }) as TaskWithName;

function renderView(tasks: TaskWithName[]) {
  return render(
    <BandView
      tasks={tasks}
      completions={[]}
      userId="u1"
      homeId="abcdefghijklmno"
      timezone="UTC"
      now={NOW}
      lastCompletionsByTaskId={{}}
    />,
  );
}

describe('BandView layout', () => {
  const tasks = [
    // Created 30 days ago, every 7 days, never done → overdue.
    mkTask('t_overdue', 'Wipe benches', 7, '2026-03-21T12:00:00.000Z'),
    // Created 3 days ago, every 7 days → due in 4 days (this week).
    mkTask('t_week', 'Water plants', 7, '2026-04-17T12:00:00.000Z'),
    // Created yesterday, every 60 days → horizon.
    mkTask('t_later', 'Clean gutters', 60, '2026-04-19T12:00:00.000Z'),
  ];

  it('uses a 12-column grid at lg inside a max-w-6xl container', () => {
    const { container } = renderView(tasks);
    const root = container.querySelector('[data-band-view]')!;
    expect(root.className).toContain('lg:grid');
    expect(root.className).toContain('lg:grid-cols-12');
    expect(root.className).toContain('max-w-6xl');
    expect(root.className).toContain('flex-col');
  });

  it('puts the bands in the main section and the summary in a sticky aside', () => {
    const { container } = renderView(tasks);
    const main = container.querySelector('[data-dashboard-main]')!;
    const aside = container.querySelector('[data-dashboard-aside]')!;
    expect(main.tagName).toBe('SECTION');
    expect(aside.tagName).toBe('ASIDE');
    expect(main.className).toContain('lg:col-span-7');
    expect(aside.className).toContain('lg:col-span-5');
    expect(aside.className).toContain('lg:sticky');
    expect(aside.className).toContain('lg:self-start');

    expect(main.querySelector('[data-band="overdue"]')).not.toBeNull();
    expect(main.querySelector('[data-band="thisWeek"]')).not.toBeNull();
    expect(aside.querySelector('[role="img"][aria-label^="Coverage"]')).not.toBeNull();
    expect(aside.querySelector('[data-most-neglected-card]')).not.toBeNull();
    expect(aside.querySelector('[data-band="horizon"]')).not.toBeNull();
  });

  it('collapses both columns below lg so the phone order rules apply', () => {
    const { container } = renderView(tasks);
    const root = container.querySelector('[data-band-view]')!;
    const main = container.querySelector('[data-dashboard-main]')!;
    const aside = container.querySelector('[data-dashboard-aside]')!;
    expect(main.className.split(' ')).toContain('contents');
    expect(aside.className.split(' ')).toContain('contents');
    // Ring first, then the interleaved phone order.
    expect(aside.querySelector('header')!.className).toContain(
      'max-lg:order-first',
    );
    const order = [
      'max-lg:[&_[data-band=overdue]]:order-1',
      'max-lg:[&_[data-most-neglected-card]]:order-2',
      'max-lg:[&_[data-band=thisWeek]]:order-3',
      'max-lg:[&_[data-band=horizon]]:order-4',
      'max-lg:[&_[data-dormant-section]]:order-5',
    ];
    for (const cls of order) expect(root.className).toContain(cls);
  });

  it('keeps the ring and the blank-canvas card for an empty home', () => {
    const { container, getByText } = renderView([]);
    const aside = container.querySelector('[data-dashboard-aside]')!;
    expect(aside.querySelector('[aria-label="Coverage 100%"]')).not.toBeNull();
    expect(getByText('Your house is a blank canvas.')).toBeTruthy();
    expect(aside.querySelector('[data-band="horizon"]')).toBeNull();
  });
});
