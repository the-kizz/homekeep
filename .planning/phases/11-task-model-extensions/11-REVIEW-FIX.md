---
phase: 11-task-model-extensions
fixed_at: 2026-04-22T10:20:00Z
review_path: .planning/phases/11-task-model-extensions/11-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 11: Code Review Fix Report

**Fixed at:** 2026-04-22T10:20:00Z
**Source review:** `.planning/phases/11-task-model-extensions/11-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 3 (Critical + Warning — default scope)
- Fixed: 3
- Skipped: 0
- Test suite: 410 baseline → 414 passing (4 new WR-01 regression tests added)

## Fixed Issues

### WR-01: `computeCoverage` divides by `null` for unborn OOFT tasks → `NaN` coverage

**Files modified:** `lib/coverage.ts`, `tests/unit/coverage.test.ts`
**Commit:** `953dfb4`
**Applied fix:** Added per-task guard at top of the computeCoverage loop:
```ts
const freq = task.frequency_days;
if (freq === null || freq === 0) continue;
```
OOFT tasks now skip the health sum the same way dormant tasks are skipped — they contribute no signal until archived by completeTaskAction's atomic batch. Replaced the `(task.frequency_days as number)` cast with the guarded `freq` local so the division is well-typed and truthful.

Added 4 regression tests in a new `describe('computeCoverage — OOFT guard (WR-01)')` block:
1. Unborn OOFT with `freq=null` + future due_date → 1.0 empty-home invariant (would be NaN without fix).
2. Unborn OOFT with `freq=0` (PB 0.37.1 storage quirk) → 1.0.
3. Unborn OOFT coexists with healthy recurring → mean of recurring only (1.0).
4. Unborn OOFT with PAST due_date coexists with overdue recurring → mean of recurring only (0.5, not Infinity).

### WR-02: `computeNextDue` callers omit `timezone` — seasonal wake-up anchored to UTC midnight

**Files modified:** `lib/band-classification.ts`, `lib/actions/completions.ts`
**Commit:** `0fbf8b7`
**Applied fix:** Two call-site adjustments + one fields-list expansion.

1. `lib/band-classification.ts:80` — threaded `timezone` (already received as 5th arg by `computeTaskBands`) into the per-task `computeNextDue` call as its 5th arg. Without this, a seasonal task in wake-up anchored to UTC midnight; in Perth (UTC+8) the band-classification boundary comparison against `localMidnightTodayUtc` classified the task one day early.

2. `lib/actions/completions.ts:359-371` — passed `home.timezone` as the 5th arg to the success-toast `computeNextDue` call. Matches the downstream `formatInTimeZone(nextDue, home.timezone, ...)` rendering so the toast calendar day is consistent with the band view.

3. `lib/actions/completions.ts:117-118` — expanded the `pb.getOne('tasks', ...)` fields list to include the 3 new Phase 11 fields: `due_date`, `active_from_month`, `active_to_month`. Without them the Task shape arrived with those fields `undefined` and the seasonal / OOFT branches in `computeNextDue` silently never fired for the toast. The projection into the computeNextDue Task shape was widened to pass them through (with `?? null` defaults for v1.0 rows).

Also narrowed the `frequency_days` cast from `as number` to `as number | null` to match the widened type and avoid hiding the null case that WR-01 now guards.

### WR-03: `frequency_days as number` cast is a lie for OOFT tasks reaching bands

**Files modified:** `components/band-view.tsx`, `components/task-band.tsx`
**Commit:** `552ff4f`
**Applied fix:** Option (a) from the review — pre-filter OOFT tasks at the `BandView` level before they reach `TaskBand` / `TaskRow`. Added a `filterOutOoft` predicate applied to all three band arrays (`overdue`, `thisWeek`, `horizon`) before `attachMeta` maps:

```ts
const filterOutOoft = (ct: ClassifiedTask) =>
  ct.frequency_days !== null && ct.frequency_days !== 0;
const overdueWithName = bands.overdue.filter(filterOutOoft).map(attachMeta);
// ... same for thisWeek, horizon
```

Chose option (a) because OOFT UI (dedicated "Once" label, OOFT-shape handling) is explicitly Phase 15 scope per `11-CONTEXT.md` deferred decisions. Keeping `task-band.tsx` v1.1-recurring-clean means the `as number` cast stays truthful. Matches the `isDormant` filter in `computeCoverage` — both exclude tasks that don't belong in the recurring-cycle rendering path.

Updated the JSDoc comments at the two cast sites in `task-band.tsx` (lines 84 and 160) to truthfully attribute the non-null guarantee to caller pre-filtering (not a downstream survival invariant).

## Skipped Issues

None — all in-scope findings (WR-01, WR-02, WR-03) were fixed cleanly.

## Info Findings Noted But Not Fixed

Per scope (Critical + Warning default), these Info findings are intentionally deferred:

- **IN-01** — `computeCoverage` UTC-month dormant check. Documented as acceptable trade-off in the module JSDoc; non-blocking.
- **IN-02** — `nextWindowOpenDate` unused `to` parameter. Non-blocking signature-symmetry choice.
- **IN-03** — `wasInPriorSeason` A3 365-day heuristic. Documented as v1.1 precision trade-off.
- **IN-04** — Schema refine path UX edge case. Non-blocking; form UX testing can revisit.

## Test Results

- **Before fixes:** 410 tests passing across 48 test files.
- **After fixes:** 414 tests passing across 48 test files (4 new regression tests for WR-01).
- **No existing assertions changed** — the D-26 regression gate (Plan 11-01) holds.
- **TypeScript clean** — `npx tsc --noEmit` produced no errors on any modified file.

## Commits

| Finding | Commit | Message |
|---------|--------|---------|
| WR-01 | `953dfb4` | `fix(11): WR-01 guard computeCoverage against OOFT null/0 frequency` |
| WR-02 | `0fbf8b7` | `fix(11): WR-02 thread timezone into computeNextDue at band + completion call sites` |
| WR-03 | `552ff4f` | `fix(11): WR-03 pre-filter OOFT tasks out of band view before TaskBand casts` |

---

_Fixed: 2026-04-22T10:20:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
