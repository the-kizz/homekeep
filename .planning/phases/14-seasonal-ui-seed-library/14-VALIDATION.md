---
phase: 14-seasonal-ui-seed-library
purpose: planner-side validation contract
planned_at: 2026-04-22
total_plans: 2
total_waves: 2
---

# Phase 14 Validation — Seasonal UI & Seed Library

## Source Audit (Mandatory Coverage Check)

| Source type | Item | Plan | Task | Status |
|-------------|------|------|------|--------|
| GOAL | Seasonal tasks are first-class in the UI; authors set active months on the form; dormant tasks render sleeping; seed library ships two seasonal pairs | 14-01 + 14-02 | multiple | COVERED |
| REQ | SEAS-06 Dormant tasks render dimmed with "Sleeps until <Mon YYYY>" badge, not tap-completable | 14-02 | Task 1 (helper + row + wiring) + Task 2 Scenario 2 | COVERED |
| REQ | SEAS-07 Task form "Active months" optional section (from/to dropdowns) | 14-01 | Task 2 (form extension) | COVERED |
| REQ | SEAS-08 Form warns (does NOT block) when anchored task falls predominantly outside active window | 14-01 | Task 2 (AnchoredWarningAlert + projection math) | COVERED |
| REQ | SEAS-09 Seed library extends with two seasonal pairs (warm/cool mow; summer AC / winter heater) | 14-01 | Task 1 (4 seeds + thread through batchCreateSeedTasks) + 14-02 Task 2 Scenario 1 | COVERED |
| REQ | SEAS-10 History view shows completions regardless of current dormancy state | 14-01 | Task 2 (filterCompletions dormancy-agnostic unit test) + 14-02 Task 2 Scenario 3 | COVERED |
| RESEARCH | Phase 11 helpers (isInActiveWindow, nextWindowOpenDate) — consume in classifier + form warning math | 14-01 Task 2 + 14-02 Task 1 | form watch + classifyDormantTasks | COVERED |
| RESEARCH | Phase 13 Advanced collapsible — form extension point | 14-01 Task 2 | task-form.tsx edits | COVERED |
| RESEARCH | Phase 5 seed library pattern — extend only by appending entries | 14-01 Task 1 | 4 new entries | COVERED |
| CONTEXT | D-01 Active months inside existing Advanced collapsible, two shadcn-style selects | 14-01 Task 2 | task-form.tsx | COVERED |
| CONTEXT | D-02 Phase 11 zod paired-or-null + "To disabled until From" UX hint | 14-01 Task 2 | Controller + disabled=fromValue==null | COVERED |
| CONTEXT | D-03 Wrap example label "From October → To March" | 14-01 Task 2 | helper text paragraph | COVERED |
| CONTEXT | D-04 Warning math — 6 projections (k=0..5 × frequency_days), STRICTLY >50% dormant triggers | 14-01 Task 2 | AnchoredWarningAlert body | COVERED |
| CONTEXT | D-05 Inline amber Alert, below field group, dismissable-by-edit | 14-01 Task 2 | data-anchored-warning rendered on state, no dismiss button needed | COVERED |
| CONTEXT | D-06 No warning for cycle-mode (only anchored) | 14-01 Task 2 | gated on `scheduleMode === 'anchored'` | COVERED |
| CONTEXT | D-07 Visual style: opacity-50, muted-foreground, grayscale, shadcn Badge variant=secondary | 14-02 Task 1 | DormantTaskRow className | COVERED |
| CONTEXT | D-08 No-op tap (silent; badge communicates why) | 14-02 Task 1 | pointer-events-none + empty onClick | COVERED |
| CONTEXT | D-09 Three views get dormant treatment: BandView, By Area, Person | 14-02 Task 1 | 3 file edits | COVERED |
| CONTEXT | D-10 History unfiltered by dormancy | 14-01 Task 2 + 14-02 Task 2 Scenario 3 | SEAS-10 unit + integration | COVERED |
| CONTEXT | D-11 Two pairs = 4 seeds with specified IDs + frequencies + active months | 14-01 Task 1 | 4 entries appended | COVERED |
| CONTEXT | D-12 Northern hemisphere convention, warm=Apr-Sep; v1.2 localization deferred | 14-01 Task 1 | comment block on the seed entries | COVERED |
| CONTEXT | D-13 Seed discovery — new seeds appear in onboarding picker (data-only, no UI work) | 14-01 Task 1 | SEED_LIBRARY array append | COVERED |
| CONTEXT | D-14 History audit — confirm no dormancy filter; add test asserting completions of dormant tasks appear | 14-01 Task 2 | tests/unit/history-filter.test.ts SEAS-10 test | COVERED |
| CONTEXT | D-15 ~10 unit + 3 integration tests | 14-01 + 14-02 | +~9 unit (Wave 1+2) + 3 integration (Wave 2) = ~12 total | COVERED |
| CONTEXT | D-16 Port 18102 claimed | 14-02 Task 2 | const PORT = 18102 | COVERED |

**Source audit outcome: ALL ITEMS COVERED. Zero gaps.**

## Wave Structure

| Wave | Plan | Autonomous | Files | Tasks | Context budget |
|------|------|------------|-------|-------|----------------|
| 1 | 14-01 | true | 9 (seed library + form + actions + 4 test files) | 2 | ~35% |
| 2 | 14-02 | true | 9 (helper + component + 3 page/client edits + 3 test files) | 2 | ~45% |

Wave 2 DEPENDS on Wave 1 (files_modified overlap: `lib/actions/tasks.ts` is NOT touched in Wave 2, but Wave 2 Server Component task projections at `app/(app)/h/[homeId]/by-area/page.tsx` and `.../person/page.tsx` RELY on Wave 1's server-side active_from/to persistence being live — otherwise PB rows never have the field populated and Wave 2 tests would have no dormant tasks to classify).

## Test Delta Projection

| Plan | Task | Unit Tests | Integration Tests | Cumulative |
|------|------|------------|-------------------|------------|
| Phase 13 close baseline | — | — | — | 492 |
| 14-01 Task 1 (seed library + schema + onboarding-thread) | +7 unit | — | 499 |
| 14-01 Task 2 (form + projection + history audit) | +3 unit (2 projection + 1 history SEAS-10) | — | 502 |
| 14-02 Task 1 (classifier + component) | +9 unit (5 classifier + 4 component) | — | 511 |
| 14-02 Task 2 (integration suite) | — | +3 integration | 514 |
| **Phase 14 close** | **+19 unit** | **+3 integration** | **514 (+22 exact)** |

## Port Allocation Register (updated)

| Port | Phase | Plan | File |
|------|-------|------|------|
| 18090 | 02 | 01 | tasks-integration.test.ts |
| 18091 | 03 | 01 | completions-integration.test.ts |
| 18092 | 04 | 01 | invites-hook.test.ts |
| 18093 | 04 | 01 | invites-rules.test.ts |
| 18094 | 04 | 02 | invites-roundtrip.test.ts |
| 18095 | 05 | 01 | homes-onboarded.test.ts |
| 18096 | 06 | 01 | notifications-idempotency.test.ts |
| 18097 | 06 | 02 | scheduler-integration.test.ts |
| 18098 | 10 | 01 | schedule-overrides-integration.test.ts |
| 18099 | 11 | 03 | task-extensions-integration.test.ts |
| 18100 | 12 | 04 | load-smoothing-integration.test.ts |
| 18101 | 13 | 02 | tcsem-integration.test.ts |
| **18102** | **14** | **02** | **seasonal-ui-integration.test.ts (this phase)** |

Next free: **18103** (reserved for Phase 15).

## REQ → Evidence Map (Phase 14 close)

| REQ | Behavior | Evidence (unit) | Evidence (integration) |
|-----|----------|-----------------|------------------------|
| SEAS-06 | Dormant tasks render dimmed + Sleeps until badge + no-op tap | tests/unit/seasonal-rendering.test.ts (5 tests) + tests/unit/components/dormant-task-row.test.tsx (4 tests) | tests/unit/seasonal-ui-integration.test.ts Scenario 2 (classifier + badge literal on live PB row) |
| SEAS-07 | Form Active months from/to selects, both-blank=year-round, UX disable-to-until-from | components/forms/task-form.tsx acceptance grep (>= 4 active_from_month hits) + Phase 11 refine 2 paired-or-null | tests/unit/seasonal-ui-integration.test.ts Scenario 1 (seed flow persists window end-to-end) |
| SEAS-08 | Warning renders when anchored + >50% projected cycles dormant; never blocks save | tests/unit/task-extensions.test.ts projection-math tests (2 cases: 6/6 and 1/6 dormant) | Warning is pure presentation — no integration needed |
| SEAS-09 | SEED_LIBRARY has 4 new seasonal entries; onboarding threads active_from/to | tests/unit/seed-library.test.ts (5 assertions) + tests/unit/actions/seed-tcsem.test.ts (1 new) + tests/unit/schemas/seed.test.ts (1 new) | tests/unit/seasonal-ui-integration.test.ts Scenario 1 (seed-service-ac persists active_from=10/active_to=3 in PB) |
| SEAS-10 | History view shows completions regardless of dormancy | tests/unit/history-filter.test.ts SEAS-10 test | tests/unit/seasonal-ui-integration.test.ts Scenario 3 (completion row of dormant task survives getFullList + filterCompletions) |

All 5 SEAS REQs have behavioral proof on both unit-test (mocked) and integration-test (live-PB) surfaces at phase close.

## Quality Gate Checklist

- [x] 2 plans + VALIDATION.md
- [x] All 5 SEAS REQs covered (SEAS-06, 07, 08, 09, 10)
- [x] Port 18102 claimed in Wave 2
- [x] Anchored-warning threshold strictly >50% dormant (D-04)
- [x] Dormant rendering uses isInActiveWindow + nextWindowOpenDate (Phase 11)
- [x] Seed library +4 entries with correct active months (D-11)
- [x] Wave structure: 2 waves, 2 plans, Wave 2 depends on Wave 1 server-side persistence
- [x] Every PLAN.md has `requirements:` non-empty (SEAS IDs distributed)
- [x] STRIDE threat register present in both plans
- [x] Goal-backward must_haves: truths → artifacts → key_links per plan
