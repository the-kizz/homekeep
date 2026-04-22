// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/conroyke56/homekeep
import { addDays, differenceInDays } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import type { Override } from '@/lib/schedule-overrides';

/**
 * Task scheduling — next-due computation (02-05 Plan, D-13 + SPEC §8.5;
 * 10-02 Plan adds the override branch per D-06 + D-10; 11-02 Plan adds
 * seasonal-dormant / seasonal-wakeup / OOFT branches per D-05, D-12, D-16,
 * D-17).
 *
 * PURE module: no I/O, no wall-clock Date construction, no Date.now. Every
 * call is deterministic given its arguments, which makes the edge-case matrix in
 * tests/unit/task-scheduling.test.ts straightforward to cover.
 *
 * Timezone posture: all Dates here are UTC-equivalent instants. Storage in
 * PocketBase is UTC ISO strings. Rendering in the home's IANA timezone is a
 * *separate concern* handled by components/next-due-display.tsx via
 * date-fns-tz.formatInTimeZone — NEVER do date math in a non-UTC zone.
 * date-fns' addDays / differenceInDays operate on the UTC epoch and are
 * DST-safe by construction (RESEARCH §Pattern: Next-Due Computation
 * timezone handling note line 1217).
 *
 * Phase 11 timezone posture exception: the seasonal branches extract a
 * calendar month in home timezone (via `toZonedTime`) because "Is task
 * X dormant this month?" is a home-timezone question. When the caller
 * omits the 5th `timezone?` param (default undefined), the helpers fall
 * back to UTC month extraction — acceptable per Pitfall 4 for v1.1
 * (differs from home-tz exact by at most one day at month boundaries).
 */

export type Task = {
  id: string;
  created: string; // ISO 8601 UTC
  archived: boolean;
  // Phase 11 (OOFT-01, D-02): nullable — one-off tasks carry null
  // frequency + a concrete `due_date`. Plan 11-01 widens the type only;
  // computeNextDue body still rejects null via Number.isInteger (Plan
  // 11-02 inserts the OOFT branch that short-circuits before the guard).
  frequency_days: number | null;
  schedule_mode: 'cycle' | 'anchored';
  anchor_date: string | null; // ISO 8601 UTC; must be non-null when schedule_mode === 'anchored'
  // Phase 11 extensions — all optional for v1.0 row compatibility.
  due_date?: string | null; // D-03 OOFT
  preferred_days?: 'any' | 'weekend' | 'weekday' | null; // D-07 PREF
  active_from_month?: number | null; // D-11 SEAS
  active_to_month?: number | null; // D-11 SEAS
  // Phase 12 (D-01, LOAD-01): nullable smoothed date. Populated by
  // placeNextDue via completeTaskAction's batch (Plan 12-03). v1.0
  // rows + fresh post-migration rows have null → read-time falls
  // through to natural via D-02.
  next_due_smoothed?: string | null;
};

export type Completion = {
  completed_at: string; // ISO 8601 UTC — Phase 3+; in Phase 2 this is always null.
};

/**
 * Phase 12 (LOAD-09, Phase 11 Rule-1 fix centralization):
 * OOFT marker helper. Treats both `null` (app-layer semantic) and
 * `0` (PB 0.37.1 storage-reality for a cleared NumberField) as OOFT.
 *
 * Exported to centralize the 5 shared-predicate callsites:
 *   1. computeNextDue isOoft (this file, previously inlined line 155)
 *   2. completeTaskAction freqOoft (lib/actions/completions.ts, Plan 12-03)
 *   3. placeNextDue + computeHouseholdLoad guards (lib/load-smoothing.ts, Plan 12-01)
 *   4. createTaskAction TCSEM guard (lib/actions/tasks.ts, Plan 13-01)
 *   5. batchCreateSeedTasks TCSEM loop guard (lib/actions/seed.ts, Plan 13-01)
 * Plus computeFirstIdealDate throws on OOFT (Plan 13-01 — defense in depth).
 *
 * Pure — no side effects. Per 11-03 SUMMARY §Handoff for Phase 12.
 */
export function isOoftTask(
  task: Pick<Task, 'frequency_days'>,
): boolean {
  return task.frequency_days === null || task.frequency_days === 0;
}

/**
 * Compute the next-due date for a task.
 *
 * Branch order (short-circuit precedence — D-16 after Phase 11):
 *   1. archived → null
 *   2. frequency validation — throw ONLY when frequency_days is a
 *      non-null, non-positive-integer (D-05: null is legitimate for OOFT).
 *   3. **override branch** (Phase 10, D-06 + D-10): active + unconsumed
 *      override whose `snooze_until` post-dates the last completion wins.
 *      D-17: override beats dormant seasonal (user intent > inferred
 *      dormancy).
 *   4. (Phase 12 will insert the `next_due_smoothed` LOAD branch here — D-07
 *      forward-compatibility.)
 *   5. **seasonal-dormant branch** (Phase 11, D-12 + SEAS-02): task has
 *      an active window, now is outside it, and a completion exists →
 *      return null (invisible to scheduler / coverage / band views).
 *   6. **seasonal-wakeup branch** (Phase 11, D-12 + SEAS-03): task has an
 *      active window and (no completion OR last completion in a prior
 *      season) → return nextWindowOpenDate at home-tz midnight.
 *   7. **OOFT branch** (Phase 11, D-05 + OOFT-05): frequency_days === null
 *      → return due_date when no completion, null otherwise (completed
 *      OOFT is archived in the same batch; null fall-through is defensive
 *      against races).
 *   8. cycle branch — base + frequency_days.
 *   9. anchored branch — step forward by whole cycles past `now`.
 *
 * Returns:
 *   - `null` if the task is archived or dormant-seasonal or completed-OOFT.
 *   - `new Date(override.snooze_until)` when an active unconsumed override
 *     applies (see D-10 guard below).
 *   - `nextWindowOpenDate(...)` when a seasonal task wakes up.
 *   - `new Date(task.due_date)` when an unborn OOFT task is being read.
 *   - For `cycle` mode: base = lastCompletion?.completed_at ?? task.created;
 *     next_due = base + frequency_days.
 *   - For `anchored` mode:
 *     - If the anchor is in the future, the anchor itself IS the next due.
 *     - Otherwise, step by whole frequency cycles until STRICTLY after now.
 *       We compute `cycles = floor(elapsed/freq) + 1` so that `elapsed == freq`
 *       lands two cycles out (the current cycle end IS now — we want the NEXT).
 *
 * Throws when `frequency_days` is not null and not a positive integer — this
 * is a defence in depth alongside the zod `.int().min(1).nullable()` at the
 * schema layer. Null is allowed (OOFT path).
 *
 * Parameters:
 *   @param task             The task record (non-null, member-gated).
 *   @param lastCompletion   The latest completion for this task, or `null`
 *                           when there is none.
 *   @param now              Caller-supplied wall-clock instant (keeps this
 *                           function pure; tests pass fixed Dates).
 *   @param override         Optional (Phase 10 D-06). When present AND
 *                           `!override.consumed_at` AND
 *                           `snooze_until > lastCompletion.completed_at`
 *                           (D-10 read-time filter), returns
 *                           `new Date(override.snooze_until)`. Omitting the
 *                           argument yields byte-identical v1.0 behavior.
 *
 *                           The D-10 guard is defense-in-depth: if the
 *                           atomic consumption write (Plan 10-03) ever
 *                           misses — or an admin blanks `consumed_at` back
 *                           to null after the task has been completed —
 *                           we fall through to the natural branch rather
 *                           than leaving the task "perma-snoozed" past a
 *                           real completion.
 *   @param timezone         Optional (Phase 11 A2 resolution — Option A).
 *                           IANA timezone name (e.g. 'Australia/Perth')
 *                           used by the seasonal branches to extract the
 *                           current month in home tz AND to anchor the
 *                           wake-up date to home-tz midnight. Default
 *                           `undefined` → UTC-month fallback per Pitfall 4
 *                           (close enough for v1.1; month boundaries in
 *                           non-UTC tz differ by at most 1 day). Phase 10
 *                           call-sites that omit this param preserve
 *                           byte-identical behavior (D-26 zero-churn).
 *                           Phase 12 reserves the 6th `smoothed?` slot;
 *                           no further signature churn expected in v1.1.
 *
 * Override `consumed_at` interpretation (A2 from Plan 10-01): PB 0.37.1 may
 * return `null`, `''`, or `undefined` for a fresh row with no consumed_at
 * set. The falsy check `!override.consumed_at` covers all three.
 */
export function computeNextDue(
  task: Task,
  lastCompletion: Completion | null,
  now: Date,
  override?: Override,
  timezone?: string,
): Date | null {
  if (task.archived) return null;

  // Phase 11 (D-05): frequency validation gated on OOFT-marker. OOFT tasks
  // carry `frequency_days === null` semantically, but PB 0.37.1 stores a
  // cleared NumberField as `0` on the wire (the D-02 `required: false`
  // flip on an existing required NumberField does NOT change the stored
  // value of rows that set the field to null — PB coerces to 0). Both
  // values mean "no natural cycle" and route to the OOFT branch below,
  // so the positive-integer guard skips for both. Discovered during
  // Plan 11-03 integration (Scenario 2) where an OOFT task created with
  // `frequency_days: null` round-tripped as `0` and tripped the guard
  // when computeCoverage iterated sibling tasks during completion.
  const isOoft = isOoftTask(task);
  if (!isOoft) {
    if (
      !Number.isInteger(task.frequency_days) ||
      (task.frequency_days as number) < 1
    ) {
      throw new Error(`Invalid frequency_days: ${task.frequency_days}`);
    }
  }

  // ─── Phase 10 override branch (D-06, D-10 read-time filter) ─────────
  // Override wins when:
  //   (a) override is present
  //   (b) override.consumed_at is falsy (null, '', or undefined per A2)
  //   (c) snooze_until > lastCompletion.completed_at
  //       (D-10 read-time filter — defense in depth against missed
  //        atomic-consumption writes / admin-UI consumed_at reset)
  //
  // When (c) fails, the snooze is stale (completion landed after the
  // snooze date); fall through to the natural branch. Without (c),
  // a post-completion race that missed the consumption write would
  // leave the task "perma-snoozed" forever — user would complete
  // daily and still see it as "due next month". NEVER do that.
  //
  // Phase 11 D-17: override precedence beats seasonal dormancy. The
  // override branch intentionally runs BEFORE the seasonal-dormant
  // branch below — if a user snoozes a dormant-seasonal task (rare
  // edge), user intent wins.
  //
  // Phase 12 will insert the `next_due_smoothed` branch BETWEEN this
  // override branch and the seasonal/OOFT/cycle branches (D-07
  // forward-compatibility).
  if (override && !override.consumed_at) {
    const snoozeUntil = new Date(override.snooze_until);
    const lastCompletedAt = lastCompletion
      ? new Date(lastCompletion.completed_at)
      : null;
    if (!lastCompletedAt || snoozeUntil > lastCompletedAt) {
      return snoozeUntil;
    }
    // else: stale override; fall through to cycle/anchored natural branch.
  }

  // ─── Phase 12 smoothed branch (D-02, LOAD-02, LOAD-06, LOAD-07) ───
  // The LOAD smoother wrote `next_due_smoothed` on the previous
  // completion's atomic batch (Plan 12-03). Branch precedence per
  // D-02: this fires AFTER the override branch and BEFORE the Phase
  // 11 seasonal block.
  //
  // LOAD-06 anchored bypass (D-03): anchored-mode tasks NEVER consult
  // next_due_smoothed — byte-identical v1.0 behavior. Even if a task
  // flipped cycle → anchored mid-v1.1, a stale smoothed value is
  // ignored (the schedule_mode guard is authoritative).
  //
  // LOAD-07 seasonal-wakeup handshake (D-15): if the task has a
  // seasonal window AND is first-cycle / prior-season, DON'T
  // short-circuit here — let the Phase 11 seasonal-wakeup branch
  // below return nextWindowOpenDate. The wake-up date is a calendar
  // landmark, not a load-smoothing target. From the second cycle
  // onward (same-season, lastInPriorSeason=false), we fall through
  // to this branch normally.
  //
  // v1.0 backcompat (T-12-03): NULL next_due_smoothed falls through
  // to the Phase 11 seasonal / OOFT / cycle / anchored branches —
  // byte-identical v1.0 read behavior until the first post-upgrade
  // completion writes a smoothed date.
  //
  // T-12-07 defense: invalid stored string → new Date(s) yields
  // Invalid Date; `getTime() > 0` is false (NaN comparison), and
  // the seasonal / cycle branches still run below. No crash.
  if (
    task.schedule_mode !== 'anchored'
    && task.next_due_smoothed
  ) {
    const hasWindow =
      task.active_from_month != null && task.active_to_month != null;
    const treatAsWakeup = hasWindow && (
      !lastCompletion
      || wasInPriorSeason(
           new Date(lastCompletion.completed_at),
           task.active_from_month!,
           task.active_to_month!,
           now,
           timezone,
         )
    );
    if (!treatAsWakeup) {
      const smoothed = new Date(task.next_due_smoothed);
      if (smoothed.getTime() > 0) return smoothed;
      // Invalid Date (T-12-07) → fall through to seasonal / cycle.
    }
    // else: fall through to seasonal block — wake-up anchors to window.
  }

  // ─── Phase 11 seasonal branches (D-12) ──────────────────────────────
  // hasWindow = task is seasonal. Precompute the "prior-season" state
  // once — both the dormant and wake-up branches need it:
  //   - prior-season + dormant-month  → wake-up (return next from-open)
  //   - prior-season + in-window-now  → wake-up (return next from-open)
  //   - same-season + dormant-month   → dormant (return null)
  //   - same-season + in-window-now   → fall through to cycle branch
  //
  // Prior-season means "the last completion was in a different active
  // season instance than the current one" — either via wasInPriorSeason's
  // dormant-month short-circuit, via the A3 365-day heuristic, or via
  // no completion at all (first cycle is definitionally prior-season).
  const hasWindow =
    task.active_from_month != null && task.active_to_month != null;
  const nowMonth = timezone
    ? toZonedTime(now, timezone).getMonth() + 1
    : now.getUTCMonth() + 1;

  if (hasWindow) {
    const lastInPriorSeason = lastCompletion
      ? wasInPriorSeason(
          new Date(lastCompletion.completed_at),
          task.active_from_month!,
          task.active_to_month!,
          now,
          timezone,
        )
      : true; // no completion = treat as prior season (first cycle)

    // Seasonal-dormant (SEAS-02): only fires when the task was recently
    // active in the SAME season and now drifted out-of-window. A
    // prior-season completion indicates a wake-up, not dormancy — user
    // should see the next open date, not null.
    const inWindowNow = isInActiveWindow(
      nowMonth,
      task.active_from_month!,
      task.active_to_month!,
    );
    if (!inWindowNow && !lastInPriorSeason) {
      // Same-season dormant — task is sleeping mid-cycle.
      return null;
    }

    // Seasonal-wakeup (SEAS-03): prior-season (or first-cycle) →
    // anchor to start-of-window in home tz, regardless of whether
    // now is currently in-window (the caller still wants a concrete
    // wake-up date to render in Phase 14/15 UI).
    if (lastInPriorSeason) {
      return nextWindowOpenDate(
        now,
        task.active_from_month!,
        task.active_to_month!,
        timezone ?? 'UTC',
      );
    }
    // else: same-season in-window → fall through to cycle/anchored.
  }

  // ─── Phase 11 OOFT branch (D-05, OOFT-05) ───────────────────────────
  // OOFT marker = frequency_days null (app-layer semantic) OR 0 (PB
  // 0.37.1 storage-layer reality for a cleared NumberField — see
  // isOoft guard at top of function). Return due_date if no completion,
  // null otherwise (completed OOFT is archived by completeTaskAction's
  // batch, but race-safety returns null).
  if (isOoft) {
    if (lastCompletion) return null;
    return task.due_date ? new Date(task.due_date) : null;
  }
  // After the OOFT short-circuit, TypeScript still sees frequency_days
  // as `number | null` across branches (flow analysis can't carry the
  // null-guard through the intervening seasonal branches). Bind a local
  // so cycle + anchored branches can reference a narrowed `number`.
  // isOoft is false here, so frequency_days is a positive integer.
  const freq: number = task.frequency_days as number;

  if (task.schedule_mode === 'cycle') {
    const baseIso = lastCompletion?.completed_at ?? task.created;
    const base = new Date(baseIso);
    return addDays(base, freq);
  }

  // anchored
  const baseIso = task.anchor_date ?? task.created;
  const base = new Date(baseIso);

  // Anchor in the future: the anchor IS the next due (no cycling yet).
  if (base.getTime() > now.getTime()) return base;

  // Otherwise find the next cycle boundary strictly after `now`.
  // floor(elapsed/freq) + 1 guarantees we step past `now` even when
  // elapsed is an exact multiple of freq.
  const elapsedDays = differenceInDays(now, base);
  const cycles = Math.floor(elapsedDays / freq) + 1;
  return addDays(base, cycles * freq);
}

// ─── Phase 11 pure helpers (D-18, D-19, D-20) ───────────────────────────
// Added by Plan 11-01 Task 3. Consumed by Plan 11-02 (computeNextDue
// branch composition) and Plan 11-02 (coverage dormant filter). Pure —
// no I/O, no Date.now, no hidden wall-clock reads.

/**
 * Phase 11 (D-07): project null preferred_days → 'any'. Keeps the
 * narrowing code uniform over v1.0 rows (no preferred_days field) and
 * v1.1 rows with explicit 'any'.
 */
export function effectivePreferredDays(
  task: Pick<Task, 'preferred_days'>,
): 'any' | 'weekend' | 'weekday' {
  return task.preferred_days ?? 'any';
}

/**
 * Phase 11 (D-08, PREF-02 / PREF-04): hard narrowing constraint.
 * Returns a filtered COPY of `candidates` (never mutates input) that
 * keeps only the dates matching `pref`. 'any' returns a shallow copy.
 *
 * Weekend = getUTCDay() === 0 (Sun) || 6 (Sat). UTC-day is chosen to
 * match the module's UTC-equivalent-instant posture (see computeNextDue
 * timezone-posture JSDoc). Caller MUST pass candidates already aligned
 * to home-midnight-in-UTC if home-timezone day semantics matter.
 *
 * PREF-03 contract: empty return means the caller (Phase 12 LOAD) must
 * widen the tolerance window. This helper ONLY filters — it does NOT
 * retry, extend, or shift any dates.
 *
 * PREF-04 contract: filter → result dates are always a subset of input
 * dates → never produces an earlier date than the natural cycle.
 */
export function narrowToPreferredDays(
  candidates: Date[],
  pref: 'any' | 'weekend' | 'weekday',
): Date[] {
  if (pref === 'any') return candidates.slice();
  return candidates.filter((d) => {
    const dow = d.getUTCDay();
    const isWeekend = dow === 0 || dow === 6;
    return pref === 'weekend' ? isWeekend : !isWeekend;
  });
}

/**
 * Phase 11 (D-13, SEAS-04): wrap-aware active-window check. Pure fn
 * over month integers (D-20) — caller extracts month from a Date in
 * home tz via toZonedTime(now, tz).getMonth() + 1.
 *
 * Invariants:
 *   - monthOneIndexed, from, to all in 1..12 (caller enforces).
 *   - from === to → single-month active window (e.g. active Jan only).
 *   - from > to → wrap window (e.g. Oct..Mar returns true for Dec).
 *   - Either from or to null/undefined → returns true (degenerate;
 *     caller's hasWindow check should short-circuit this, but defense
 *     in depth keeps the helper robust).
 */
export function isInActiveWindow(
  monthOneIndexed: number,
  from?: number | null,
  to?: number | null,
): boolean {
  if (from == null || to == null) return true;
  if (from <= to) return monthOneIndexed >= from && monthOneIndexed <= to;
  // Wrap: e.g. from=10, to=3 → Oct,Nov,Dec,Jan,Feb,Mar active.
  return monthOneIndexed >= from || monthOneIndexed <= to;
}

/**
 * Phase 11 (D-12 seasonal-wakeup, SEAS-03): first day of
 * active_from_month in `timezone` at midnight, returned as a
 * UTC-equivalent instant.
 *
 * Year selection: if nowMonth < from (home tz), target same calendar
 * year; else target next year. Wrap windows (from > to) still open
 * on the from side — this helper is unaware of wrap; wake-up always
 * means "next occurrence of from-month-at-midnight-in-home-tz".
 *
 * Caller invariant: only invoke when last-in-prior-season is true
 * (seasonal-wakeup branch in computeNextDue, Plan 11-02). If now is
 * already inside the window, this still returns the most recent from
 * boundary, which would be "before now" — wake-up branch never hits
 * that case.
 */
export function nextWindowOpenDate(
  now: Date,
  from: number,
  to: number,
  timezone: string,
): Date {
  // `to` is accepted for signature symmetry with isInActiveWindow and
  // forward-compat with future wake-up heuristics; unused in the
  // body because wake-up always opens on the `from` side.
  void to;
  const zonedNow = toZonedTime(now, timezone);
  const nowYear = zonedNow.getFullYear();
  const nowMonth = zonedNow.getMonth() + 1; // 1..12
  const targetYear = nowMonth < from ? nowYear : nowYear + 1;
  // Build 00:00 of (targetYear, from, 1) in home tz → UTC instant.
  const localMidnight = new Date(
    Date.UTC(targetYear, from - 1, 1, 0, 0, 0, 0),
  );
  return fromZonedTime(localMidnight, timezone);
}

/**
 * Phase 11 (D-12, A3 365-day heuristic): determine if a seasonal task's
 * last completion falls in a PRIOR active season relative to `now`.
 *
 * Heuristic:
 *   - If lastCompletedAt's month (in home tz) is out-of-window, TRUE —
 *     the completion was during a dormant month, so any new season
 *     opening will be a different "season instance."
 *   - If in-window, check elapsed days: more than 365 means at least
 *     one full dormancy gap has passed, so TRUE. Shorter in-window
 *     gaps assume same-season continuation and the cycle branch
 *     handles the step.
 *
 * This is A3 from the research Assumptions Log — acceptable for v1.1.
 * A future precise implementation walks month-by-month looking for a
 * dormancy transition (correct but slower; deferred).
 *
 * Private (not exported): consumed only by computeNextDue's seasonal-
 * wakeup branch. Exposing it would require documenting the heuristic
 * contract publicly; keep private until a second caller needs it.
 */
function wasInPriorSeason(
  lastCompletedAt: Date,
  from: number,
  to: number,
  now: Date,
  timezone: string | undefined,
): boolean {
  const lastMonth = timezone
    ? toZonedTime(lastCompletedAt, timezone).getMonth() + 1
    : lastCompletedAt.getUTCMonth() + 1;
  if (!isInActiveWindow(lastMonth, from, to)) return true;
  const daysSince = (now.getTime() - lastCompletedAt.getTime()) / 86400000;
  return daysSince > 365;
}
