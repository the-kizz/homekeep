import { computeAreaCoverage } from '@/lib/area-coverage';
import type { Task } from '@/lib/task-scheduling';
import type { CompletionRecord } from '@/lib/completions';
import type { Override } from '@/lib/schedule-overrides';

/**
 * Area-hit-100% celebration detector (06-01 Task 2, D-13, GAME-04;
 * 10-02 Plan threads the override Map through the coverage wrapper).
 *
 * PURE predicate: returns `true` IFF an area crossed from strictly-below
 * 100% to EXACTLY 100% over the given before→after snapshot.
 *
 * Semantics (per CONTEXT.md <specifics>):
 *   "Celebration: one-time trigger (per area per 100%-crossing), not
 *   every completion once at 100%"
 *
 * i.e. this function is the guard that keeps the confetti from firing
 * over and over when the user re-completes tasks in an already-healthy
 * area. Returns true ONLY on the discrete `<100 → 100` transition.
 *
 * Empty-area edge case: zero tasks → coverage = 1.0 per the empty-home
 * invariant (D-06). Since `before == 1.0` already, the predicate returns
 * false — there is no crossover and we shouldn't celebrate "staying" at
 * 100% from a zero-task baseline.
 *
 * Override wiring (Phase 10): the same `overridesByTask` Map is used for
 * both snapshots — the only thing that changes between before/after is the
 * `latestByTask` map (a new completion was just written). Override state
 * is stable across the two reads (Plan 10-03 will consume overrides in the
 * same atomic batch, so by the time this predicate runs after the write,
 * the just-completed task's override — if any — has `consumed_at` set and
 * computeNextDue's D-10 guard falls through). For Plan 10-02's scope, the
 * caller passes the Map it already fetched for its main coverage render.
 *
 * Caller wiring (Wave 2): completeTaskAction computes the
 * `latestByTask` map once before the write and once after, passes both
 * to this function per area, and returns `{celebration:'area-100'}` in
 * the server-action response. The client's completion handler reads the
 * flag and triggers the animation.
 */
export function detectAreaCelebration(
  tasksInArea: Task[],
  latestBefore: Map<string, CompletionRecord>,
  latestAfter: Map<string, CompletionRecord>,
  overridesByTask: Map<string, Override>,
  now: Date,
): boolean {
  if (tasksInArea.length === 0) return false;
  const before = computeAreaCoverage(
    tasksInArea,
    latestBefore,
    overridesByTask,
    now,
  );
  const after = computeAreaCoverage(
    tasksInArea,
    latestAfter,
    overridesByTask,
    now,
  );
  return before < 1.0 && after === 1.0;
}
