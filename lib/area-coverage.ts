import { computeCoverage } from '@/lib/coverage';
import { computeTaskBands } from '@/lib/band-classification';
import type { Task } from '@/lib/task-scheduling';
import type { CompletionRecord } from '@/lib/completions';
import type { Override } from '@/lib/schedule-overrides';

/**
 * Per-area coverage and band counts (05-01 Task 2, D-04 + AREA-V-01/02;
 * 10-02 Plan threads the override Map through the wrappers).
 *
 * THIN WRAPPERS over the Phase 3 algorithms — do NOT re-implement. The
 * By-Area grid in 05-02 iterates over the home's areas and calls each
 * function once per area (with the pre-filtered `tasksInArea` slice).
 *
 * Empty-home invariant (D-06) flows through unchanged — an area with zero
 * non-archived tasks reports coverage=1.0 and counts {0,0,0}. The UI can
 * layer an "Add a task" CTA on top.
 *
 * Naming note: `computeTaskBands` returns `{overdue, thisWeek, horizon}`
 * using the Phase 3 terminology. REQUIREMENTS.md AREA-V-01 surfaces this
 * to users as "upcoming" — this wrapper renames the projection so the
 * By-Area card reads correctly without touching the band-classification
 * internals.
 *
 * Override wiring (Phase 10, D-06 / D-08 / D-09): the `overridesByTask`
 * Map flows through to `computeCoverage` / `computeTaskBands`; each
 * consumes `.get(task.id)` per-iteration. Passing an empty Map yields
 * byte-identical v1.0 behavior.
 */

export function computeAreaCoverage(
  tasksInArea: Task[],
  latestByTask: Map<string, CompletionRecord>,
  overridesByTask: Map<string, Override>,
  now: Date,
): number {
  return computeCoverage(tasksInArea, latestByTask, overridesByTask, now);
}

export type AreaCounts = {
  overdue: number;
  thisWeek: number;
  upcoming: number;
};

export function computeAreaCounts(
  tasksInArea: Task[],
  latestByTask: Map<string, CompletionRecord>,
  overridesByTask: Map<string, Override>,
  now: Date,
  timezone: string,
): AreaCounts {
  const bands = computeTaskBands(
    tasksInArea,
    latestByTask,
    overridesByTask,
    now,
    timezone,
  );
  return {
    overdue: bands.overdue.length,
    thisWeek: bands.thisWeek.length,
    upcoming: bands.horizon.length,
  };
}
