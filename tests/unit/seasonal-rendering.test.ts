// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep

/**
 * Phase 14 Plan 02 (SEAS-06, D-07..D-10) — classifyDormantTasks pure
 * helper unit tests.
 *
 * Contract:
 *   - Year-round (no window) tasks NEVER appear in the dormant result.
 *   - Seasonal tasks whose current-month-in-home-tz falls inside
 *     [active_from_month..active_to_month] (wrap-aware) are NOT dormant.
 *   - Seasonal tasks whose current month falls OUTSIDE the window
 *     ARE dormant, and the returned entry carries a precomputed
 *     nextOpenDate equal to nextWindowOpenDate(now, from, to, tz).
 *   - Archived tasks are EXCLUDED even if they would otherwise be dormant.
 *   - Result is sorted ASC by nextOpenDate (soonest wake-up first).
 *
 * Reference fixture: now = 2026-07-15T12:00:00Z, tz = 'Australia/Perth'.
 * Perth is UTC+08 with no DST, so local midnight on Oct 1 2026 is
 * Sep 30 2026 16:00 UTC.
 */

import { describe, it, expect } from 'vitest';
import { classifyDormantTasks } from '@/lib/seasonal-rendering';
import type { Task } from '@/lib/task-scheduling';

type TestTask = Task & { name: string; area_name?: string };

const PERTH = 'Australia/Perth';
const NOW = new Date('2026-07-15T12:00:00Z');
// Perth midnight Oct 1 2026 in UTC:
const PERTH_OCT_1_2026_UTC_ISO = '2026-09-30T16:00:00.000Z';

function makeTask(overrides: Partial<TestTask>): TestTask {
  return {
    id: overrides.id ?? 't-test',
    name: overrides.name ?? 'Test task',
    created: overrides.created ?? '2026-01-01T00:00:00.000Z',
    archived: overrides.archived ?? false,
    frequency_days: overrides.frequency_days ?? 30,
    schedule_mode: overrides.schedule_mode ?? 'cycle',
    anchor_date: overrides.anchor_date ?? null,
    active_from_month: overrides.active_from_month ?? null,
    active_to_month: overrides.active_to_month ?? null,
    area_name: overrides.area_name,
  };
}

describe('classifyDormantTasks (Phase 14 SEAS-06)', () => {
  it('year-round task (no window) is never dormant', () => {
    const tasks: TestTask[] = [
      makeTask({
        id: 't-yearround',
        name: 'Wipe benches',
        active_from_month: null,
        active_to_month: null,
      }),
    ];
    const result = classifyDormantTasks(tasks, NOW, PERTH);
    expect(result).toHaveLength(0);
  });

  it('seasonal task in-window now is not dormant', () => {
    // Apr-Sep covers July → in season.
    const tasks: TestTask[] = [
      makeTask({
        id: 't-apr-sep',
        name: 'Mow lawn (warm)',
        active_from_month: 4,
        active_to_month: 9,
      }),
    ];
    const result = classifyDormantTasks(tasks, NOW, PERTH);
    expect(result).toHaveLength(0);
  });

  it('seasonal task out-of-window returns 1 entry with correct nextOpenDate', () => {
    // Oct-Mar is dormant in July → next wake-up = Oct 1 Perth.
    const tasks: TestTask[] = [
      makeTask({
        id: 't-oct-mar',
        name: 'Service AC',
        active_from_month: 10,
        active_to_month: 3,
        area_name: 'Whole Home',
      }),
    ];
    const result = classifyDormantTasks(tasks, NOW, PERTH);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('t-oct-mar');
    expect(result[0].name).toBe('Service AC');
    expect(result[0].area_name).toBe('Whole Home');
    expect(result[0].nextOpenDate.toISOString()).toBe(PERTH_OCT_1_2026_UTC_ISO);
  });

  it('archived dormant-shape task is excluded from the result', () => {
    const tasks: TestTask[] = [
      makeTask({
        id: 't-archived',
        name: 'Old seasonal',
        active_from_month: 10,
        active_to_month: 3,
        archived: true,
      }),
    ];
    const result = classifyDormantTasks(tasks, NOW, PERTH);
    expect(result).toHaveLength(0);
  });

  it('sorts results ASC by nextOpenDate (soonest wake-up first)', () => {
    // Two dormant tasks: Oct-Mar wakes Oct 1 2026; Sep-Oct... wait, need one
    // later. Aug-Aug would be in-window July? No — Aug is month 8, July is 7,
    // so Aug-only is dormant in July. Next wake-up = Aug 1 2026. Earlier
    // than Oct 1 2026. Perfect.
    const tasks: TestTask[] = [
      makeTask({
        id: 't-later-wake',
        name: 'Later (Oct-Mar)',
        active_from_month: 10,
        active_to_month: 3,
      }),
      makeTask({
        id: 't-sooner-wake',
        name: 'Sooner (Aug-Aug)',
        active_from_month: 8,
        active_to_month: 8,
      }),
    ];
    const result = classifyDormantTasks(tasks, NOW, PERTH);
    expect(result).toHaveLength(2);
    // Sooner (Aug 1 2026) first, then Later (Oct 1 2026).
    expect(result[0].id).toBe('t-sooner-wake');
    expect(result[1].id).toBe('t-later-wake');
    expect(
      result[0].nextOpenDate.getTime() < result[1].nextOpenDate.getTime(),
    ).toBe(true);
  });
});
