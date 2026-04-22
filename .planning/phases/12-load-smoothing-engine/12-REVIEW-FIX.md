---
phase: 12-load-smoothing-engine
fixed_at: 2026-04-22T00:00:00Z
review_path: .planning/phases/12-load-smoothing-engine/12-REVIEW.md
iteration: 1
findings_in_scope: 1
fixed: 1
skipped: 0
status: all_fixed
---

# Phase 12: Code Review Fix Report

**Fixed at:** 2026-04-22T00:00:00Z
**Source review:** .planning/phases/12-load-smoothing-engine/12-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope (Critical + Warning): 1
- Fixed: 1
- Skipped: 0
- Info-level findings (IN-01..IN-04): out-of-scope for this iteration; see Skipped Items (Out-of-Scope) below.

## Fixed Issues

### WR-01: `computeHouseholdLoad` dormant pre-filter drops prior-season wake-ups from the load map

**Files modified:** `lib/load-smoothing.ts`, `tests/unit/load-smoothing.test.ts`
**Commit:** 0c50540
**Applied fix:**

Chose the reviewer's recommended option (a) — dropped the pre-filter entirely and let `computeNextDue` decide dormant-vs-wake-up via its existing `lastInPriorSeason` gate.

**Source change (`lib/load-smoothing.ts`):**
- Removed the out-of-window + prior-completion shortcut (lines 235-252 of the pre-fix file).
- The body of `computeHouseholdLoad` now: `if (archived) skip` → build `lastCompletion` subset → call `computeNextDue(task, lastCompletion, now, override, timezone)` → skip if null → skip if `> windowEnd` → otherwise accumulate on `isoDateKey(due, timezone)`.
- Pruned unused imports (`toZonedTime` from `date-fns-tz`, `isInActiveWindow` from `@/lib/task-scheduling`) that only existed to feed the deleted pre-filter.
- Updated the JSDoc block to document the behavior change and cite REVIEW-12 WR-01.

**Test change (`tests/unit/load-smoothing.test.ts`):**
- Added regression test `T3b: prior-season wake-up task contributes on start-of-window date (REVIEW-12 WR-01)`.
- Fixture: `active_from=10`, `active_to=3` (wrap Oct-Mar), `lastCompletion=2025-09-15` (prior-season dormant month), `now=2026-06-15` (dormant summer), `windowDays=120`.
- Assertion: `load.get(isoDateKey('2026-10-01', 'UTC')) === 1` and `load.size === 1`. Before the fix this key was absent (task dropped by the pre-filter); after the fix it contributes.
- The existing `T3` (same-season dormant ⇒ skipped) continues to pass because `computeNextDue` still returns null for that case via `!inWindowNow && !lastInPriorSeason`.

**Verification:**
- Tier 1 (re-read): confirmed fix text in place, imports pruned, JSDoc updated, new test inserted after T3.
- Tier 2 (syntax/type): `npx tsc --noEmit` — clean exit, no errors.
- Test suite: `npm test` → **465 passed (was 464; +1 regression test)**. All 51 test files pass.

## Skipped Items (Out-of-Scope)

The four info-level findings were marked out-of-scope by the scoping note in the fix prompt and are documented here for traceability:

- **IN-01** (outer `catch` in `completeTaskAction` discards error info) — low-priority; straightforward follow-up.
- **IN-02** (`placeNextDue` can return past date for overdue tasks) — already documented as a T-12-04 deferral, tracked for Phase 17 REBAL.
- **IN-03** (`getTime() > 0` vs `!Number.isNaN(getTime())`) — stylistic; current guard is safe for all realistic task dates.
- **IN-04** (`home.timezone as string` unguarded cast) — edge case; all current call-sites pass a populated timezone.

None of these block Phase 12 and all are candidates for a later cleanup pass.

---

_Fixed: 2026-04-22T00:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
