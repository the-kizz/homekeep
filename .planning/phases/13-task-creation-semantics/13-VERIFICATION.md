---
phase: 13-task-creation-semantics
verified: 2026-04-22T12:45:00Z
status: passed
score: 5/5 ROADMAP SCs verified (7/7 TCSEM REQ-IDs satisfied)
overrides_applied: 0
---

# Phase 13: Task Creation Semantics — Verification Report

**Phase Goal:** Every new task — whether custom or seed-batched — enters the system with a load-smoothed `next_due_smoothed` already populated, eliminating the v1.0 onboarding clumping problem at its source. "Last done" becomes an optional Advanced field; smart defaults handle the common case; SDST synthetic completions are fully removed.

**Verified:** 2026-04-22T12:45:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Task form's Advanced collapsible (default collapsed) exposes optional "Last done" date field; providing it sets `first_ideal = last_done + frequency_days`, then runs through load smoother (SC-1 / TCSEM-01 + TCSEM-02) | VERIFIED | `components/forms/task-form.tsx:344-383` Collapsible wraps cycle-mode-gated last_done Input (no `open` prop → closed default); `lib/schemas/task.ts:92` adds optional `last_done`; `lib/actions/tasks.ts:200-210` parses last_done → Date and threads into `computeFirstIdealDate`; helper at `lib/load-smoothing.ts:113-116` returns `addDays(lastDone, freq)` for TCSEM-02 branch; synthetic lastCompletion bridge at `lib/actions/tasks.ts:218` preserves placement math. Unit tests load-smoothing.test.ts Tests 6-8, integration Scenario 1 (live last_done=now-12d, freq=30 → placement in [now+10d, now+26d] window). |
| 2 | When "Last done" blank in cycle mode, smart-default first-due resolves per cycle length (≤7d → tomorrow; 8-90d → cycle/4; >90d → cycle/3), then load-smoothed (SC-2 / TCSEM-03) | VERIFIED | `lib/load-smoothing.ts:118-121` implements exact formula; all 3 branches + inclusive-7/8 boundary covered by load-smoothing.test.ts Tests 1-5 + Test 12 (freq=3/7/30/60/365/8); createTask/batchCreateSeedTasks both call the helper with `lastDone=null` when user omits the field. |
| 3 | Accepting all 30+ seed tasks in onboarding produces a cohort whose first-due dates are naturally distributed and zero synthetic `via='seed-stagger'` completion rows are written (SC-3 / TCSEM-05 + TCSEM-06) | VERIFIED | `lib/actions/seed.ts:162-216` per-seed placement loop with in-memory `householdLoad.set(isoDateKey(placedDate, tz), prev+1)` threading; atomic `pb.createBatch()` preserved. Integration Scenario 2 asserts 5-seed freq=30 cohort distributes to ≥4 distinct ISO dates with no ≥3-cluster (observed distribution in 13-02-SUMMARY: 5 distinct dates). SDST audit: `grep -rn "seed-stagger\|SDST\|seed_stagger" lib/ components/ pocketbase/ app/` returns **0 lines** (re-run at verify time). Scenario 3 runtime query `filter: via = "seed-stagger"` returns 0 completion rows. |
| 4 | Every newly-created task (custom or seeded) has `next_due_smoothed` populated at write time; History view is empty immediately after onboarding; personal stats counters are zero (SC-4 / TCSEM-04) | VERIFIED | `lib/actions/tasks.ts:255-277` single-op `tasks.create` body includes pre-computed `next_due_smoothed` — atomicity by construction (no separate update op); same for batch seed creates at `lib/actions/seed.ts:225-241`. Integration Scenario 1 reads task via `getFirstListItem` in a single PB read and asserts `next_due_smoothed` populated. History-empty/stats-zero implied by TCSEM-06 (no synthetic completions written) and verified by Scenario 3. |
| 5 | v1.0 tasks untouched by this phase — their `next_due_smoothed` remains NULL until their own next post-upgrade completion (SC-5 / TCSEM-07) | VERIFIED | No new migration files in `pocketbase/pb_migrations/` for Phase 13 (latest: `1745280002_next_due_smoothed.js` from Phase 11). Zero backfill code. tasks-tcsem.test.ts Test 4 asserts freq=0 is unreachable via form path. Phase 12 Plan 12-03's `completeTaskAction` step 7.5 (already in production) writes smoothed date on first post-upgrade completion. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `lib/load-smoothing.ts` | `computeFirstIdealDate` export with TCSEM-02/03 formulas + anchored/OOFT throw guards | VERIFIED | Lines 93-122: exported, 3 formula branches present, LOAD-06 + LOAD-09 guard throws. 5-callsite JSDoc updated. |
| `lib/actions/tasks.ts` | createTask threads last_done → computeFirstIdealDate → synthetic-lastCompletion bridge → placeNextDue; atomic single-op create with `next_due_smoothed` | VERIFIED | Lines 71 (rawLastDone), 200-210 (lastDoneDate parse + threading), 217-219 (bridge synthesis with `-freq` offset), 230-239 (placeNextDue call), 255-277 (single-op create body with smoothed field). D-06 fallback at 242-251. |
| `lib/actions/seed.ts` | batchCreateSeedTasks with in-memory load-map threading across seeds; atomic `pb.createBatch()` preserved | VERIFIED | Lines 162-216: per-seed loop computes firstIdeal, synthesizes lastCompletion, calls placeNextDue, mutates householdLoad via `isoDateKey(placedDate, tz)`. Lines 222-246: single `pb.createBatch()` with N creates + 1 homes.update atomic send. |
| `lib/schemas/task.ts` | `last_done: z.string().nullable().optional()` | VERIFIED | Line 92. |
| `components/forms/task-form.tsx` | Collapsible section (default closed) wrapping last_done date Input, gated on `scheduleMode === 'cycle'` | VERIFIED | Lines 344-383: Collapsible (no `open` prop = closed default), CollapsibleTrigger with "Advanced" label, Controller-bound date Input with `name="last_done"` for FormData serialization. D-03/D-04 (anchored/OOFT hide) satisfied via cycle-positive guard. |
| `components/ui/collapsible.tsx` | shadcn-style wrapper over radix-ui Collapsible primitive | VERIFIED | 54 lines; exports Collapsible/CollapsibleTrigger/CollapsibleContent; mirrors `components/ui/dialog.tsx` convention (radix-ui meta-package import, no explicit @radix-ui/react-collapsible pin — consistent with 02-02 exact-pin invariant). |
| `tests/unit/load-smoothing.test.ts` | 12 new smart-default/last-done/guard-throw tests for computeFirstIdealDate | VERIFIED | Lines 701-785: describe block `computeFirstIdealDate (TCSEM-02/TCSEM-03)` with Tests 1-12. All 3 smart-default buckets + boundary (freq=7/8) + lastDone paths + 3 guard-throws present. |
| `tests/unit/actions/tasks-tcsem.test.ts` | 6 createTask unit tests covering TCSEM placement, bridge offset, bypass paths, D-06 fallback | VERIFIED | 6 tests present; Test 2 asserts synthetic lastCompletion offset = -6d for freq=7 (bridge math preserved); Test 3 anchored bypass (no placement call); Test 5 placement throw → console.warn + empty next_due_smoothed. |
| `tests/unit/actions/seed-tcsem.test.ts` | 6 batchCreateSeedTasks unit tests + runtime SDST audit | VERIFIED | 6 tests present; Test 3 asserts 5-seed cohort dates.size ≥ 4; Test 6 runs `grep -rn` via child_process.execSync against production dirs, asserts 0 matches (token-concat obfuscation so test file doesn't self-match). |
| `tests/unit/tcsem-integration.test.ts` | 3-scenario disposable-PB integration suite on port 18101 | VERIFIED | 362 lines; `const PORT = 18101` (one grep match across tests/unit/); 3 `test('Scenario …)` blocks; boot prelude matches load-smoothing-integration.test.ts pattern; vi.mock plumbing for next/navigation redirect, pocketbase-server, pocketbase-admin. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `components/forms/task-form.tsx` last_done Input | `lib/actions/tasks.ts` createTask | RHF Controller + native input `name="last_done"` → FormData → `formData.get('last_done')` | WIRED | Controller wraps Input with `name="last_done"`; action reads rawLastDone from formData; parsed.data.last_done threaded into Date constructor + computeFirstIdealDate 3rd arg. |
| `lib/actions/tasks.ts` createTask | `lib/load-smoothing.ts` computeFirstIdealDate + placeNextDue | direct import + function call | WIRED | Line 22 imports both; lines 205-210 call computeFirstIdealDate; lines 230-239 call placeNextDue with synthetic lastCompletion. |
| `lib/actions/tasks.ts` createTask | PB tasks.create | pb.collection('tasks').create({...next_due_smoothed}) | WIRED | Line 255-277 single-op create includes pre-computed next_due_smoothed field. |
| `lib/actions/seed.ts` batchCreateSeedTasks | `lib/load-smoothing.ts` (all 4 helpers: computeFirstIdealDate, computeHouseholdLoad, isoDateKey, placeNextDue) | direct imports + per-seed loop | WIRED | Lines 15-20 import all 4; lines 151 (computeHouseholdLoad once), 169 (per-seed computeFirstIdealDate), 192 (placeNextDue), 204 (isoDateKey for Map key alignment). |
| `lib/actions/seed.ts` batchCreateSeedTasks | PB createBatch atomic transaction | pb.createBatch() with N tasks.create + 1 homes.update | WIRED | Lines 222-246: batch built + sent; T-05-03-10 atomicity preserved; each create has pre-computed next_due_smoothed. |
| `components/forms/task-form.tsx` Collapsible | `components/ui/collapsible.tsx` | named imports | WIRED | Lines 12-14 import Collapsible, CollapsibleTrigger, CollapsibleContent; used at 345/346/357. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| createTask → tasks.create body | `next_due_smoothed` | computed via `placedDate.toISOString()` from `placeNextDue(syntheticTask, syntheticLastCompletion, householdLoad, now, {timezone})` | Yes — live placement against fetched household load map | FLOWING |
| batchCreateSeedTasks per-seed create | `next_due_smoothed` | `placedDates.get(i)` populated by in-loop placeNextDue calls | Yes — each seed's placement recorded before next seed's scoring | FLOWING |
| task-form Advanced section | `last_done` form value | RHF Controller bound to schema field; defaultValue seeds from `task?.last_done ?? null` | Yes — user-entered date serialized via `name="last_done"` into FormData | FLOWING |
| Integration Scenario 1 readback | task.next_due_smoothed | single PB `getFirstListItem` read after createTask invocation | Yes — real PB row on port 18101 with populated ISO string | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite green (regression) | `npm test -- --run` | 54 files, 492 tests passed, 0 failed | PASS |
| TypeScript compiles | `npx tsc --noEmit` | exit 0 | PASS |
| SDST tokens absent from production code | `grep -rn "seed-stagger\|SDST\|seed_stagger" --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' lib/ components/ pocketbase/ app/` | 0 lines | PASS |
| Port 18101 uniquely claimed | `grep -rn "const PORT = 18101" tests/unit/` | 1 match (tcsem-integration.test.ts:62) | PASS |
| Integration suite has exactly 3 scenarios | `grep -c "test('Scenario " tests/unit/tcsem-integration.test.ts` | 3 | PASS |
| computeFirstIdealDate consumer count | `grep -rn "computeFirstIdealDate" lib/ --include='*.ts'` | 5 files matched (load-smoothing.ts + tasks.ts + seed.ts + schemas/task.ts doc-ref + task-scheduling.ts doc-ref) — 2 new runtime consumers per Phase 13 | PASS |
| TCSEM bridge offset preserved (no short-circuit) | `grep -n "addDays(firstIdeal, -" lib/actions/` | 2 matches (tasks.ts:218, seed.ts:180) — both use `-freq` offset | PASS |
| No TODO/FIXME in Phase 13 modified files | `grep -n -E "TODO|FIXME|XXX|HACK|PLACEHOLDER" {the 6 modified files}` | 0 matches | PASS |
| No new migrations for Phase 13 (TCSEM-07) | `ls pocketbase/pb_migrations/ \| grep -i tcsem` | empty | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| TCSEM-01 | 13-02-P01 | Task form gains optional "Last done" date field in an Advanced collapsible (default collapsed) | SATISFIED | task-form.tsx:344-383 Collapsible (default closed) + Controller-bound last_done Input; schema last_done field; integration Scenario 1 exercises form→action→PB end-to-end. |
| TCSEM-02 | 13-01-P01 | "Last done" + cycle → first_ideal = last_done + frequency_days, then load-smoothed | SATISFIED | load-smoothing.ts:113-116 `addDays(lastDone, freq)`; load-smoothing.test.ts Tests 6-8; integration Scenario 1 (last_done=now-12d, freq=30, window [+10d,+26d]). |
| TCSEM-03 | 13-01-P01 | Blank last_done smart defaults: ≤7→tomorrow; 8..90→cycle/4; >90→cycle/3 | SATISFIED | load-smoothing.ts:118-121 exact formula; all 3 buckets + boundary tested in Tests 1-5 + 12. |
| TCSEM-04 | 13-01-P01 | New tasks ALWAYS have next_due_smoothed populated by TCSEM at creation | SATISFIED | tasks.ts single-op create body; seed.ts pre-computed `placedDates.get(i)` in batch create body; tasks-tcsem.test.ts Tests 1-3+5; integration Scenario 1 atomicity proof. |
| TCSEM-05 | 13-01-P01 | batchCreateSeedTasks threads in-memory load map between seeds → distributed cohort | SATISFIED | seed.ts:162-216 per-seed loop with `householdLoad.set(isoDateKey(...), prev+1)`; seed-tcsem.test.ts Tests 2-5; integration Scenario 2 (5-seed dates.size ≥ 4, no ≥3-cluster; observed 5 distinct dates in practice). |
| TCSEM-06 | 13-01-P01 | SDST removed: no via='seed-stagger' completions; no enum extension; no filters | SATISFIED | Code-level audit: 0 matches across lib/ components/ pocketbase/ app/; no `completions.via` migration in pb_migrations; seed-tcsem Test 6 runtime grep; integration Scenario 3 runtime PB query returns 0 rows. |
| TCSEM-07 | 13-01-P01 | v1.0 migration contract: zero changes to existing tasks | SATISFIED | No Phase 13 migration files; no backfill job; Phase 12 Plan 12-03's completeTaskAction step 7.5 is the upgrade path (already shipped); tasks-tcsem Test 4 proves freq=0 unreachable via form. |

**Orphaned requirements:** None. All 7 TCSEM REQ-IDs declared in plan frontmatter; all have test evidence.

### Anti-Patterns Found

None. Scan of all 6 Phase 13 modified/created production files turned up 0 TODO/FIXME/XXX/HACK/PLACEHOLDER markers. No empty-handler stubs, no hardcoded empty-data renders, no `return null` / `return {}` placeholders in the new code paths. The `nextDueSmoothed ?? ''` fallback at tasks.ts:276 is deliberate (PB stores '' as null for nullable date fields — D-06 fallback) and guarded by D-06 rationale in the surrounding JSDoc.

### Human Verification Required

None. All Phase 13 behaviors are mechanically verifiable:
- Smart-default formulas locked by unit tests with exact numeric assertions
- Bridge math preserved via synthetic-lastCompletion offset grep + offset-assert unit test
- SDST removal verified at code level (grep 0 matches) AND runtime level (PB query returns 0)
- Atomic write verified by single-read PB fetch in integration Scenario 1
- Cohort distribution verified by integration Scenario 2 live placement on port 18101

UI-level TCSEM-01 visual verification (Collapsible open/close animation, chevron rotation) is stylistically trivial — the guard semantics + gate logic + Controller binding + FormData serialization are all unit-asserted. No runtime Playwright/RTL test is required by any Phase 13 REQ-ID.

### Gaps Summary

None. All 5 ROADMAP Success Criteria verified; all 7 TCSEM REQ-IDs have test evidence on both unit (mocked) and integration (live-PB) surfaces where applicable. Full regression green at 492 tests passing. TypeScript clean. SDST double-locked (code audit + runtime audit). TCSEM synthetic-lastCompletion bridge preserved across both new consumers (createTask + batchCreateSeedTasks). v1.0 contract honored — no migrations, no backfill.

---

_Verified: 2026-04-22T12:45:00Z_
_Verifier: Claude (gsd-verifier)_
