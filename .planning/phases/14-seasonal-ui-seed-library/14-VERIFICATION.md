---
phase: 14-seasonal-ui-seed-library
verified: 2026-04-22T13:50:00Z
status: gaps_found
score: 6/7 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
  gaps_closed: []
  gaps_remaining: []
  regressions: []
gaps:
  - truth: "Dormant tasks render dimmed with 'Sleeps until <MMM yyyy>' badge across By Area / Person / dashboard BandView"
    status: partial
    reason: "Dashboard BandView (`app/(app)/h/[homeId]/page.tsx`) does NOT project `active_from_month` or `active_to_month` in its `tasks.getFullList` fields string, and does NOT thread those fields into the `mappedTasks` literal handed to BandView. Every TaskWithName handed to BandView arrives with `active_from_month: undefined`, so `classifyDormantTasks` skips all tasks via the `from == null` guard. Result: the BandView Sleeping section never renders on the main dashboard, regardless of PB state. The PLAN 14-02 must_have #1 explicitly claims 'By Area view, Person view, and main BandView'; the CONTEXT §D-09 claims 'Three views get the dormant treatment'; the component wiring in `band-view.tsx` is correct but the upstream data is missing at the dashboard Server Component boundary. By Area (`by-area/page.tsx`) and Person (`person/page.tsx`) both correctly widen fields + thread through — only the dashboard surface is broken."
    artifacts:
      - path: "app/(app)/h/[homeId]/page.tsx"
        issue: "Line 102-107 `tasks.getFullList` fields string omits `active_from_month,active_to_month`. Line 132-162 `mappedTasks` mapping literal omits those fields. BandView's dormant classification can never fire on the dashboard because the data never arrives."
    missing:
      - "Widen `app/(app)/h/[homeId]/page.tsx` fields string (line ~106) to include `,active_from_month,active_to_month` alongside the existing projection"
      - "Thread `active_from_month: (t.active_from_month as number | null) ?? null` and `active_to_month: (t.active_to_month as number | null) ?? null` into the `mappedTasks.map()` literal (around lines 142-162)"
      - "Optional: add a regression test asserting `classifyDormantTasks` sees the dormant task when passed through the dashboard data pipeline (mirror the pattern already used in `by-area/page.tsx`)"
human_verification:
  - test: "Create a task with active_from_month=10, active_to_month=3 in a household, navigate to dashboard (`/h/{homeId}`) in July"
    expected: "Dormant task appears in a 'Sleeping' section below the HorizonStrip with opacity-50 + 'Sleeps until Oct 2026' badge; click does nothing; By Area and Person views also show the same treatment."
    why_human: "End-to-end visual verification across three surfaces; integration test only exercises the classifier + badge literal, not the Server Component → Client Component data pipeline at the dashboard"
  - test: "Open task form in create mode; select cycle mode; open Advanced; pick 'From October', verify 'To' unlocks; pick 'To March'; save"
    expected: "Form saves successfully; PB row has active_from_month=10, active_to_month=3; no anchored-warning renders (cycle mode is D-06 gated)"
    why_human: "Verifies UX disable-to-until-from hint and that paired-or-null zod refine chains cleanly into persistence. Unit tests cover each piece; this is the end-to-end form interaction."
  - test: "Switch schedule mode to anchored; pick anchor_date 2026-07-15; set active_from=10, active_to=3; frequency=365"
    expected: "Amber warning Alert renders inline (role='alert', data-anchored-warning, data-dormant-ratio='1.00'): 'Heads up: Most scheduled cycles fall outside the active window. The task will be dormant for those dates.' Save still succeeds."
    why_human: "Visual UX verification of the amber color + alert placement + non-blocking save behavior"
  - test: "In onboarding seed picker, confirm the 4 new seasonal seeds (mow-lawn-warm, mow-lawn-cool, service-ac, service-heater) render with icons (sprout, wind, flame) and descriptions"
    expected: "All 4 seeds appear in the picker grid alongside the existing 30; selecting any creates a task with correct active_from/to persisted"
    why_human: "Visual verification of seed picker UI; Scenario 1 proves persistence end-to-end but not the picker grid render"
---

# Phase 14: Seasonal UI & Seed Library — Verification Report

**Phase Goal:** Seasonal tasks first-class in UI. Authors set active months on task form; dormant tasks render dimmed with "Sleeps until" badge across By Area / Person / dashboard; seed library ships 2 seasonal pairs.
**Verified:** 2026-04-22T13:50:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Dormant tasks render dimmed with "Sleeps until MMM yyyy" badge in By Area + Person + dashboard BandView, with inert click | ✗ PARTIAL | By Area + Person wired correctly (pages widen fields + thread data); dashboard BandView wiring present in `band-view.tsx` (lines 324, 425-449) but upstream Server Component `app/(app)/h/[homeId]/page.tsx` does NOT project `active_from_month,active_to_month` in its fields string (line 106) nor thread them into `mappedTasks` (lines 132-162). BandView's Sleeping section cannot render on the dashboard. See Gap #1. |
| 2 | Task form exposes Active months subsection (From/To) with paired-or-null validation | ✓ VERIFIED | `components/forms/task-form.tsx` lines 428-496 render two native `<select>` dropdowns inside the Advanced Collapsible; MONTH_OPTIONS has all 12 months (line 82); `disabled={fromValue == null}` UX hint (line 466); Phase 11 zod refine 2 (paired-or-null) chains through the form's existing resolver. Server parsing present in `lib/actions/tasks.ts` both createTask (lines 109-114, 323-324) and updateTask (lines 383-387, 443-444) with `/^\d+$/` tamper-guard. |
| 3 | Anchored-warning Alert renders when strictly >50% of 6 projected cycles fall outside the active window; never blocks save | ✓ VERIFIED | `AnchoredWarningAlert` inline component (task-form.tsx lines 563-609) projects 6 cycles via `anchor + k * freq * 86400000` for k=0..5, counts `!isInActiveWindow(...)` matches, renders only if `ratio > 0.5` (line 595). Uses `role="alert"` + `data-anchored-warning` + `data-dormant-ratio` attrs. Parent gates on `scheduleMode === 'anchored'` (line 503). 2 unit tests lock the threshold edges (task-extensions.test.ts, ratio=1.0 triggers + ratio≈0.17 does not). |
| 4 | SEED_LIBRARY ships exactly 4 new seasonal entries (mow-warm, mow-cool, service-ac, service-heater) with correct active_from/to, threaded through batchCreateSeedTasks | ✓ VERIFIED | `lib/seed-library.ts` lines 304-347: 4 entries appended with correct active months (warm=Apr-Sep, cool=Oct-Mar per D-12 Northern convention). `lib/actions/seed.ts` contains the SEED_BY_ID_14 Map pattern that threads `.active_from_month`/`.active_to_month` into batch.create bodies. `tests/unit/seed-library.test.ts` locks all 4 entries + exactly-34-count invariant; `tests/unit/actions/seed-tcsem.test.ts` locks threading for seed-service-ac; Scenario 1 on port 18102 proves persistence end-to-end on a live PB row. |
| 5 | History view shows completions regardless of current dormancy state (filterCompletions is dormancy-agnostic) | ✓ VERIFIED | `tests/unit/history-filter.test.ts` SEAS-10 test + `filterCompletions.length === 5` signature lock — dormancy cannot enter the filter signature without breaking the test. Scenario 3 on port 18102 proves against a live PB row: completion on a currently-dormant task survives `getFullList` + `filterCompletions(range='all')`. `app/(app)/h/[homeId]/history/` has zero `active_from|active_to|isInActiveWindow` references (grep confirmed). |
| 6 | Port 18102 is claimed with a disposable-PB integration suite (3 scenarios) proving end-to-end contracts | ✓ VERIFIED | `tests/unit/seasonal-ui-integration.test.ts:65` declares `const PORT = 18102; // Phase 14 Plan 14-02 claim — next free: 18103`. 3 scenario tests (S1 seed persistence, S2 classifier + badge literal, S3 dormant completion in history) all pass on live disposable PB (verified via `npm test -- tests/unit/seasonal-ui-integration.test.ts --run` → 3/3). |
| 7 | 492+ baseline tests pass; total 514+ after Phase 14 delta | ✓ VERIFIED | `npm test --run` → **514/514 passing** across 57 test files (74.96s duration). Matches Wave 1 +10 + Wave 2 +12 = +22 delta exactly against the 492 baseline. TypeScript clean (`tsc --noEmit` exits 0). Lint clean (0 errors, 16 pre-existing warnings in unrelated test files). |

**Score:** 6/7 truths verified (1 partial — dashboard BandView data path broken)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `lib/seasonal-rendering.ts` | classifyDormantTasks + DormantTaskEntry exports | ✓ VERIFIED | 87 lines; pure helper; imports `isInActiveWindow`, `nextWindowOpenDate`, `toZonedTime`; tz-aware month extraction; archived + year-round filters; ASC sort by nextOpenDate |
| `components/dormant-task-row.tsx` | Presentational dimmed row with badge + no-op click | ✓ VERIFIED | 88 lines; 'use client'; `formatInTimeZone(..., 'MMM yyyy')`; `opacity-50` + `pointer-events-none` + empty onClick (belt-and-braces); aria-disabled; data-dormant attrs; NO onComplete prop (T-14-06 mitigation by construction) |
| `components/forms/task-form.tsx` | Active months subsection + AnchoredWarningAlert | ✓ VERIFIED | 11 hits of `active_from_month`; MONTH_OPTIONS constant; Controller + native `<select>` pairs; disable-to-until-from hint; AnchoredWarningAlert inline component with projection math + `data-anchored-warning` + `data-dormant-ratio` attrs |
| `lib/seed-library.ts` | 4 new seasonal entries + widened SeedTask type | ✓ VERIFIED | SeedTask extended with `active_from_month?` + `active_to_month?` (lines 49-50); 4 new entries (lines 308-347) with correct IDs + frequencies + windows per D-11 |
| `lib/actions/seed.ts` | batchCreateSeedTasks threads active_from/to | ✓ VERIFIED | SEED_BY_ID_14 Map pattern present; active_from_month + active_to_month threaded from library by seed_id (client payload never trusted for these fields, T-14-02) |
| `lib/actions/tasks.ts` | createTask + updateTask parse + persist active_from/to | ✓ VERIFIED | Both actions read from FormData with `/^\d+$/` tamper-guard (T-14-01); safeParse accepts them; PB create/update bodies persist via `'' = clear` convention consistent with anchor_date |
| `lib/schemas/seed.ts` | seedSelectionSchema widened | ✓ VERIFIED | 1 hit of `active_from_month`; mirrors taskSchema shape; `.int().min(1).max(12).nullable().optional()` |
| `components/band-view.tsx` | Dormant section rendered below HorizonStrip | ⚠️ ORPHANED | Wiring correct (import + classifyDormantTasks call + Sleeping section); but upstream data source (`app/(app)/h/[homeId]/page.tsx`) does not project active_from/to, so dormant array is always empty on dashboard. See Gap #1. |
| `components/person-task-list.tsx` | Same dormant pattern + noBandsRendered extension | ✓ VERIFIED | Import + classify + Sleeping section; noBandsRendered predicate extended with `&& dormant.length === 0`; person/page.tsx widens fields + threads data |
| `app/(app)/h/[homeId]/by-area/page.tsx` | Widened fields + home-level Sleeping rollup | ✓ VERIFIED | Fields string includes `,active_from_month,active_to_month` (line 74); allTasksForDormant literal threads both fields (lines 167-168); home-level dormant section rendered below per-area cards (lines 220-240) |
| `app/(app)/h/[homeId]/person/page.tsx` | Widened fields + threaded into myTasks | ✓ VERIFIED | Fields string (line 120) includes both fields; myTasks.push literal threads both (lines 157-158) |
| `app/(app)/h/[homeId]/page.tsx` | Widened fields + threaded into mappedTasks | ✗ MISSING | Dashboard page NOT modified by Phase 14; fields string (line 106) does NOT include active_from_month or active_to_month; mappedTasks literal (lines 132-162) does NOT thread them. This is the source of Gap #1. |
| `tests/unit/seasonal-rendering.test.ts` | 5 classifier tests | ✓ VERIFIED | All 5 pass (year-round/in-window/out-of-window/archived/sort) |
| `tests/unit/components/dormant-task-row.test.tsx` | 4 component tests | ✓ VERIFIED | All 4 pass (badge literal, opacity-50, data-attrs, click no-op) |
| `tests/unit/seasonal-ui-integration.test.ts` | 3-scenario integration suite on port 18102 | ✓ VERIFIED | 364 lines; `const PORT = 18102`; 3 Scenario tests all pass |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| components/band-view.tsx | lib/seasonal-rendering.ts | classifyDormantTasks(tasks, nowDate, timezone) | ⚠️ PARTIAL | Call present (line 324), rendering present (lines 425-449), but upstream data source lacks active_from/to fields — classifier always receives undefined, always returns empty array |
| components/person-task-list.tsx | lib/seasonal-rendering.ts | classifyDormantTasks(tasks, nowDate, timezone) | ✓ WIRED | Call present (line 186), rendering present (lines 235-260), upstream person/page.tsx projects fields + threads data |
| components/dormant-task-row.tsx | date-fns-tz formatInTimeZone | badge text = 'Sleeps until ' + formatInTimeZone(nextOpenDate, tz, 'MMM yyyy') | ✓ WIRED | Line 47: `formatInTimeZone(task.nextOpenDate, timezone, 'MMM yyyy')` + prefix; integration S2 locks 'Sleeps until Oct 2026' literal end-to-end |
| by-area/page.tsx | tasks.getFullList fields | fields list extended with active_from_month,active_to_month | ✓ WIRED | Line 74 includes both fields |
| person/page.tsx | tasks.getFullList fields | fields list extended with active_from_month,active_to_month | ✓ WIRED | Line 120 includes both fields |
| **dashboard page.tsx** | **tasks.getFullList fields** | **fields list extended** | **✗ NOT_WIRED** | **Line 106 fields string does NOT include active_from_month or active_to_month; dashboard BandView cannot surface dormant tasks** |
| components/forms/task-form.tsx | lib/schemas/task.ts | taskSchema active_from/to paired nullable optionals (Phase 11 refine 2) | ✓ WIRED | Form submits via existing resolver; refine 2 already present from Phase 11 |
| components/forms/task-form.tsx | FormData serialization | two native <select name="active_from_month"/> inputs emit numeric strings | ✓ WIRED | select name attrs present; server actions parse via `/^\d+$/` + Number() |
| lib/actions/seed.ts | lib/seed-library.ts | batchCreateSeedTasks matches selection.seed_id to SEED_LIBRARY entry | ✓ WIRED | SEED_BY_ID_14 Map + create-body threading; Scenario 1 proves end-to-end on live PB |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| dashboard BandView Sleeping section | `dormant` | `classifyDormantTasks(tasks, nowDate, timezone)` where tasks comes from `app/(app)/h/[homeId]/page.tsx` mappedTasks | **NO** — mappedTasks strips active_from/to; classifier receives undefined; dormant array always empty | ✗ HOLLOW — wired but data disconnected |
| Person Sleeping section | `dormant` | `classifyDormantTasks(tasks, nowDate, timezone)` where tasks comes from person/page.tsx myTasks (threads active_from/to) | YES | ✓ FLOWING |
| By Area Sleeping rollup | `dormant` | `classifyDormantTasks(allTasksForDormant, now, timezone)` built from tasksRaw (fields widened) | YES | ✓ FLOWING |
| task-form AnchoredWarningAlert | `dormantCount/6` ratio | watch('anchor_date'), watch('active_from_month'), watch('active_to_month'), watch('frequency_days') | YES — live RHF state | ✓ FLOWING |
| Onboarding seed active_from/to | PB task row `active_from_month` | batchCreateSeedTasks reads from SEED_LIBRARY by seed_id, writes to pb.collection('tasks').create body | YES — locked by Scenario 1 on live PB | ✓ FLOWING |
| History view completions | filterCompletions result | getFullList → filterCompletions (5-param signature, dormancy-agnostic by construction) | YES | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript compiles cleanly | `npx tsc --noEmit` | exit 0 | ✓ PASS |
| Phase 14 unit tests pass | `npm test -- seasonal-rendering dormant-task-row seed-library history-filter task-extensions schemas/seed --run` | 6 files, 86 tests passing | ✓ PASS |
| Phase 14 integration tests pass | `npm test -- tests/unit/seasonal-ui-integration.test.ts --run` | 3 scenarios pass in 2.13s | ✓ PASS |
| Full regression | `npm test --run` | 57 files, 514 tests passing (74.96s) | ✓ PASS |
| Lint clean (0 errors) | `npm run lint` | 0 errors, 16 pre-existing warnings in unrelated test files | ✓ PASS |
| Exactly 4 new seasonal seeds present | `grep -c "seed-mow-lawn-warm\|seed-mow-lawn-cool\|seed-service-ac\|seed-service-heater" lib/seed-library.ts` | 4 | ✓ PASS |
| Port 18102 claim literal present | `grep "const PORT = 18102" tests/unit/seasonal-ui-integration.test.ts` | 1 hit | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SEAS-06 | 14-02 | Dormant tasks render dimmed with "Sleeps until" badge in By Area and Person views | ⚠️ PARTIAL | By Area ✓ wired + data flowing; Person ✓ wired + data flowing; dashboard BandView wired but data disconnected (Gap #1). **ROADMAP SC-2 only names "By Area and Person", so REQ technically satisfied at the REQ level** — but PLAN must_haves #1 explicitly claim BandView too. Down-scoping to REQ wording would PASS this REQ. |
| SEAS-07 | 14-01 | Task form gains optional "Active months" section (from/to month dropdowns) | ✓ SATISFIED | Two native selects inside Advanced collapsible; MONTH_OPTIONS + Controllers + paired disable UX; Phase 11 refine 2 enforces paired-or-null at the schema layer. createTask + updateTask both persist. |
| SEAS-08 | 14-01 | Form warns (does NOT block) when anchored task falls predominantly outside active window | ✓ SATISFIED | AnchoredWarningAlert with `ratio > 0.5` strict threshold per D-04; non-blocking (advisory only); 2 unit tests lock both boundary edges |
| SEAS-09 | 14-01 | Seed library extends with two seasonal task pairs | ✓ SATISFIED | 4 entries (mow warm/cool, AC, heater) persisted through batchCreateSeedTasks; 5 unit assertions + 1 integration scenario on live PB |
| SEAS-10 | 14-01 | History view always shows completions regardless of current season state | ✓ SATISFIED | filterCompletions signature locked at 5 params (no dormancy surface); unit test + live-PB Scenario 3 both confirm dormant task completion survives filtering |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `app/(app)/h/[homeId]/page.tsx` | 102-107, 132-162 | Server Component fetches tasks with `fields:` projection that omits active_from_month, active_to_month; mappedTasks literal does not thread them | 🛑 Blocker (for dashboard BandView) | BandView Sleeping section cannot render on dashboard; Gap #1 |

No TODO/FIXME/placeholder comments introduced by Phase 14. No stub implementations. No hardcoded empty data on rendering paths (other than the `fields` projection omission above).

### Human Verification Required

See `human_verification:` frontmatter. 4 items requiring human UX testing (dashboard + by-area + person visual; task form Active months UX; anchored warning Alert appearance; seed picker render).

### Gaps Summary

**One partial gap blocking full goal achievement on the dashboard surface.**

The Phase 14 implementation is ~95% complete:
- All 5 SEAS REQ-IDs are covered by unit tests AND (for SEAS-06/09/10) live-PB integration scenarios
- Task form Active months subsection + AnchoredWarningAlert ship and work
- Seed library grows to 34 entries with 4 new seasonal pairs correctly threaded through onboarding
- By Area + Person views correctly classify + render dormant tasks
- History view locked dormancy-agnostic at both unit + integration layers
- 514/514 tests green; TypeScript clean; 0 lint errors

The single gap: the main dashboard surface (`app/(app)/h/[homeId]/page.tsx`) was NOT modified by Phase 14 Wave 2, yet `components/band-view.tsx` was wired to render a Sleeping section. The component wiring is correct, but the upstream Server Component strips `active_from_month` and `active_to_month` from its PB projection (line 106) and doesn't thread them into mappedTasks (lines 132-162). BandView therefore receives every task with `active_from_month: undefined`, and `classifyDormantTasks` skips them all as "year-round" via the `from == null` guard. The Sleeping section on the dashboard will never render regardless of PB state.

**Interpretation options:**

1. **Strict (PLAN must_haves):** Gap is real. PLAN 14-02 must_have #1 explicitly claims "By Area view, Person view, and main BandView"; CONTEXT §D-09 names all three. Dashboard rendering is broken.
2. **Scope-to-REQ (ROADMAP SC-2):** SC-2 only names "By Area and Person". Dashboard BandView is scope overreach from the plan. REQ technically satisfied.

**Recommendation:** Fix the dashboard data path. It's a 2-line change (widen fields string + thread mappedTasks literal) that aligns the implementation with the PLAN's claimed surface coverage and the CONTEXT's intent. The cost of fixing is trivial; shipping this gap would confuse users who authored seasonal tasks and never see them surfaced on the dashboard despite the Sleeping section existing elsewhere.

**This looks intentional on the REQ side but unintentional on the PLAN side.** The wave-2 plan's files_modified list omits `app/(app)/h/[homeId]/page.tsx` — suggesting the dashboard edit was simply forgotten. To accept this deviation (ship as-is, dashboard surface deferred), add to VERIFICATION.md frontmatter:

```yaml
overrides:
  - must_have: "Dormant tasks render dimmed with 'Sleeps until <MMM yyyy>' badge across By Area / Person / dashboard BandView"
    reason: "Dashboard BandView intentionally deferred; ROADMAP SC-2 only names 'By Area and Person views' which are both wired correctly. The BandView Sleeping section wiring will activate automatically when Phase 15 or later widens the dashboard's task fields projection for another purpose."
    accepted_by: "keiron"
    accepted_at: "2026-04-22T14:00:00Z"
```

Otherwise, send back to `/gsd-plan-phase --gaps` for a minimal Wave 3 plan that widens the dashboard fields projection + threads active_from/to into mappedTasks, plus optionally a regression test.

---

_Verified: 2026-04-22T13:50:00Z_
_Verifier: Claude (gsd-verifier)_
