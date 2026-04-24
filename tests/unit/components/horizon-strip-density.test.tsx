// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep

/**
 * Phase 16 Plan 01 Task 2 — HorizonStrip density tint tests (RED gate).
 *
 * Covers D-01 (3-step tint bg-primary/{10,30,50}) + D-03 (empty month =
 * no tint) + LVIZ-01 (density-by-count).
 *
 * The plan replaces the old 3-dot render with the density tint; the
 * "dots removed" invariant is locked by asserting the old selector
 * `span.size-1\\.5.rounded-full.bg-primary` no longer exists.
 */

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { HorizonStrip } from '@/components/horizon-strip';
import type { ClassifiedTask } from '@/lib/band-classification';

const NOW = new Date('2026-04-20T12:00:00Z');
const TZ = 'UTC';

const mkTask = (id: string, nextDue: Date): ClassifiedTask =>
  ({
    id,
    created: '2026-01-01T00:00:00Z',
    archived: false,
    frequency_days: 30,
    schedule_mode: 'cycle',
    anchor_date: null,
    nextDue,
    daysDelta: 30,
    name: `Task ${id}`,
  }) as ClassifiedTask & { name: string };

// Build a deliberate density distribution:
//   May (2026-05): 1 task — ratio 1/7 ≈ 0.14 → bg-primary/10
//   June (2026-06): 2 tasks — ratio 2/7 ≈ 0.29 → bg-primary/10
//   July (2026-07): 7 tasks (MAX) — ratio 1.0 → bg-primary/50
//   April (2026-04, current month): 0 tasks — no tint
//   August+ : 0 tasks — no tint
function buildDistribution(): ClassifiedTask[] {
  const tasks: ClassifiedTask[] = [];
  tasks.push(mkTask('m1', new Date('2026-05-15T00:00:00Z')));
  tasks.push(mkTask('j1', new Date('2026-06-05T00:00:00Z')));
  tasks.push(mkTask('j2', new Date('2026-06-20T00:00:00Z')));
  for (let i = 0; i < 7; i++) {
    tasks.push(
      mkTask(`jul${i}`, new Date(`2026-07-${String(i + 2).padStart(2, '0')}T00:00:00Z`)),
    );
  }
  return tasks;
}

describe('HorizonStrip density tint (Phase 16 LVIZ-01, D-01, D-03)', () => {
  it('does NOT apply bg-primary tint to a month cell with 0 tasks (D-03 empty = no tint)', () => {
    const tasks = buildDistribution();
    const { container } = render(
      <HorizonStrip tasks={tasks} now={NOW} timezone={TZ} />,
    );
    // April is current month — our distribution puts 0 tasks there.
    const aprBtn = container.querySelector(
      'button[data-month-key="2026-04"]',
    );
    expect(aprBtn).toBeTruthy();
    const cls = aprBtn!.getAttribute('class') ?? '';
    // None of the three tint classes should appear on the empty cell.
    expect(cls).not.toMatch(/bg-primary\/10\b/);
    expect(cls).not.toMatch(/bg-primary\/30\b/);
    expect(cls).not.toMatch(/bg-primary\/50\b/);
  });

  it('applies bg-primary/10 for low-density months (ratio ≤ 0.33)', () => {
    const tasks = buildDistribution();
    const { container } = render(
      <HorizonStrip tasks={tasks} now={NOW} timezone={TZ} />,
    );
    // May: 1/7 = 0.14 → bg-primary/10
    const mayBtn = container.querySelector(
      'button[data-month-key="2026-05"]',
    );
    expect(mayBtn).toBeTruthy();
    expect(mayBtn!.getAttribute('class') ?? '').toMatch(/bg-primary\/10\b/);

    // June: 2/7 = 0.29 → still bg-primary/10 (≤ 0.33 threshold).
    const junBtn = container.querySelector(
      'button[data-month-key="2026-06"]',
    );
    expect(junBtn).toBeTruthy();
    expect(junBtn!.getAttribute('class') ?? '').toMatch(/bg-primary\/10\b/);
  });

  it('applies bg-primary/50 for the max-density month (ratio = 1.0)', () => {
    const tasks = buildDistribution();
    const { container } = render(
      <HorizonStrip tasks={tasks} now={NOW} timezone={TZ} />,
    );
    // July: 7/7 = 1.0 → bg-primary/50
    const julBtn = container.querySelector(
      'button[data-month-key="2026-07"]',
    );
    expect(julBtn).toBeTruthy();
    expect(julBtn!.getAttribute('class') ?? '').toMatch(/bg-primary\/50\b/);
  });

  it('removes the legacy 3-dot render from the horizon cells (D-01 replaces dots with tint)', () => {
    const tasks = buildDistribution();
    const { container } = render(
      <HorizonStrip tasks={tasks} now={NOW} timezone={TZ} />,
    );
    // Old render emitted <span class="size-1.5 rounded-full bg-primary"/>
    // per month for up to 3 tasks. After Phase 16 it must be gone.
    const oldDots = container.querySelectorAll(
      'span.size-1\\.5.rounded-full.bg-primary',
    );
    expect(oldDots.length).toBe(0);
  });

  it('applies bg-primary/30 at the mid-density tier (0.33 < ratio ≤ 0.66)', () => {
    // Build a distribution with a true mid-tier month: counts {may: 1,
    // jun: 5, jul: 10}. Max = 10. May = 0.1 → /10, Jun = 0.5 → /30,
    // Jul = 1.0 → /50.
    const tasks: ClassifiedTask[] = [];
    tasks.push(mkTask('m1', new Date('2026-05-15T00:00:00Z')));
    for (let i = 0; i < 5; i++) {
      tasks.push(
        mkTask(`j${i}`, new Date(`2026-06-${String(i + 2).padStart(2, '0')}T00:00:00Z`)),
      );
    }
    for (let i = 0; i < 10; i++) {
      tasks.push(
        mkTask(`jul${i}`, new Date(`2026-07-${String(i + 2).padStart(2, '0')}T00:00:00Z`)),
      );
    }
    const { container } = render(
      <HorizonStrip tasks={tasks} now={NOW} timezone={TZ} />,
    );
    const junBtn = container.querySelector(
      'button[data-month-key="2026-06"]',
    );
    expect(junBtn).toBeTruthy();
    expect(junBtn!.getAttribute('class') ?? '').toMatch(/bg-primary\/30\b/);
  });
});
