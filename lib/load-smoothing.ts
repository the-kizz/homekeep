// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/conroyke56/homekeep
import { addDays, differenceInDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import {
  computeNextDue,
  effectivePreferredDays,
  isOoftTask,
  narrowToPreferredDays,
  type Completion,
  type Task,
} from '@/lib/task-scheduling';
import type { Override } from '@/lib/schedule-overrides';
import type { CompletionRecord } from '@/lib/completions';

/**
 * Phase 12 (12-01 Plan, LOAD-03, LOAD-14): pure helpers for load-
 * smoothed task placement.
 *
 * PURE module: no I/O, no Date.now reads, no mutation of inputs.
 * Composable from both server actions (completeTaskAction Phase 12
 * Wave 3; createTaskAction Phase 13 TCSEM) and test harnesses
 * (100-task perf benchmark + 30-task rider 1 validation Wave 4).
 *
 * Two exports:
 *   - placeNextDue(task, lastCompletion, load, now, options): Date
 *       Forward-only smoother (D-07) — returns the chosen date for
 *       the argument task only; never mutates siblings or inputs.
 *   - computeHouseholdLoad(tasks, latestByTask, overridesByTask,
 *                         now, windowDays?, timezone?): Map<string, number>
 *       Per-day load Map keyed by ISO date in home tz.
 *
 * Plus a shared helper `isoDateKey(d, tz)` used by BOTH functions
 * to ensure identical Map key format on write + lookup (Pitfall 7).
 */

export type PlaceOptions = {
  preferredDays?: 'any' | 'weekend' | 'weekday';
  tolerance?: number; // override default min(0.15*freq, 5)
  timezone?: string; // home IANA tz for load Map key alignment
};

/**
 * Shared helper — used by BOTH placeNextDue (scoring lookup) and
 * computeHouseholdLoad (Map key build) to ensure same ISO-date
 * format on write + read (Pitfall 7 — tz mismatch between Map key
 * and candidate lookup silently drops all scores to 0).
 *
 * Returns `YYYY-MM-DD` string in the given IANA timezone.
 */
export function isoDateKey(d: Date, timezone: string): string {
  return formatInTimeZone(d, timezone, 'yyyy-MM-dd');
}

/**
 * Place the next due date for `task` given the current household load map.
 *
 * Pure. Returns a UTC-equivalent Date representing home-tz midnight on the
 * chosen ISO date. Caller writes the returned value as task.next_due_smoothed
 * (via atomic batch in completeTaskAction Plan 12-03; via createTaskAction
 * in Phase 13 TCSEM).
 *
 * Contract (LOAD-11 forward-only): returns the chosen date ONLY. Does not
 * mutate `task`, does not mutate `householdLoad`, does not read any other
 * task's record. Siblings don't re-smooth until their own completion event.
 *
 * Algorithm (CONTEXT.md D-06):
 *   1. naturalIdeal = lastCompletion.completed_at + frequency_days
 *                     (OR task.created + frequency_days if no completion)
 *   2. tolerance   = options.tolerance ?? min(Math.floor(0.15 * freq), 5)
 *                    LOAD-04 — Math.floor (not round) for integer-days.
 *                    Rider 1 validation may widen cap to 14.
 *   3. candidates  = [naturalIdeal - tolerance .. naturalIdeal + tolerance]
 *                    step 1 day, inclusive, total = 2*tolerance + 1 dates
 *   4. filtered    = narrowToPreferredDays(candidates, effectivePref)
 *   5. if filtered.empty (non-'any' pref):
 *        widen forward +1..+6 from naturalIdeal + tolerance
 *        (PREF-03 — Phase 11 narrow returns empty; placeNextDue retries)
 *   6. scored      = filtered.map(d => ({d, score: load.get(iso(d, tz)) ?? 0}))
 *   7. pick via tiebreakers (D-08 fully-ordered chain):
 *        a. lowest score wins
 *        b. among ties, smallest |d - naturalIdeal| wins (closest-to-ideal)
 *        c. among ties, earliest date wins (guarantees determinism)
 *
 * Invariants (defense in depth):
 *   - task.schedule_mode === 'anchored' → throw (LOAD-06: anchored bypasses
 *     smoothing entirely; caller must guard).
 *   - isOoftTask(task) → throw (LOAD-09: OOFT contributes to load map but
 *     never has next_due_smoothed written).
 */
export function placeNextDue(
  task: Task,
  lastCompletion: Completion | null,
  householdLoad: Map<string, number>,
  now: Date,
  options: PlaceOptions = {},
): Date {
  // Invariant guards (defense in depth — callers already filter).
  if (task.schedule_mode === 'anchored') {
    throw new Error('placeNextDue: anchored tasks bypass smoothing (LOAD-06)');
  }
  if (isOoftTask(task)) {
    throw new Error('placeNextDue: OOFT tasks bypass smoothing (LOAD-09)');
  }

  // `now` is accepted for signature symmetry with computeHouseholdLoad and
  // forward-compat with future "don't place earlier than now" guards (T-12-04
  // defense — currently handled implicitly via naturalIdeal ≥ lastCompletion
  // + freq which is ≥ now by construction for non-overdue tasks).
  void now;

  // frequency_days is a positive integer here — OOFT path short-circuited
  // above. TS flow analysis can't see through isOoftTask, so we narrow
  // manually via `as number`.
  const freq = task.frequency_days as number;

  const baseIso = lastCompletion?.completed_at ?? task.created;
  const naturalIdeal = addDays(new Date(baseIso), freq);

  // Step 2: tolerance = min(Math.floor(0.15 * freq), 5). Rider 1 may
  // widen the cap to 14 post-validation (see 12-RESEARCH §Rider 1
  // Validation Harness). Math.floor NOT Math.round — LOAD-04 integer-
  // days semantics (freq=7 → 1, not 2).
  const tolerance =
    options.tolerance ?? Math.min(Math.floor(0.15 * freq), 5);

  // Step 3: generate candidate set (2*tolerance + 1 dates, inclusive).
  const candidates: Date[] = [];
  for (let offset = -tolerance; offset <= tolerance; offset++) {
    candidates.push(addDays(naturalIdeal, offset));
  }

  // Step 4: PREF narrow (Phase 11 helper reused).
  const pref = options.preferredDays ?? effectivePreferredDays(task);
  let filtered = narrowToPreferredDays(candidates, pref);

  // Step 5: widen forward +1..+6 if PREF emptied the window (PREF-03).
  // Walk one day at a time from (naturalIdeal + tolerance + widen) — the
  // day immediately after the tolerance window's right edge — until we
  // find a match or exhaust +6.
  if (filtered.length === 0 && pref !== 'any') {
    for (let widen = 1; widen <= 6 && filtered.length === 0; widen++) {
      filtered = narrowToPreferredDays(
        [addDays(naturalIdeal, tolerance + widen)],
        pref,
      );
    }
    // Defensive: if after +6 still empty (shouldn't happen — within any
    // 7-day window there's always at least one weekday AND one weekend
    // day), fall back to naturalIdeal itself.
    if (filtered.length === 0) filtered = [naturalIdeal];
  }

  // Step 6: score each candidate via Map lookup.
  const tz = options.timezone ?? 'UTC';
  const scored = filtered.map((d) => ({
    date: d,
    score: householdLoad.get(isoDateKey(d, tz)) ?? 0,
    distanceFromIdeal: Math.abs(differenceInDays(d, naturalIdeal)),
    time: d.getTime(),
  }));

  // Step 7: tiebreakers (D-08 — fully ordered chain).
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      a.distanceFromIdeal - b.distanceFromIdeal ||
      a.time - b.time,
  );

  return scored[0].date;
}

/**
 * Build a per-day household load map (LOAD-14, D-09).
 *
 * Input: array of tasks already fetched via single PB query (D-11) plus
 * per-task override + completion lookups (Maps for O(1) access).
 *
 * Output: Map<ISODate-in-home-tz, count> where count is the number of
 * tasks whose effective next-due falls on that date.
 *
 * "Effective next-due" per D-10 contribution rules:
 *   - archived         → SKIP (excluded from map)
 *   - dormant seasonal → SKIP (prior in-season completion → null next_due)
 *   - OOFT             → due_date (LOAD-09)
 *   - snoozed          → override.snooze_until (LOAD-08 — via computeNextDue
 *                        override branch)
 *   - anchored         → natural anchored next_due (D-10 — LOAD-visible,
 *                        just not smoothed)
 *   - cycle + smoothed → next_due_smoothed (computeNextDue reads it in
 *                        Wave 2; this map reflects the current effective
 *                        state)
 *   - cycle + no smooth→ natural next_due (v1.0 holdover fallback)
 *
 * All of the above reduce cleanly to: `computeNextDue(task, last, now,
 * override, tz)`. We call it for every non-archived task and accumulate
 * on the returned date (or skip if null). Prior versions of this function
 * carried a local dormant-seasonal pre-filter as a cheap shortcut, but it
 * was too aggressive — it dropped prior-season wake-up tasks (e.g. seasonal
 * task completed last September, now June, active Oct-Mar) whose
 * computeNextDue-reported wake-up date (next Oct 1) falls inside windowEnd
 * and should contribute to load. computeNextDue already distinguishes
 * same-season dormant (returns null) from prior-season wake-up (returns
 * nextWindowOpenDate) via the `lastInPriorSeason` gate, so delegating to
 * it is both correct and simpler (REVIEW-12 WR-01).
 *
 * windowDays: bound iteration — we DON'T include tasks whose effective
 * next-due is >windowDays out (they don't interact with placements in
 * the current tolerance window). Default 120 covers annual tasks with
 * ±5 tolerance (the 365-day task's local placement window is
 * naturalIdeal±5d; tasks due >120d out can't be in *this* placement's
 * scoring window). Phase 17 REBAL may want 365.
 *
 * Pure: does not mutate inputs. Task list is iterated in order received;
 * Map insertion order for keys follows iteration order.
 */
export function computeHouseholdLoad(
  tasks: Task[],
  latestByTask: Map<string, CompletionRecord>,
  overridesByTask: Map<string, Override>,
  now: Date,
  windowDays: number = 120,
  timezone: string = 'UTC',
): Map<string, number> {
  const load = new Map<string, number>();
  const windowEnd = addDays(now, windowDays);

  for (const task of tasks) {
    if (task.archived) continue;

    // Dormant-seasonal pre-filter REMOVED (REVIEW-12 WR-01). The previous
    // shortcut skipped any out-of-window task with any prior completion,
    // but that under-counted prior-season wake-ups whose wake-up date
    // (next from-window open) legitimately falls inside windowEnd. The
    // seasonal block inside computeNextDue already gates dormant-vs-
    // wake-up via lastInPriorSeason (same-season → null; prior-season →
    // nextWindowOpenDate). Delegating to computeNextDue is both correct
    // and simpler — the only cost is a handful of extra calls per
    // computeHouseholdLoad invocation (windowDays+task count are the
    // real perf guards, not this shortcut).
    const last = latestByTask.get(task.id) ?? null;
    // CompletionRecord has more fields than Completion; pass the subset.
    const lastCompletion: Completion | null = last
      ? { completed_at: last.completed_at }
      : null;
    const override = overridesByTask.get(task.id);
    const due = computeNextDue(task, lastCompletion, now, override, timezone);
    if (!due) continue;
    if (due > windowEnd) continue; // windowDays bound per D-11 / Pitfall 8

    const key = isoDateKey(due, timezone);
    load.set(key, (load.get(key) ?? 0) + 1);
  }
  return load;
}
