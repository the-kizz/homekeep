// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/causes

/**
 * Phase 16 Plan 01 Task 3 — TaskDetailSheet Schedule section tests (RED).
 *
 * Covers D-08 (show only when shifted) + D-09 (hide when equal) +
 * LVIZ-05 (ideal vs scheduled side-by-side).
 *
 * The Schedule section renders iff getIdealAndScheduled(...).displaced
 * === true. When equal OR either side is null (archived / dormant),
 * the section is omitted entirely — detail sheet collapses back to
 * Phase 15 shape.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { TaskDetailSheet } from '@/components/task-detail-sheet';

// jsdom ships without window.matchMedia — TaskDetailSheet's useIsDesktop
// hook calls it in a useEffect. Stub a minimal implementation so the
// effect runs without crashing (we don't care about the desktop/mobile
// branch for these tests).
beforeAll(() => {
  if (typeof window !== 'undefined' && !window.matchMedia) {
    window.matchMedia = (q: string): MediaQueryList =>
      ({
        matches: false,
        media: q,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList;
  }
});

// archiveTask is called via the Archive button — mock to avoid PB roundtrip.
vi.mock('@/lib/actions/tasks', () => ({
  archiveTask: vi.fn(async () => ({ ok: true })),
}));

// `next/navigation` is imported by transitive deps but not directly used in
// TaskDetailSheet. Keep the test environment clean of its real implementation.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  redirect: () => {},
}));

const TZ = 'Australia/Perth';

describe('TaskDetailSheet Schedule section (Phase 16 LVIZ-05)', () => {
  // Shadcn Sheet portals to document.body — cleanup() between tests
  // prevents the portaled DOM from leaking across it blocks.
  afterEach(() => {
    cleanup();
  });

  it('renders data-testid="detail-schedule" with BOTH ideal and scheduled dates when displaced', () => {
    // Cycle task: created 2026-03-01, frequency=14, lastCompletion
    // 2026-04-10 → natural ideal = 2026-04-24. next_due_smoothed =
    // 2026-04-27 → displaced by 3 days.
    render(
      <TaskDetailSheet
        open={true}
        onOpenChange={() => {}}
        task={{
          id: 't1',
          name: 'Shifted cycle task',
          created: '2026-03-01T00:00:00Z',
          frequency_days: 14,
          schedule_mode: 'cycle',
          anchor_date: null,
          active_from_month: null,
          active_to_month: null,
          preferred_days: null,
          next_due_smoothed: '2026-04-27T00:00:00Z',
          due_date: null,
          notes: '',
        }}
        recentCompletions={[]}
        timezone={TZ}
        homeId="home-1"
        onComplete={() => {}}
        lastCompletion={{ completed_at: '2026-04-10T00:00:00Z' }}
      />,
    );

    // Shadcn Sheet portals to document.body — query from there.
    const schedule = document.body.querySelector(
      '[data-testid="detail-schedule"]',
    );
    expect(schedule).toBeTruthy();
    const txt = schedule!.textContent ?? '';
    // Ideal: Apr 24 2026; Scheduled: Apr 27 2026 (Perth tz).
    expect(txt).toMatch(/Apr 24, 2026/);
    expect(txt).toMatch(/Apr 27, 2026/);
    // "Shifted by N days to smooth" note (LVIZ-05 copy lock).
    expect(txt).toMatch(/smooth/i);
    expect(txt).toMatch(/3 days/);
  });

  it('does NOT render the Schedule section when ideal === scheduled (D-09)', () => {
    // Same task, but next_due_smoothed matches the natural date
    // exactly → displaced=false → section hidden.
    render(
      <TaskDetailSheet
        open={true}
        onOpenChange={() => {}}
        task={{
          id: 't2',
          name: 'Unshifted cycle task',
          created: '2026-03-01T00:00:00Z',
          frequency_days: 14,
          schedule_mode: 'cycle',
          anchor_date: null,
          active_from_month: null,
          active_to_month: null,
          preferred_days: null,
          next_due_smoothed: '2026-04-24T00:00:00Z',
          due_date: null,
          notes: '',
        }}
        recentCompletions={[]}
        timezone={TZ}
        homeId="home-1"
        onComplete={() => {}}
        lastCompletion={{ completed_at: '2026-04-10T00:00:00Z' }}
      />,
    );

    expect(
      document.body.querySelector('[data-testid="detail-schedule"]'),
    ).toBeNull();
  });

  it('does NOT render the Schedule section when scheduled is null (archived → null both sides)', () => {
    // TaskDetailSheet gates on task presence, so pass a non-null task
    // but mark it archived via the Task shape's archived-less interface.
    // Since the Schedule section uses getIdealAndScheduled internally and
    // a completed OOFT (lastCompletion present + frequency_days=null) also
    // yields null, exercise that path — scheduled=null → displaced=false.
    render(
      <TaskDetailSheet
        open={true}
        onOpenChange={() => {}}
        task={{
          id: 't3',
          name: 'Completed OOFT',
          created: '2026-03-01T00:00:00Z',
          frequency_days: null,
          schedule_mode: 'cycle',
          anchor_date: null,
          active_from_month: null,
          active_to_month: null,
          preferred_days: null,
          next_due_smoothed: null,
          due_date: '2026-05-01T00:00:00Z',
          notes: '',
        }}
        recentCompletions={[]}
        timezone={TZ}
        homeId="home-1"
        onComplete={() => {}}
        lastCompletion={{ completed_at: '2026-04-15T00:00:00Z' }}
      />,
    );

    expect(
      document.body.querySelector('[data-testid="detail-schedule"]'),
    ).toBeNull();
  });
});
