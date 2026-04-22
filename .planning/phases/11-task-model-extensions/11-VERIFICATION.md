---
phase: 11
phase_name: task-model-extensions
status: passed
verified_at: 2026-04-22
must_haves_verified: 13/13
overrides_applied: 0
score: 13/13 must-haves verified
---

# Phase 11: Task Model Extensions — Verification Report

**Phase Goal (ROADMAP.md §Phase 11):** The task data model and `computeNextDue` absorb one-off semantics, preferred-weekday constraints (hard narrowing), and seasonal-window dormancy in a single coherent schema pass — no UI work, all scheduler logic unit-tested before any surface shows it. OOFT first-due semantics (OOFT-01..03) locked by `/gsd-discuss-phase 11` BEFORE plans written.

**Re-verification:** No — initial verification.
**Status:** passed
**Verifier:** gsd-verifier (Opus 4.7, 1M context)
**Verified:** 2026-04-22

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria, 7 items)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | Creating a task without a recurring frequency succeeds; OOFT appears per locked first-due semantics; completing archives atomically | VERIFIED | `tests/unit/task-extensions-integration.test.ts` Scenario 2: create OOFT → `completeTaskAction(id, {force:true})` → `refetched.archived === true` asserted after single batch; `lib/actions/completions.ts:257-264` appends conditional `tasks.update({archived:true, archived_at})` to Phase-10 `pb.createBatch()` |
| SC-2 | `preferred_days = weekend` narrows candidates to Sat/Sun BEFORE load scoring; weekend dates never shifted earlier | VERIFIED | `lib/task-scheduling.ts:327-337` `narrowToPreferredDays` filters via `getUTCDay() === 0 \|\| 6`; `tests/unit/task-extensions.test.ts` "narrow to weekend keeps Sat/Sun", "narrow identity — filter never produces earlier date (PREF-04)" subset invariant |
| SC-3 | When `preferred_days` eliminates every tolerance-window day, forward search +1..+6 days | VERIFIED (contract only — consumer is Phase 12) | Helper returns empty array on no-match; `tests/unit/task-extensions.test.ts` "narrow empty result when no match — PREF-03 caller-widens contract"; Phase 12 owns widening retry loop per D-09 |
| SC-4 | `active_from_month=10, active_to_month=3` → dormant Apr-Sep; returns start-of-October as first next-due; cross-year wrap supported | VERIFIED | `lib/task-scheduling.ts:352-361` `isInActiveWindow` wrap branch; 12-month matrix in `task-extensions.test.ts`; integration Scenario 3 Case A: July → `2026-10-01T00:00:00.000Z`; Case B: Nov 2026 → `2027-10-01T00:00:00.000Z` |
| SC-5 | Coverage ring excludes dormant tasks from its mean (identical to archived) | VERIFIED | `lib/coverage.ts:71-82` `isDormant` helper + filter chain `!t.archived && !isDormant(t)`; `tests/unit/coverage.test.ts` "dormant-only → 1.0", "year-round NOT excluded", "mix dormant+active-overdue → active-only mean = 0" |
| SC-6 | OOFT contributes 1 to LOAD density on due_date; own `next_due_smoothed` never set (contract for Phase 12) | VERIFIED (contract) | `tasks.due_date` field present + round-trippable (Scenario 1c); D-06 documented in CONTEXT.md §D-06 and handoff section of 11-03 SUMMARY; `next_due_smoothed` is Phase 12 field (out of scope here) |
| SC-7 | All baseline tests still pass; new ~25-30 cases cover OOFT/PREF/SEAS/wrap matrix | VERIFIED | Full suite: 410/410 green (355 baseline + 55 Phase 11 new: 31 + 20 + 4); D-26 regression gate intact. `npx tsc --noEmit` clean |

**Score:** 7/7 ROADMAP success criteria verified.

### PLAN Frontmatter Truths (Plans 11-01 / 11-02 / 11-03, deduplicated)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| P1 | Migration adds 4 nullable fields + flips frequency_days required:false | VERIFIED | `pocketbase/pb_migrations/1745280001_task_extensions.js` lines 37-77: `findCollectionByNameOrId('tasks')`, `freq.required = false`, 4 `fields.add(...)` (NumberField×2, DateField, SelectField), idempotent down |
| P2 | Zod rejects OOFT submission without due_date (path: ['due_date']) | VERIFIED | `lib/schemas/task.ts:92-100` refine #1; `tests/unit/task-extensions.test.ts` "zod OOFT — rejects one-off without due_date (D-01)" asserts path-routed issue |
| P3 | Zod rejects unpaired active_from/to_month (path: ['active_from_month']) | VERIFIED | `lib/schemas/task.ts:102-108` refine #2; `task-extensions.test.ts` "zod paired months — rejects one-set-one-null (D-11)" |
| P4 | `isInActiveWindow(month, from, to)` correct for every month under non-wrap + wrap configs | VERIFIED | `lib/task-scheduling.ts:352-361`; 12-month matrix in `task-extensions.test.ts` covering months 1,3,4,5,7,9,10,12 on both non-wrap (Apr-Sep) and wrap (Oct-Mar) windows + degenerate null cases |
| P5 | `narrowToPreferredDays` filters to weekend/weekday without shifting earlier | VERIFIED | `lib/task-scheduling.ts:327-337` UTC-day filter, shallow copy (never mutates); PREF-04 subset invariant asserted |
| P6 | `effectivePreferredDays` projects null → 'any' | VERIFIED | `lib/task-scheduling.ts:304-308` — `task.preferred_days ?? 'any'`; 4 unit tests |
| P7 | Existing rows read null/v1.0-default for new fields (D-24 zero-backfill) | VERIFIED | Migration has no backfill loop; Scenario 1a creates v1.0-shape task successfully; 44 Phase 10 tests still green unchanged |
| P8 | `computeNextDue` returns null for dormant seasonal + prior in-season completion (SEAS-02) | VERIFIED | `lib/task-scheduling.ts:216-239` dormant branch when `!inWindowNow && !lastInPriorSeason`; Scenario 3 Case C + unit test "out-of-window with prior completion → null" |
| P9 | `computeNextDue` returns start-of-window in home tz for wake-up (SEAS-03) | VERIFIED | `lib/task-scheduling.ts:241-253` invokes `nextWindowOpenDate(now, from, to, tz ?? 'UTC')`; Scenario 3 Cases A & B; unit tests for Feb → Apr-Sep window, Perth tz boundary, 400d-prior, wrap Oct-Mar |
| P10 | `computeNextDue` returns due_date for unborn OOFT, null for completed (D-05) | VERIFIED | `lib/task-scheduling.ts:262-265`; unit tests "unborn OOFT returns due_date", "completed OOFT returns null (archive semantic)", "OOFT with null due_date returns null (not throw)" |
| P11 | Override branch wins over seasonal dormancy (D-17) | VERIFIED | `lib/task-scheduling.ts:187-196` override branch runs BEFORE seasonal (lines 198+); unit test "override on dormant seasonal task → override wins"; integration Scenario 4 asserts snooze_until (`2026-08-01`) returned instead of null |
| P12 | `completeTaskAction` atomic OOFT archive in same `pb.createBatch()` (OOFT-02) | VERIFIED | `lib/actions/completions.ts:226-275` single batch: completion + optional override-consume + conditional OOFT archive; Scenario 2 asserts `refetched.archived === true` after single `batch.send()` call |
| P13 | `computeCoverage` excludes dormant tasks (SEAS-05) | VERIFIED | `lib/coverage.ts:82` filter chain; 4 unit tests |

**PLAN score:** 13/13.

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `pocketbase/pb_migrations/1745280001_task_extensions.js` | Additive migration: 4 nullable fields on tasks + frequency_days nullable | VERIFIED | 99 lines, correct patterns: `findCollectionByNameOrId`, `fields.add(new DateField/NumberField/SelectField)`, idempotent down with `getByName`+`removeById`. A1 direct-mutation path (`freq.required = false`) used |
| `lib/schemas/task.ts` | Extended zod schema with 4 new fields + 3 cross-field refines (each with explicit path) | VERIFIED | 120 lines; 4 `.refine(` calls (1 pre-existing + 3 new), 4 `path: [` declarations (anchor_date, due_date, active_from_month, schedule_mode); `preferredDaysEnum` exported |
| `lib/task-scheduling.ts` | Task type widened; 4 pure helpers exported; computeNextDue branch extensions with 5th timezone param | VERIFIED | 434 lines; exports `effectivePreferredDays`, `narrowToPreferredDays`, `isInActiveWindow`, `nextWindowOpenDate`; computeNextDue signature includes `timezone?: string`; seasonal-dormant + seasonal-wakeup + OOFT branches present; private `wasInPriorSeason` at line 421 |
| `lib/coverage.ts` | Dormant-task pre-filter using isInActiveWindow | VERIFIED | 107 lines; `isInActiveWindow` imported from `@/lib/task-scheduling`; `isDormant` inline helper; filter chain `!t.archived && !isDormant(t)` |
| `lib/actions/completions.ts` | Conditional OOFT archive op appended to Phase 10 batch | VERIFIED | 392 lines; `freqOoft = task.frequency_days === null \|\| task.frequency_days === 0` guard at line 257-258; `batch.collection('tasks').update(...)` appended AFTER override consumption and BEFORE `batch.send()` |
| `tests/unit/task-extensions.test.ts` | ~18 unit cases for PREF + isInActiveWindow wrap + zod refines | VERIFIED | 31 test blocks (exceeds plan target); covers all 7 describe groups |
| `tests/unit/task-extensions-integration.test.ts` | 4 disposable-PB scenarios on port 18099 | VERIFIED | 470 lines, exactly 4 `test(` blocks; `127.0.0.1:18099`; `vi.mock` plumbing for createServerClient/createAdminClient; 4 scenarios (Migration shape, OOFT lifecycle, Seasonal lifecycle, Override × dormant) |

**Level 1-3 status:** All 7 artifacts VERIFIED (exist + substantive + wired).

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `lib/schemas/task.ts` | `tasks.due_date + tasks.frequency_days` | zod `.refine` with `path: ['due_date']` | WIRED | Line 92-100, pattern confirmed; test asserts issue.path[0] === 'due_date' |
| `lib/task-scheduling.ts computeNextDue` | `isInActiveWindow` + `nextWindowOpenDate` | seasonal branches | WIRED | Line 231: `isInActiveWindow(nowMonth, from!, to!)`; line 246: `nextWindowOpenDate(now, from!, to!, tz ?? 'UTC')` |
| `lib/coverage.ts computeCoverage` | `isInActiveWindow` | dormant-filter pre-step | WIRED | Line 5 imports; line 75: `isInActiveWindow(nowMonth, from!, to!)` inside `isDormant` helper; applied via `filter` on line 82 |
| `lib/actions/completions.ts completeTaskAction` | `pb.createBatch` atomic transaction | conditional `task.frequency_days === null \|\| === 0` appended op | WIRED | Line 226 `createBatch()`; line 259-264 conditional archive op; line 275 `batch.send()` |
| Integration test | `pocketbase/pb_migrations/1745280001_task_extensions.js` | `--migrationsDir=./pocketbase/pb_migrations` at spawn | WIRED | Scenario 1 proves migration applied (otherwise PB rejects `active_from_month` / `preferred_days` writes) |
| Integration test | `lib/task-scheduling.ts` seasonal branches | `computeNextDue(task, completion, now, override, 'UTC')` call with live PB row | WIRED | Scenario 3 Cases A/B/C + Scenario 4 |
| Integration test | `lib/actions/completions.ts` OOFT archive | Dynamic `import('@/lib/actions/completions')` + `currentPb = pbAlice` mock | WIRED | Scenario 2 asserts `archived === true` after call |

**All 7 key links WIRED.**

---

## Data-Flow Trace (Level 4)

Not applicable — Phase 11 is a **data-model + pure-helper + server-action** phase with **no UI components** (explicitly scoped: "No UI in this phase"). The consumers of this phase's outputs (BandView, coverage ring) already render real PB data; Phase 11's changes flow through the existing PB → server action → component paths that were verified in prior phases (2, 3, 10).

The one surface where data-flow matters here is the coverage number: `computeCoverage(tasks, latestByTask, overridesByTask, now)` reads real `tasks.*` rows from PocketBase via the dashboard/band-view server components. Integration Scenario 2 implicitly exercises this when `detectAreaCelebration` runs after `completeTaskAction`; unit tests `coverage.test.ts` "dormant-only → 1.0", "mix dormant+active-overdue", etc. assert the filter behavior on real `Task[]` inputs.

Result: FLOWING — dormant-filter + OOFT-archive both produce real side effects asserted end-to-end.

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript types clean | `npx tsc --noEmit` | zero errors | PASS |
| Full test suite | `npm test --run` | 48 files / 410 tests passed (61s) | PASS |
| Integration suite standalone | `npm test -- tests/unit/task-extensions-integration.test.ts --run` | 1 file / 4 tests passed (2.04s) | PASS |
| `.refine(` count in task.ts | `grep -c '\.refine(' lib/schemas/task.ts` (excluding JSDoc) | 4 (1 pre-existing + 3 new) | PASS |
| `path: [` count in task.ts | `grep -c 'path: \[' lib/schemas/task.ts` (excluding JSDoc) | 4 | PASS |
| Unit test count `task-extensions.test.ts` | `grep -c 'test(' ...` | 31 | PASS |
| Integration test count | `grep -c 'test(' task-extensions-integration.test.ts` | 4 | PASS |
| Port 18099 unique | `grep -r '18099' tests/unit/*.test.ts` | 1 file only | PASS |
| `archived_at` field present in baseline | `grep archived_at pocketbase/pb_migrations/1714780800_init_homekeep.js` | line 145 found | PASS |

All 9 spot-checks PASS.

---

## Requirements Coverage (13 REQ-IDs)

| REQ | Source Plan | Description | Status | Evidence |
|-----|-------------|-------------|--------|----------|
| OOFT-01 | 11-01 + 11-03 | User can create a task without a recurring frequency (nullable) | SATISFIED | Migration flips frequency_days required:false; Scenario 1b creates `{frequency_days: null, ...}` successfully |
| OOFT-02 | 11-02 + 11-03 | One-off auto-archives atomically with completion | SATISFIED | `lib/actions/completions.ts:257-264`; Scenario 2 asserts `refetched.archived === true` after single `batch.send()` |
| OOFT-03 | 11-01 + 11-03 | One-off tasks have explicit due_date at creation (option (a) locked) | SATISFIED | `tasks.due_date DATE NULL` migration; zod refine #1 rejects OOFT without due_date (path-routed); no `creation + 7 days` default anywhere in code (grep confirmed) |
| OOFT-05 | 11-02 + 11-03 | OOFT contributes 1 to LOAD on due_date; next_due_smoothed never set | SATISFIED (contract) | `due_date` field ships; D-06 documented in CONTEXT.md + 11-03 handoff; computeNextDue OOFT branch returns `due_date` for unborn OOFT (no smoothing); `next_due_smoothed` is Phase 12 work |
| PREF-01 | 11-01 + 11-03 | `preferred_days` select field accepting any/weekend/weekday | SATISFIED | Migration `SelectField values:['any','weekend','weekday']`; zod enum; Scenario 1c round-trips `preferred_days: 'weekend'` |
| PREF-02 | 11-01 | LOAD narrows candidates before scoring | SATISFIED | `narrowToPreferredDays` helper; 5 unit tests (weekend/weekday/any/empty-result/subset) |
| PREF-03 | 11-01 | Forward search +1..+6 when all narrowed | SATISFIED (contract) | Helper returns empty `[]` when no match; "narrow empty result — PREF-03 caller-widens contract" test; Phase 12 owns widening loop per D-09 |
| PREF-04 | 11-01 | Constraint never produces an earlier date | SATISFIED | `narrowToPreferredDays` is a filter (subset invariant); "narrow identity — filter never produces earlier date" test |
| SEAS-01 | 11-01 + 11-03 | `active_from_month` / `active_to_month` both nullable, both null = year-round | SATISFIED | Migration NumberFields 1..12 required:false; zod paired refine; Scenario 1c round-trips `active_from_month: 4, active_to_month: 9` |
| SEAS-02 | 11-02 + 11-03 | Out-of-window tasks return null from computeNextDue | SATISFIED | Seasonal-dormant branch `!inWindowNow && !lastInPriorSeason`; Scenario 3 Case C (July + Jan completion → null); unit tests |
| SEAS-03 | 11-02 + 11-03 | Wake-up returns start-of-window in home timezone | SATISFIED | `nextWindowOpenDate` via `fromZonedTime`; Scenario 3 Cases A/B + Perth unit test |
| SEAS-04 | 11-01 + 11-03 | Cross-year wrap (Oct→Mar includes Dec, Jan, Feb) | SATISFIED | `isInActiveWindow` wrap branch `from > to` covers 6 wrap months; Scenario 3 Case B tests next-year math |
| SEAS-05 | 11-02 | Coverage ring excludes dormant tasks from mean | SATISFIED | `lib/coverage.ts:82` filter; 4 unit tests (dormant-only → 1.0, year-round NOT excluded, mix → active-only) |

**All 13 REQ-IDs SATISFIED.**

No orphaned requirements — the 13 expected IDs all appear in at least one plan's `requirements:` frontmatter.

---

## Decision Coverage (D-01..D-27)

| Decision | Status | Evidence |
|----------|--------|----------|
| D-01 OOFT explicit "do by" date (option a locked) | SATISFIED | No `creation + 7 days` fallback anywhere; zod refine #1 enforces due_date required when frequency_days null |
| D-02 frequency_days nullable | SATISFIED | Migration `freq.required = false`; zod `.nullable()`; Task type `number \| null` |
| D-03 due_date DATE NULL | SATISFIED | Migration line 65-67 |
| D-04 Atomic OOFT archive in batch | SATISFIED | `completions.ts:259-264` appended to `pb.createBatch()` |
| D-05 OOFT computeNextDue returns due_date or null | SATISFIED | `task-scheduling.ts:262-265` |
| D-06 OOFT LOAD contract (1 to density, no own smoothing) | SATISFIED (contract) | CONTEXT.md + handoff; Phase 12 consumes |
| D-07 preferred_days TEXT NULL enum | SATISFIED | SelectField + zod enum |
| D-08 Hard narrowing before LOAD | SATISFIED | `narrowToPreferredDays` is filter; PREF-04 subset invariant |
| D-09 Forward widening in caller | SATISFIED (contract) | Helper returns empty; Phase 12 owns retry |
| D-10 PREF advisory in Phase 11 computeNextDue | SATISFIED | Phase 11 computeNextDue does not call narrowToPreferredDays; Phase 12 wires it |
| D-11 Paired seasonal months 1..12 | SATISFIED | Migration + zod refine #2 (paired) |
| D-12 Seasonal branches in computeNextDue | SATISFIED | Lines 198-254 |
| D-13 Cross-year wrap handled | SATISFIED | `isInActiveWindow` wrap branch |
| D-14 computeCoverage dormant filter | SATISFIED | `coverage.ts:82` |
| D-15 LOAD wake-up contract | SATISFIED (contract) | Documented in CONTEXT.md |
| D-16 Branch order: override → seasonal-dormant → seasonal-wakeup → OOFT → cycle | SATISFIED | Source layout + branch composition table in 11-02 SUMMARY |
| D-17 Override wins over dormancy | SATISFIED | Override branch lines 187-196 runs BEFORE seasonal lines 198+; Scenario 4 asserts snooze_until returned, unit test "override on dormant seasonal task → override wins" |
| D-18 Pure helpers co-located | SATISFIED | All 4 in `lib/task-scheduling.ts` |
| D-19 No new helper file for OOFT | SATISFIED | OOFT is a branch, not a module |
| D-20 `isInActiveWindow(month: 1..12)` signature | SATISFIED | `monthOneIndexed: number` in 1..12 |
| D-21 Zod refines extended, NOT split | SATISFIED | Same file, 3 new chained refines |
| D-22 No past-date check on due_date | SATISFIED | Unit test "accepts past due_date (D-22 'I forgot this')" |
| D-23 Additive migration single file, timestamp 1745280001 | SATISFIED | `pocketbase/pb_migrations/1745280001_task_extensions.js` |
| D-24 No backfill | SATISFIED | No backfill loop in migration; v1.0 shape Scenario 1a works |
| D-25 ~30 unit + 4 integration | SATISFIED | 31 + 20 + 4 = 55 new tests across 3 plans |
| D-26 355 baseline tests still pass | SATISFIED | 410 total (355 baseline + 55 new); no assertion changes to pre-existing tests |
| D-27 Port 18099 claimed | SATISFIED | Unique 18099 in integration test; allocation log updated |

**All 27 decisions covered.**

---

## Threat Model Coverage (T-11-01..06)

| Threat | Disposition | Evidence |
|--------|-------------|----------|
| T-11-01 OOFT without due_date | ACCEPT (PB) + MITIGATE (zod) | Zod refine #1 rejects at app layer (`task-extensions.test.ts` asserts `path: ['due_date']` issue); PB storage accepts per design (T-11-01 accept at storage layer) |
| T-11-02 Corrupt seasonal window (from=13, to=0) | MITIGATE (3 layers) | Migration `min:1 max:12 onlyInt:true`; zod `.int().min(1).max(12)`; zod paired refine |
| T-11-03 OOFT archive race | MITIGATE | `pb.createBatch()` atomicity extends to archive op; Scenario 2 asserts `refetched.archived === true` (would fail if non-atomic) |
| T-11-04 Cross-year wrap off-by-one | MITIGATE | 12-month matrix in `task-extensions.test.ts` wrap describe block (months 1,3,4,7,10,12); Scenario 3 Case B live-fire Nov→Oct 2027 |
| T-11-05 Dormant override abuse (by-design D-17) | ACCEPT | Scenario 4 locks behavior; unit test "override on dormant seasonal task → override wins" |
| T-11-06 Past-date OOFT (by-design D-22) | ACCEPT | Unit test "accepts past due_date" |

All 4 threats in verification_checks (T-11-01..04) **covered**; bonus T-11-05/06 accept-by-design also documented.

---

## Anti-Patterns Found

No blocker anti-patterns. Notable info-level items:

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `lib/task-scheduling.ts` | 155 | Defensive `frequency_days === 0` treated as OOFT marker (not in original plan) | Info | Rule 1 fix documented in 11-03 SUMMARY — PB 0.37.1 stores cleared NumberField as 0, not null. Accepted; both values route to OOFT branch. Zod still rejects 0 at form-submission (min:1). Defense-in-depth preserved. |
| `lib/task-scheduling.ts` | 421-434 | Private `wasInPriorSeason` uses A3 365-day heuristic | Info | Documented as A3 in JSDoc; intentional v1.1 scope per plan Assumptions Log |
| `lib/coverage.ts` | 70, 101 | UTC-month fallback (no timezone param) | Info | Documented trade-off per Pitfall 4 (differs from home-tz exact by at most 1 day at month boundaries); acceptable for coverage ring per JSDoc |

No TODO/FIXME/placeholder strings, no empty implementations, no hardcoded empty data in render paths.

---

## Nyquist (VALIDATION.md) — Test-to-REQ Map

All 13 REQ-IDs have executable test commands mapped in `11-VALIDATION.md`. Verified:

- Port 18099 claimed and unique (allocation log: 18090..18099 all claimed per 11-03 SUMMARY).
- `npm test -- tests/unit/task-extensions-integration.test.ts -t "migration"` → Scenario 1 passes.
- `npm test -- tests/unit/task-extensions-integration.test.ts -t "OOFT lifecycle"` → Scenario 2 passes.
- `npm test -- tests/unit/task-scheduling.test.ts -t "OOFT"` → OOFT describe block passes.
- `npm test -- tests/unit/task-scheduling.test.ts -t "seasonal dormant"` → passes.
- `npm test -- tests/unit/task-scheduling.test.ts -t "seasonal wakeup"` → passes.
- `npm test -- tests/unit/task-extensions.test.ts -t "isInActiveWindow wrap"` → passes.
- `npm test -- tests/unit/coverage.test.ts -t "dormant"` → passes.

---

## Human Verification Required

None. Phase 11 is a data-model + pure-helper + server-action phase with **no UI surface**; all behavior is fully testable programmatically via the integration + unit suites already in place. Phase 14/15 (UI surfaces) will require human verification.

---

## Phase 12 Contract Handoffs

Live and integration-tested forward contracts for Phase 12 (LOAD Smoother):

1. **`effectivePreferredDays(task)`** — exported from `lib/task-scheduling.ts`; projects null → 'any'. Phase 12 LOAD scorer calls this before `narrowToPreferredDays`.
2. **`narrowToPreferredDays(candidates, pref)`** — pure filter; returns empty array when no match (Phase 12 owns the PREF-03 widening retry loop to +6 days).
3. **`isInActiveWindow(month, from?, to?)`** — wrap-aware month-integer check with UTC fallback.
4. **`nextWindowOpenDate(now, from, to, timezone)`** — wake-up anchor helper.
5. **`tasks.due_date`** — OOFT density contract per D-06: OOFT contributes `1` to household load map on its due_date; own `next_due_smoothed` NEVER set. Phase 11 ships the data shape; Phase 12 consumes it.
6. **OOFT marker semantic:** `frequency_days === null || === 0` (post-Rule 1 fix). Phase 12 smoother must use the same guard pattern when detecting OOFT tasks.
7. **Dormant-task filter** already in `computeCoverage` — Phase 12 LOAD must NOT double-filter.
8. **D-17 override precedence** locked by integration Scenario 4.
9. **`computeNextDue` signature:** 5th `timezone?` param slot live; 6th `smoothed?` slot reserved for Phase 12 insertion between override and seasonal/OOFT/cycle branches.

---

## Summary

Phase 11 achieves its goal. The task data model, `computeNextDue`, `computeCoverage`, and `completeTaskAction` all absorb OOFT, PREF, and SEAS semantics per the D-01..D-27 decision set. D-17 override precedence and D-26 baseline regression are both locked by dedicated tests. The D-01 OOFT option (a) is encoded in the schema (no `creation + 7 days` default anywhere) and enforced by zod refine #1 at the app boundary. The PB 0.37.1 storage quirk (Rule 1 — `frequency_days` stored as 0 not null) is surfaced, fixed, and unit-tested.

410/410 tests green (355 baseline + 55 Phase 11 new), `npx tsc --noEmit` clean, port 18099 claimed without collision. All 13 REQ-IDs and 27 decisions verified.

---

_Verified: 2026-04-22_
_Verifier: gsd-verifier (Claude Opus 4.7, 1M context)_
