import { computeAreaCoverage } from '@/lib/area-coverage';
import type { Task } from '@/lib/task-scheduling';
import type { CompletionRecord } from '@/lib/completions';

/**
 * Area-hit-100% celebration detector (06-01 Task 2, D-13, GAME-04).
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
  now: Date,
): boolean {
  if (tasksInArea.length === 0) return false;
  const before = computeAreaCoverage(tasksInArea, latestBefore, now);
  const after = computeAreaCoverage(tasksInArea, latestAfter, now);
  return before < 1.0 && after === 1.0;
}
