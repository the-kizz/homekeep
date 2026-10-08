// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep
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
 * Day steps are whole 24h UTC days (addUtcDays / elapsedUtcDays below), not
 * date-fns' addDays, which steps host-local calendar days and so drifts by an
 * hour across a DST change on any non-UTC host.
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
  // Phase 15 (D-07, SNZE-07): non-null ISO timestamp when the user
  // picked "From now on". Phase 17 REBAL preservation reads this.
  // null/undefined = eligible for rebalance recompute.
  reschedule_marker?: string | null;
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

const DAY_MS = 86_400_000;

function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Whole UTC days from `from` to `to` (floored; callers pass to >= from). */
function elapsedUtcDays(to: Date, from: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
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
 *   4. **one-off branch**: frequency_days null/0 → due_date when no
 *      completion, null otherwise. Runs before smoothing so a stale
 *      next_due_smoothed can't override a one-off's real date.
 *   5. **smoothed branch**: non-anchored task with next_due_smoothed,
 *      unless the task is seasonal and either dormant now or in the first
 *      cycle of a new season.
 *   6. **seasonal-dormant branch**: task has an active window, now is
 *      outside it, and the last completion was this season → null.
 *   7. **seasonal-wakeup branch**: task is outside its window and has no
 *      completion or one from a prior season → nextWindowOpenDate at
 *      home-tz midnight. Inside the window with a prior-season completion,
 *      a cycle task is due at the later of last + frequency_days and the
 *      season's opening (startOfCurrentWindow).
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

  // ─── One-off branch ───────────────────────────────────────────────────
  // A one-off (frequency_days null, or 0 as PB stores a cleared number)
  // is due on its due_date until completed, then null (completion
  // archives it; null is the race-safe answer). It runs before the
  // smoothed and seasonal branches: a leftover next_due_smoothed from a
  // task that used to recur must never hide the one-off's real date.
  if (isOoft) {
    if (lastCompletion) return null;
    return task.due_date ? new Date(task.due_date) : null;
  }

  // ─── Seasonal state, shared by the smoothed and seasonal branches ─────
  // normalizeMonth collapses PB's cleared-NumberField 0 to null so a
  // year-round task whose month columns were cleared stays windowless.
  const fromM = normalizeMonth(task.active_from_month);
  const toM = normalizeMonth(task.active_to_month);
  const hasWindow = fromM != null && toM != null;
  const nowMonth = timezone
    ? toZonedTime(now, timezone).getMonth() + 1
    : now.getUTCMonth() + 1;
  const inWindowNow = hasWindow && isInActiveWindow(nowMonth, fromM, toM);
  // Prior-season means the last completion belongs to an earlier season
  // instance than the current one (no completion counts as prior). Inside
  // the window that is exact: was it done before this season opened?
  // Outside the window wasInPriorSeason's heuristic decides.
  const lastInPriorSeason = hasWindow && (
    !lastCompletion
    || (inWindowNow
      ? new Date(lastCompletion.completed_at).getTime()
        < startOfCurrentWindow(now, fromM!, timezone ?? 'UTC').getTime()
      : wasInPriorSeason(
          new Date(lastCompletion.completed_at),
          fromM!,
          toM!,
          now,
          timezone,
        ))
  );

  // ─── Smoothed branch ─────────────────────────────────────────────────
  // The load smoother writes next_due_smoothed when a task is completed.
  // It is skipped when:
  //   - the task is anchored (anchored dates never shift; a stale value
  //     left from a cycle → anchored flip is ignored);
  //   - the task is seasonal and outside its window: the smoother knows
  //     nothing about seasons, so a date it placed after the window closed
  //     would read as overdue all through the dormant months;
  //   - the task is seasonal and this is its first cycle of the season:
  //     the window opening is the landmark, not a smoothing target.
  // An unparseable stored value (Invalid Date) also falls through.
  if (
    task.schedule_mode !== 'anchored'
    && task.next_due_smoothed
    && !(hasWindow && (!inWindowNow || lastInPriorSeason))
  ) {
    const smoothed = new Date(task.next_due_smoothed);
    if (smoothed.getTime() > 0) return smoothed;
  }

  // ─── Seasonal branches ───────────────────────────────────────────────
  //   - same-season + dormant month  → dormant (null)
  //   - prior-season + dormant month → wake-up (next window opening)
  //   - prior-season + in window     → due from the later of its cadence
  //     and this season's opening, so a task waking up reads "due now"
  //     rather than months overdue
  //   - same-season + in window      → falls through to its cadence
  if (hasWindow) {
    if (!inWindowNow && !lastInPriorSeason) return null;

    if (!inWindowNow) {
      return nextWindowOpenDate(now, fromM!, toM!, timezone ?? 'UTC');
    }

    if (lastInPriorSeason && lastCompletion && task.schedule_mode === 'cycle') {
      const windowStart = startOfCurrentWindow(now, fromM!, timezone ?? 'UTC');
      const cadence = addUtcDays(
        new Date(lastCompletion.completed_at),
        task.frequency_days as number,
      );
      return cadence > windowStart ? cadence : windowStart;
    }
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
    return addUtcDays(base, freq);
  }

  // anchored
  const baseIso = task.anchor_date ?? task.created;
  const base = new Date(baseIso);

  // Anchor in the future: the anchor IS the next due (no cycling yet).
  if (base.getTime() > now.getTime()) return base;

  // Otherwise find the next cycle boundary strictly after `now`.
  // floor(elapsed/freq) + 1 guarantees we step past `now` even when
  // elapsed is an exact multiple of freq.
  const elapsedDays = elapsedUtcDays(now, base);
  const cycles = Math.floor(elapsedDays / freq) + 1;
  return addUtcDays(base, cycles * freq);
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
 * Phase 19 PATCH-01: normalize PB 0.37.1 NumberField-cleared storage
 * reality. A cleared NumberField round-trips as `0` (not null), which
 * makes year-round semantics (null, null) and the storage-reality
 * (0, 0) diverge silently in every downstream caller. This helper
 * collapses both to `null` at the data-read boundary plus inside the
 * scheduler itself (defense-in-depth).
 *
 * Returns `null` for: 0, negative ints, ints > 12, non-integers,
 * non-number types (string, boolean), null, undefined. Returns the
 * number otherwise.
 *
 * Consumed by: isInActiveWindow (defense-in-depth), computeNextDue
 * hasWindow sites (both smoothed + seasonal branches), page.tsx
 * mapping literals on dashboard / by-area / person views.
 *
 * Pure — no side effects, no I/O.
 */
export function normalizeMonth(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 12) {
    return null;
  }
  return v;
}

/**
 * Phase 11 (D-13, SEAS-04): wrap-aware active-window check. Pure fn
 * over month integers (D-20) — caller extracts month from a Date in
 * home tz via toZonedTime(now, tz).getMonth() + 1.
 *
 * Phase 19 PATCH-01: delegates `from` / `to` normalization to
 * normalizeMonth so PB 0.37.1's cleared-NumberField=0 storage is
 * treated identically to null (year-round). Without this, a task
 * whose active_from_month was cleared after creation would silently
 * return `0 >= monthOneIndexed` mismatches in the wrap branch.
 *
 * Invariants:
 *   - monthOneIndexed in 1..12 (caller enforces).
 *   - from === to (both valid) → single-month active window.
 *   - from > to → wrap window (e.g. Oct..Mar returns true for Dec).
 *   - Either from or to null/0/out-of-range → returns true (degenerate
 *     year-round; caller's hasWindow check should short-circuit this,
 *     but defense in depth keeps the helper robust).
 */
export function isInActiveWindow(
  monthOneIndexed: number,
  from?: number | null,
  to?: number | null,
): boolean {
  const nFrom = normalizeMonth(from);
  const nTo = normalizeMonth(to);
  if (nFrom == null || nTo == null) return true;
  if (nFrom <= nTo) return monthOneIndexed >= nFrom && monthOneIndexed <= nTo;
  // Wrap: e.g. from=10, to=3 → Oct,Nov,Dec,Jan,Feb,Mar active.
  return monthOneIndexed >= nFrom || monthOneIndexed <= nTo;
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
  // Midnight on the 1st of `from` month in the home's timezone, as a UTC
  // instant. A wall-clock string is used because fromZonedTime reads a
  // Date's host-local fields, which would shift the result by the host
  // offset on any non-UTC machine.
  const wall = `${targetYear}-${String(from).padStart(2, '0')}-01T00:00:00`;
  return fromZonedTime(wall, timezone);
}

/**
 * Midnight (home timezone) on the 1st of `from` for the most recent
 * occurrence at or before `now`, as a UTC instant. Used for the opening
 * of the season `now` sits in: for an Oct–Mar window on 2027-02-10 it is
 * 2026-10-01. Built from a wall-clock string for the same reason as
 * nextWindowOpenDate (fromZonedTime reads host-local Date fields).
 */
export function startOfCurrentWindow(
  now: Date,
  from: number,
  timezone: string,
): Date {
  const zonedNow = toZonedTime(now, timezone);
  const nowYear = zonedNow.getFullYear();
  const nowMonth = zonedNow.getMonth() + 1;
  const year = nowMonth >= from ? nowYear : nowYear - 1;
  const wall = `${year}-${String(from).padStart(2, '0')}-01T00:00:00`;
  return fromZonedTime(wall, timezone);
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
