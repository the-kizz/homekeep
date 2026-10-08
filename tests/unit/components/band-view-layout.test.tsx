// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep

/**
 * BandView dashboard layout. Desktop (lg) is a 12-column grid: tasks on
 * the left (7), summary pinned on the right (5). The summary is rendered
 * twice: a phone copy (lg:hidden) interleaved with the bands in reading
 * order, and a desktop copy in the aside (hidden below lg). DOM order is
 * therefore the phone visual order, so Tab and screen-reader order match
 * it. jsdom has no layout engine, so these assertions lock the class
 * contract and the DOM placement.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/h/abc',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/actions/completions', () => ({
  completeTaskAction: vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/actions/tasks', () => ({
  updateTask: vi.fn(),
}));
vi.mock('@/lib/actions/reschedule', () => ({
  snoozeTaskAction: vi.fn(),
  rescheduleTaskAction: vi.fn(),
}));

import { BandView, type TaskWithName } from '@/components/band-view';
import { completeTaskAction } from '@/lib/actions/completions';
import { toast } from 'sonner';

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
  frequency_days: number | null,
  created: string,
  extra: Partial<TaskWithName> = {},
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
    ...extra,
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

  it('puts the bands in the main section and a desktop summary in a sticky aside', () => {
    const { container } = renderView(tasks);
    const main = container.querySelector('[data-dashboard-main]')!;
    const aside = container.querySelector('[data-dashboard-aside]')!;
    expect(main.tagName).toBe('SECTION');
    expect(aside.tagName).toBe('ASIDE');
    expect(main.className).toContain('lg:col-span-7');
    expect(aside.className).toContain('lg:col-span-5');
    expect(aside.className).toContain('lg:sticky');
    expect(aside.className).toContain('lg:self-start');
    // Desktop-only: hidden on phone, shown from lg.
    expect(aside.className.split(' ')).toContain('hidden');
    expect(aside.className).toContain('lg:flex');

    expect(main.querySelector('[data-band="overdue"]')).not.toBeNull();
    expect(main.querySelector('[data-band="thisWeek"]')).not.toBeNull();
    expect(aside.querySelector('[role="img"][aria-label^="Coverage"]')).not.toBeNull();
    expect(aside.querySelector('[data-most-neglected-card]')).not.toBeNull();
    expect(aside.querySelector('[data-band="horizon"]')).not.toBeNull();
  });

  it('renders a phone copy of the summary, hidden from lg', () => {
    const { container } = renderView(tasks);
    const main = container.querySelector('[data-dashboard-main]')!;
    const phoneCopies = main.querySelectorAll('[data-summary-copy="phone"]');
    expect(phoneCopies.length).toBe(3);
    for (const el of phoneCopies) {
      expect(el.className.split(' ')).toContain('lg:hidden');
    }
    expect(main.querySelector('[role="img"][aria-label^="Coverage"]')).not.toBeNull();
    expect(main.querySelector('[data-most-neglected-card]')).not.toBeNull();
    expect(main.querySelector('[data-band="horizon"]')).not.toBeNull();
    // No CSS reordering: DOM order is the order on screen.
    const root = container.querySelector('[data-band-view]')!;
    expect(root.className).not.toMatch(/order-/);
    expect(main.className.split(' ')).not.toContain('contents');
  });

  it('phone DOM order is ring, overdue, most neglected, this week, horizon, sleeping', () => {
    const seasonal = mkTask('t_sleep', 'Clear gutters', 30, '2025-01-01T00:00:00.000Z', {
      active_from_month: 10,
      active_to_month: 12,
    });
    // Done in-season last December → dormant in April.
    const { container } = render(
      <BandView
        tasks={[...tasks, seasonal]}
        completions={[
          {
            id: 'c1',
            task_id: 't_sleep',
            completed_by_id: 'u1',
            completed_at: '2025-12-15T00:00:00.000Z',
            notes: '',
            via: 'tap',
          },
        ]}
        userId="u1"
        homeId="abcdefghijklmno"
        timezone="UTC"
        now={NOW}
        lastCompletionsByTaskId={{}}
      />,
    );
    const main = container.querySelector('[data-dashboard-main]')!;
    const marks = [
      '[role="img"][aria-label^="Coverage"]',
      '[data-band="overdue"]',
      '[data-most-neglected-card]',
      '[data-band="thisWeek"]',
      '[data-band="horizon"]',
      '[data-dormant-section]',
    ].map((sel) => main.querySelector(sel));
    for (const m of marks) expect(m).not.toBeNull();
    for (let i = 1; i < marks.length; i++) {
      const rel = marks[i - 1]!.compareDocumentPosition(marks[i]!);
      expect(rel & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('keeps the ring and the blank-canvas card for an empty home', () => {
    const { container, getByText } = renderView([]);
    const main = container.querySelector('[data-dashboard-main]')!;
    const aside = container.querySelector('[data-dashboard-aside]')!;
    expect(main.querySelector('[aria-label="Coverage 100%"]')).not.toBeNull();
    expect(aside.querySelector('[aria-label="Coverage 100%"]')).not.toBeNull();
    expect(getByText('Your house is a blank canvas.')).toBeTruthy();
    expect(container.querySelector('[data-band="horizon"]')).toBeNull();
  });
});

describe('BandView one-off tasks', () => {
  it('shows a one-off due yesterday in the Overdue band', () => {
    const oneOff = mkTask('t_once', 'Fix the gate latch', null, '2026-04-01T00:00:00.000Z', {
      due_date: '2026-04-19T00:00:00.000Z',
    });
    const { container } = renderView([oneOff]);
    const row = container.querySelector(
      '[data-band="overdue"] button[data-task-id="t_once"]',
    );
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain('One-off');
  });
});

describe('BandView one-tap complete', () => {
  const overdue = mkTask('t_overdue', 'Wipe benches', 7, '2026-03-21T12:00:00.000Z');

  it('names the task in the completion toast', async () => {
    vi.mocked(completeTaskAction).mockResolvedValueOnce({
      ok: true,
      completion: { id: 'c1', completed_at: NOW },
      nextDueFormatted: 'Apr 27, 2026',
    });
    const { getAllByRole } = renderView([overdue]);
    fireEvent.click(getAllByRole('button', { name: 'Complete Wipe benches' })[0]);
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        'Done: Wipe benches — next due Apr 27, 2026',
      ),
    );
  });

  it('still asks before an early completion', async () => {
    vi.mocked(completeTaskAction).mockResolvedValueOnce({
      requiresConfirm: true,
      elapsed: 1,
      frequency: 7,
      lastCompletedAt: '2026-04-19T12:00:00.000Z',
    });
    const { getAllByRole, findByTestId } = renderView([overdue]);
    fireEvent.click(getAllByRole('button', { name: 'Complete Wipe benches' })[0]);
    expect(await findByTestId('early-completion-dialog')).toBeTruthy();
    expect(completeTaskAction).toHaveBeenLastCalledWith('t_overdue', { force: false });
  });
});
