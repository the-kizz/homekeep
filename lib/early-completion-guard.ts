/**
 * Early-completion guard (03-01 Plan, Pattern 9, D-07, COMP-02).
 *
 * PURE function: takes `now: Date` as a parameter (no clock reads).
 *
 * Returns `true` when the elapsed time since the last completion is
 * STRICTLY less than 25% of the task's frequency_days — i.e. the user
 * is marking done "too soon" after a prior completion and might have
 * double-tapped.
 *
 * Design decisions (from 03-CONTEXT D-07, refined in v1.2.1 PATCH2-07):
 *   - **No prior completion → NO warn (v1.2.1 flip).** A task that has
 *     never been completed has no baseline to be "too soon" relative to.
 *     The previous behavior referenced `task.created`, which warned every
 *     first-completion on a fresh task — a noisy false positive for the
 *     common case of "I just added this task and I'm doing it today."
 *     See GitHub issue thread / user feedback 2026-04-24.
 *   - Anchored mode does NOT affect the guard — it's about "how long
 *     since the user last actually did it", not about anchor dates.
 *     A quarterly anchored task completed 3 days ago still triggers
 *     the guard if user taps complete again today.
 *   - Exactly at the 25% boundary: NO warn (strict less-than). This
 *     matches D-07's "strict" qualifier; the server action's acceptance
 *     test in tests/unit/early-completion-guard.test.ts includes the
 *     exact-boundary case.
 */
export function shouldWarnEarly(
  task: { created: string; frequency_days: number },
  lastCompletion: { completed_at: string } | null,
  now: Date,
): boolean {
  // v1.2.1 PATCH2-07: never-completed tasks bypass the guard entirely.
  // The task parameter is retained for API compatibility (and in case
  // a future rule wants to read `created`) but is not used in the
  // common path.
  if (lastCompletion === null) return false;
  const reference = new Date(lastCompletion.completed_at);
  const elapsedDays = (now.getTime() - reference.getTime()) / 86400000;
  const threshold = 0.25 * task.frequency_days;
  return elapsedDays < threshold;
}
