---
phase: 12-load-smoothing-engine
plan: 01
subsystem: scheduling
tags:
  - load-smoothing
  - pure-helpers
  - migration
  - wave-1
  - tolerance
  - forward-only
  - ooft-helper

# Dependency graph
requires:
  - phase: 11-task-model-extensions
    provides: "Task type (frequency_days nullable, preferred_days, active_from/to_month, due_date); effectivePreferredDays, narrowToPreferredDays, isInActiveWindow, nextWindowOpenDate pure helpers; computeNextDue 7-branch layout with timezone param"
  - phase: 10-schedule-overrides
    provides: "Override type (snooze_until, consumed_at); getActiveOverridesForHome batch loader"
provides:
  - "placeNextDue pure helper (LOAD-03) — forward-only smoother with tolerance window, PREF narrow-before-load, tiebreaker chain"
  - "computeHouseholdLoad pure helper (LOAD-14) — per-day ISO-keyed load Map over home tasks"
  - "isoDateKey shared helper — identical key format on write + lookup (Pitfall 7)"
  - "isOoftTask helper exported (centralized Phase 11 Rule-1 semantic; 3 existing callsites + 1 new)"
  - "migration 1745280002 for next_due_smoothed DATE NULL (LOAD-01) — additive, no backfill, idempotent DOWN"
  - "Task type widened with next_due_smoothed?: string | null"
  - "zod taskSchema accepts nullable next_due_smoothed"
  - "20 unit tests for the pure-helper surface (baseline 414 → 434)"
affects:
  - "Phase 12 Wave 2 (12-02): computeNextDue smoothed branch consumes the widened Task type + isOoftTask helper + read-path fallthrough-to-natural semantic"
  - "Phase 12 Wave 3 (12-03): completeTaskAction extension consumes placeNextDue + computeHouseholdLoad + isOoftTask for on-completion smoothing"
  - "Phase 12 Wave 4 (12-04): integration + perf + rider-1 validation test files consume the pure helpers"
  - "Phase 13 TCSEM: createTaskAction will consume the same placeNextDue + isOoftTask contracts (D-21) with lastCompletion=null"
  - "Phase 16 LVIZ: horizon density visualization will rebuild the load Map per render using computeHouseholdLoad"
  - "Phase 17 REBAL: manual rebalance will re-run placeNextDue in bulk"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-algorithm helpers in lib/*.ts with explicit JSDoc purity contract (forward-only, no I/O, no Date.now)"
    - "OOFT-marker centralization via isOoftTask(task): boolean — accepts both null (app semantic) and 0 (PB 0.37.1 storage reality)"
    - "Shared Map-key helper (isoDateKey) to prevent tz-mismatch bugs between Map build and lookup"
    - "Additive-only migration pattern with idempotent DOWN (Phase 11 1745280001 exemplar mirrored)"
    - "Tolerance formula min(Math.floor(0.15 * freq), 5) — integer-days semantics (LOAD-04)"
    - "Tiebreaker chain via single sort() with 3-key comparator: score → |d-ideal| → time"

key-files:
  created:
    - "pocketbase/pb_migrations/1745280002_next_due_smoothed.js (40 lines) — DateField NULL additive migration"
    - "lib/load-smoothing.ts (268 lines) — placeNextDue + computeHouseholdLoad + isoDateKey + PlaceOptions"
    - "tests/unit/load-smoothing.test.ts (601 lines) — 20 unit tests (10 placement + 8 household + 2 isoDateKey smoke)"
  modified:
    - "lib/task-scheduling.ts (434 → 454 lines; +20 net) — Task.next_due_smoothed widening + isOoftTask export + internal isOoft call rewired to use helper"
    - "lib/schemas/task.ts (120 → 126 lines; +6 net) — next_due_smoothed: z.string().nullable().optional()"

key-decisions:
  - "5-arg placeNextDue signature (task, lastCompletion, householdLoad, now, options) — matches Phase 13 TCSEM contract (D-21) where lastCompletion is explicit null for creation; differs from the 4-arg signature hint in 12-RESEARCH.md §Pattern 1 header but matches the body text + §Pattern 4 call site"
  - "now param accepted for signature symmetry but unused in current body (void-referenced) — reserved for future T-12-04 ≥ now guard; forward-only naturalIdeal = lastCompletion + freq is already ≥ now by construction for non-overdue tasks"
  - "CompletionRecord → Completion subset projection in computeHouseholdLoad body — CompletionRecord carries more fields than Completion (completed_by_id, notes, via); project to { completed_at } before calling computeNextDue"
  - "Dormant-seasonal pre-filter mirrors lib/coverage.ts:71-80 logic: if active window + out-of-window now + prior completion exists → skip. No prior completion → fall through to computeNextDue so the seasonal-wakeup branch can contribute a wakeup date"
  - "Test T7 (cycle smoothed vs natural) documents Wave 1 baseline: both sub-cases contribute on natural date, because computeNextDue (Wave 2) has NOT yet added the smoothed branch. Wave 2 test file will add the assertion that smoothed-set contributes on smoothed"
  - "NOW=2026-05-01 is Friday (not Thursday as the original prompt stated) — verified via Date.getUTCDay()=5. Test fixtures adjusted accordingly: T5 weekend window uses naturalIdeal=Sat May 2 from lastCompletion=Sat Apr 18 freq=14"

patterns-established:
  - "Pattern: Pure helper composes Phase 11+10 primitives (narrowToPreferredDays, effectivePreferredDays, isInActiveWindow, computeNextDue) + date-fns + date-fns-tz; no hand-rolled date math"
  - "Pattern: Defense-in-depth throws at boundaries the caller is supposed to enforce (anchored, OOFT) — callers in Wave 3 (completeTaskAction) will filter via task.schedule_mode and isOoftTask before calling; helper throws only if caller violates contract"
  - "Pattern: Test fixtures build Task records via makeTask({...overrides}) with all Phase 11+12 fields pre-populated (null defaults); explicit over partial for type-safety and test readability"

requirements-completed:
  - LOAD-01
  - LOAD-03
  - LOAD-04
  - LOAD-05
  - LOAD-08
  - LOAD-09
  - LOAD-11
  - LOAD-12
  - LOAD-14

# Metrics
duration: 8min
completed: 2026-04-22
---

# Phase 12 Plan 01: Load-Smoothing Engine Wave 1 — Data + Pure Helpers

**Landed the `tasks.next_due_smoothed` field, `placeNextDue` + `computeHouseholdLoad` + `isoDateKey` pure helpers, centralized the `isOoftTask` marker, and shipped 20 unit tests — foundation that Waves 2-4 compose on with zero re-exploration.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-22T10:56:44Z
- **Completed:** 2026-04-22T11:04:48Z
- **Tasks:** 3 / 3
- **Files created:** 3 (migration, lib, test)
- **Files modified:** 2 (task-scheduling, zod schema)

## Accomplishments

### Task 1 — Migration `1745280002_next_due_smoothed.js`

Additive `DateField required:false` on `tasks` collection. Timestamp +1 from Phase 11's `1745280001`. Mirrors Phase 11 structure: `/// reference path` JSDoc, SPDX header, post-construction `tasks.fields.add(new DateField(...))`, idempotent DOWN via `getByName → removeById` guard. No index (D-01 — low cardinality). No backfill (D-01 — v1.0 rows get null → D-02 natural fallback preserves byte-identical v1.0 read behavior, T-12-03 mitigation).

### Task 2 — Pure helpers + isOoftTask + Task widening + zod extension

**`lib/load-smoothing.ts` (268 lines)** — three exports + one type:
- `placeNextDue(task, lastCompletion, householdLoad, now, options)` — forward-only smoother. Pipeline: `naturalIdeal = base + freq` → candidates `±tolerance` → PREF narrow (Phase 11 helper) → PREF widen forward +1..+6 if empty → score via load.get(isoDateKey) → sort by 3-key chain (score → distance-from-ideal → earliest). Defense-in-depth throws for anchored (LOAD-06) and OOFT (LOAD-09).
- `computeHouseholdLoad(tasks, latestByTask, overridesByTask, now, windowDays=120, timezone='UTC')` — iterates tasks, skips archived + dormant-seasonal-with-prior-completion, calls `computeNextDue` for everything else, accumulates into Map keyed by `isoDateKey(due, tz)`. Bounds via `windowDays` so far-future (annual) tasks don't populate unscored Map slots.
- `isoDateKey(d, tz)` — shared `formatInTimeZone(d, tz, 'yyyy-MM-dd')`. Both helpers call it on write AND read → Pitfall 7 (tz-mismatch bug) eliminated by construction.
- `PlaceOptions` type — `preferredDays`, `tolerance`, `timezone` all optional.

**`lib/task-scheduling.ts`** — three changes:
1. `Task` type widened with `next_due_smoothed?: string | null` at bottom of the type block.
2. `isOoftTask(task)` helper exported — `frequency_days === null || frequency_days === 0`. Centralizes the Phase 11 Rule-1 semantic across 4 callsites (computeNextDue, completeTaskAction Phase 11, load-smoothing.ts NEW, Phase 13 createTaskAction FUTURE).
3. Internal `isOoft` variable inside `computeNextDue` rewired from inline `task.frequency_days === null || === 0` to `isOoftTask(task)`. Byte-identical predicate; wraps the same check.

**`lib/schemas/task.ts`** — added `next_due_smoothed: z.string().nullable().optional()` inside the `.object({...})` block alongside the Phase 11 additions. No new `.refine()` — nullable absence is semantically valid at any point in a cycle task's lifecycle.

### Task 3 — 20 unit tests

Three `describe` blocks in `tests/unit/load-smoothing.test.ts`:

**`describe('placeNextDue')` — 10 tests** covering LOAD-03, 04, 05, 11, 12:
- T1: freq=1 → tolerance=0 → returns naturalIdeal verbatim
- T2: tolerance default formula validated for freq=7, 30, 365 via load-seeded probe (uniform load → closest-to-ideal tiebreak lands on naturalIdeal, distance 0)
- T3: options.tolerance=0 overrides default; heavy load on naturalIdeal still wins (single candidate)
- T4: outer days (natural ± tol+1) with load=0 are NOT considered (proves candidate window width is inclusive ±tol and nothing else)
- T5: preferred_days='weekend' with weekend-load=10 + weekday-load=0 → weekend wins (PREF hard constraint; LOAD-05)
- T6: all-weekday tolerance window with preferred_days='weekend' → widen forward to May 9 (Sat)
- T7: two sub-assertions — (a) equal load → closest-to-ideal wins; (b) equal load + equal distance → earliest wins
- T8: forward-only — snapshot Map + task JSON before/after → bit-identical
- T9: anchored mode throws `/LOAD-06/`
- T10: two sub-cases — freq=null throws `/LOAD-09/`, freq=0 throws `/LOAD-09/`

**`describe('computeHouseholdLoad')` — 8 tests** covering LOAD-08, 09, 14:
- T1: empty tasks → empty Map
- T2: archived task → NOT contributed
- T3: dormant seasonal (wrap Oct-Mar, now=May, prior Jan completion) → NOT contributed
- T4: OOFT (freq=null, due_date set, no completion) → contributes 1 on due_date key
- T5: snoozed (Override.snooze_until) → contributes 1 on snooze_until key
- T6: anchored task → contributes 1 on natural anchored next_due (D-10 — LOAD-visible, just not smoothed)
- T7: Wave 1 baseline — both `next_due_smoothed` set AND null contribute on natural cycle date (because computeNextDue Wave 2 hasn't wired the smoothed branch yet); test documents this transient behavior
- T8: 365-day annual task + windowDays=120 → excluded; windowDays=400 → included (sanity)

**`describe('isoDateKey')` — 2 smoke tests**: UTC round-trip + IANA tz boundary (Pacific/Perth at UTC midnight).

## Verification Evidence

| Check | Command | Result |
|-------|---------|--------|
| Migration syntactically valid | `node -e "...grep checks..."` | `migration OK` |
| Migration grep criteria | 8 grep checks (DateField, name, required:false, getByName, migrate, no addIndex) | all pass |
| Type-check clean | `npx tsc --noEmit` | exit 0 |
| New unit tests | `npm test -- tests/unit/load-smoothing.test.ts --run` | **20/20 green** (~2.1s) |
| Full regression | `npm test --run` | **434/434 green** (414 → 434; +20; 0 red) |
| Load-smoothing.ts line count ≥ 180 | `wc -l lib/load-smoothing.ts` | 268 |
| 18+ tests requirement | `test(` count in new file | 20 |
| No deletions | `git diff --diff-filter=D` per commit | clean (3 pure-add commits) |

## Deviations from Plan

### Auto-fixed issues

None — no Rule 1/2/3 auto-fixes were needed. The plan's `<action>` blocks were comprehensive enough that execution was mechanical composition over Phase 10+11 primitives + date-fns.

### Plan interpretation notes (not deviations)

**1. `now` param in `placeNextDue` is currently unused (void-referenced).**
The plan's algorithm (D-06 / §Pattern 1) derives everything from `naturalIdeal = lastCompletion + freq` and does not read `now` after the tolerance-window construction. `now` is accepted for signature symmetry with `computeHouseholdLoad` and forward-compat with a future T-12-04 "place never earlier than now" guard (currently handled implicitly — naturalIdeal ≥ lastCompletion + freq is always ≥ now for non-overdue tasks). Documented inline via `void now;` + JSDoc note.

**2. Test NOW value is Friday, not Thursday.**
The plan's Task 3 `<action>` block described `NOW = new Date('2026-05-01T00:00:00.000Z') (Thursday)`. Verified via `new Date('2026-05-01T00:00:00.000Z').getUTCDay() === 5` (Friday). Test fixtures adjusted to Friday's day-of-week ordering — T5's weekend window uses `lastCompletion=Apr 18 (Sat) + freq=14 → naturalIdeal=May 2 (Sat)` rather than any Thursday-derived fixture. No test semantics changed; just the calendar anchor.

**3. T7 (cycle smoothed vs natural) documents Wave 1 transient behavior.**
The plan's behavior section for Task 3 T7 says "cycle task with next_due_smoothed set contributes on smoothed date; cycle task with null smoothed contributes on natural next_due." Wave 1 does NOT wire the smoothed branch in `computeNextDue` — that's Wave 2 (Plan 12-02). So in Wave 1, `computeNextDue` ignores `next_due_smoothed` entirely and both sub-cases contribute on the natural date. The test documents this Wave-1 behavior explicitly and notes Wave 2 will add the smoothed-contribution assertion. This is the correct Wave 1 semantic per the plan's "No `computeNextDue` changes in this plan (Wave 2)" constraint.

**4. computeHouseholdLoad signature: 6-arg with Maps, not 3-arg from plan behavior summary.**
The plan's `<behavior>` block described `computeHouseholdLoad(tasks, now, windowDays)` at a summary level but the plan's `<action>` block specified the full 6-arg `computeHouseholdLoad(tasks, latestByTask, overridesByTask, now, windowDays=120, timezone='UTC')` matching 12-RESEARCH.md §Pattern 2. The `<action>` signature is authoritative and is what shipped — anything less would force a PB query inside the pure helper, violating the "no I/O" contract.

### Auth gates

None occurred — pure-algorithm work, no external services touched.

## Known Stubs

None — all exports wired end-to-end (helpers composable from Wave 2+3 callers; type widening landed on Task; zod field accepts the shape; migration adds the DB field).

## Threat Flags

None — this plan introduces no new trust boundaries. The migration adds a nullable additive DateField (threat model T-12-03 mitigated by D-02 natural fallback + zod schema `.nullable()`); the pure helpers operate on already-fetched data passed as arguments with no new I/O surface.

## Commits

- `7d2ff5d` — `feat(12-01): add next_due_smoothed DateField migration (LOAD-01)`
- `4d43643` — `feat(12-01): add load-smoothing pure helpers + widen Task + extend zod`
- `d0a882d` — `test(12-01): add 20 unit tests for load-smoothing pure helpers`

## Test Count Trajectory

| Layer | Plan | Count | Cumulative |
|-------|------|-------|------------|
| Phase 11 final (baseline into Phase 12) | — | 410 | 410 |
| Post-Phase-11 UX polish / regression | — | +4 | 414 |
| Phase 12 Plan 01 (this plan) | 12-01 | +20 | **434** |

## Port Allocation Register Snapshot (unchanged)

| Port | Claimant | Status |
|------|----------|--------|
| 18098 | 10-01 schedule_overrides | claimed |
| 18099 | 11-03 task-extensions | claimed |
| 18100 | reserved for 12-04 integration (not claimed this plan) | reserved |
| 18101 | — | next free |

## Handoff for Wave 2 (Plan 12-02)

Forward contracts now live and ready for Wave 2:

1. **`Task.next_due_smoothed?: string | null`** — field exists on the PB schema + zod + TS type. Wave 2's smoothed-branch insertion in `computeNextDue` reads `task.next_due_smoothed` directly.
2. **`isOoftTask(task)` exported** — Wave 2 should rewire the Phase 11 inline `isOoft` check in `computeNextDue` to use this helper for consistency (the internal call inside `computeNextDue` was rewired in this plan; the new LOAD branch insertion should also use the helper).
3. **Branch insertion position (per 12-RESEARCH.md §Pattern 3)** — BETWEEN the override branch (current `lib/task-scheduling.ts:188-196`) AND the Phase 11 seasonal branches (line 198+). Code pattern:
   ```typescript
   if (task.schedule_mode !== 'anchored' && task.next_due_smoothed) {
     const treatAsWakeup = hasWindow && lastInPriorSeason;
     if (!treatAsWakeup) return new Date(task.next_due_smoothed);
     // else fall through to seasonal-wakeup
   }
   ```
   `hasWindow` + `lastInPriorSeason` are computed in the existing Phase 11 seasonal block; Wave 2 can either hoist them or inline a cheap precheck.
4. **T7 placement test in this plan will flip** — once Wave 2 wires the smoothed branch, `computeNextDue` for a cycle task with `next_due_smoothed` set will return the smoothed date instead of the natural one. The T7 test should be updated (or a new test added) to assert this Wave 2 behavior. The Wave 1 test currently documents the transient baseline.

## Handoff for Wave 3 (Plan 12-03)

1. **`placeNextDue` signature is stable** — 5-arg `(task, lastCompletion, householdLoad, now, options)`. `options.preferredDays` + `options.timezone` should be populated from the task + home record in `completeTaskAction`'s batch.
2. **`computeHouseholdLoad` signature is stable** — 6-arg; Wave 3 must prepare both `latestByTask: Map<taskId, CompletionRecord>` and `overridesByTask: Map<taskId, Override>` before calling. The existing Phase 10 `getActiveOverridesForHome(pb, homeId)` already returns the second Map; a broader `getCompletionsForHome + reduceLatestByTask` call (already used for area snapshots) needs to run at home scope.
3. **Trigger guard**: Wave 3 must filter callers so this plan's defense-in-depth throws never fire: `if (task.schedule_mode === 'cycle' && !isOoftTask(task)) { ...call placeNextDue... }`. The 12-RESEARCH §Pattern 4 shows the exact insertion point in `lib/actions/completions.ts:263`.
4. **Error handling** — per D-13 plan, wrap the placement in try/catch and swallow errors (log via `console.warn`); leave `next_due_smoothed = null` on any failure so D-02 natural fallback engages.

## Handoff for Wave 4 (Plan 12-04)

1. **Integration test scenarios 1-5** per D-18 — disposable PB on port 18100 exercising end-to-end completion flow, migration correctness, 100-task perf budget (LOAD-13), 30-task Rider 1 tolerance validation (D-17), v1.0 upgrade behavior (T-12-03).
2. **Perf test** — `tests/unit/load-smoothing-perf.test.ts` per §Perf Benchmark Approach. The pure helpers' O(T × W) = O(100 × 120) = 12k iterations is comfortably under 100ms; the 20x headroom budget is realistic.
3. **Rider 1 tolerance validation** — 30-task seed (5 × freq=1/7/14/30/90/365), count clusters ≥ 3 tasks per day; if > 7 clusters, widen LOAD-04 default to `min(0.15 * freq, 14)` and update this file, 12-CONTEXT.md D-05, and REQUIREMENTS.md LOAD-04.

## Self-Check: PASSED

- `pocketbase/pb_migrations/1745280002_next_due_smoothed.js` exists: FOUND (40 lines)
- `lib/load-smoothing.ts` exists: FOUND (268 lines)
- `tests/unit/load-smoothing.test.ts` exists: FOUND (601 lines)
- `lib/task-scheduling.ts` modified (isOoftTask + Task widening): FOUND
- `lib/schemas/task.ts` modified (next_due_smoothed zod field): FOUND
- Commit 7d2ff5d exists: FOUND (migration)
- Commit 4d43643 exists: FOUND (helpers + widening)
- Commit d0a882d exists: FOUND (tests)
- Full test suite: 434 passed, 0 failed (baseline 414 → 434, +20)
- Type-check: clean (exit 0)
- Grep acceptance criteria (Task 2): all 15 grep checks pass
- Migration acceptance criteria (Task 1): all 8 grep checks pass
