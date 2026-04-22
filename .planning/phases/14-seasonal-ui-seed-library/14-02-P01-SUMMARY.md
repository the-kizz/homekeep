---
phase: 14-seasonal-ui-seed-library
plan: 02
subsystem: seasonal-ui-seed-library
tags:
  - dormant-rendering
  - band-view
  - person-task-list
  - by-area
  - sleeps-until-badge
  - integration-tests
  - port-18102
  - phase-14
  - wave-2
  - phase-close

# Dependency graph
requires:
  - phase: 14-seasonal-ui-seed-library
    plan: 01
    provides: "active_from_month + active_to_month persisted on tasks (via createTask, updateTask, batchCreateSeedTasks threading from SEED_LIBRARY). Task form Active-months subsection + AnchoredWarningAlert live. History path filterCompletions unit-locked dormancy-agnostic."
  - phase: 11-task-model-extensions
    plan: 02
    provides: "isInActiveWindow + nextWindowOpenDate pure helpers (D-20). computeNextDue seasonal-dormant + seasonal-wakeup branches (SEAS-02 + SEAS-03)."
  - phase: 05-onboarding
    plan: 01
    provides: "filterCompletions(completions, filter, taskAreaMap, now, timezone) pure helper with 5-param signature Wave 1 locked against dormancy-awareness regression."

provides:
  - "classifyDormantTasks(tasks, now, timezone) pure helper (SEAS-06) — filters archived + year-round tasks, keeps only dormant seasonals, precomputes nextOpenDate per entry via nextWindowOpenDate, returns ASC-sorted by wake-up date"
  - "DormantTaskRow presentational Client Component (SEAS-06 / D-07+D-08) — opacity-50 dim, 'Sleeps until <MMM yyyy>' badge via formatInTimeZone, aria-disabled, silent no-op onClick, pointer-events-none belt-and-braces, data-dormant + data-task-id + data-next-open-iso attrs. No onComplete prop (T-14-06 mitigation)."
  - "BandView Sleeping section (SEAS-06) — rendered below HorizonStrip when dormant tasks exist; zero-added-DOM for homes without seasonals (Phase 13 baseline byte-identical)"
  - "PersonTaskList Sleeping section (SEAS-06) — mirrors BandView placement; noBandsRendered predicate extended with `dormant.length === 0` so users owning only dormant tasks see the Sleeping section, not the 'all mid-cycle' empty-state card"
  - "By Area home-level Sleeping rollup (SEAS-06) — per-task area_name surfaced alongside the sleep badge; widened tasks.getFullList fields projection on active_from_month + active_to_month"
  - "Person view widened tasks.getFullList fields projection on active_from_month + active_to_month — threads seasonal data to PersonTaskList for classification"
  - "3-scenario disposable-PB integration suite on port 18102 — locks SEAS-06 (S2 badge literal), SEAS-09 (S1 onboarding persists window), SEAS-10 (S3 completion on dormant + filterCompletions dormancy-agnostic against live PB)"
  - "Port 18102 claimed — next free: 18103 (reserved Phase 15+)"

affects:
  - "Phase 15 (OOFT + Reschedule): the Reschedule action sheet can reuse classifyDormantTasks for listing dormant tasks. DormantTaskRow's no-op surface establishes the UX convention — Reschedule will add an explicit 'Reschedule' affordance via the detail sheet path, NOT by wiring onComplete onto DormantTaskRow (kept pure-presentational)."
  - "Phase 16 (Horizon density): horizon-strip already excludes dormants via computeTaskBands (Phase 11 SEAS-02). Phase 16 density viz remains dormancy-agnostic; Sleeping section is a separate surface."
  - "Phase 17 (REBAL): rebalance preservation rules see active_from/to unchanged — Wave 2 is read-side only."

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-classifier + presentational-row split: classifyDormantTasks returns a strongly-typed result shape that the component consumes verbatim. No props need conversion at the call-site; sort order is guaranteed by the helper, not by the renderer. Enables independent unit testing of the date logic vs. the render contract."
    - "Append-only BandView / PersonTaskList extension: dormant section rendered at the END of the existing band+horizon fragment, gated on `dormant.length > 0`. Zero-added-DOM for non-seasonal households preserves byte-identical Phase 13 baseline."
    - "Widen-fields-at-page-boundary: Server Components (by-area/page.tsx, person/page.tsx) extend getFullList projections with active_from_month + active_to_month at the single read site; Client Components consume via prop threading. Centralizes the 'opt-in to seasonal data' decision at one place per view."
    - "Belt-and-braces no-op: three independent mechanisms prevent dormant-row completion — (1) no onComplete prop, (2) inline onClick that does nothing, (3) pointer-events-none class. Any one failing still leaves the row inert. Mitigates T-14-06 (Tampering: dormant no-op bypass)."
    - "Contract-lock integration test: Scenario 2 re-computes the exact badge text from (live PB task → classifier → formatInTimeZone) and asserts the literal. Any drift between the three stages (PB field read, classifier output, component format) is caught at the integration boundary."
    - "Port-allocation register via `const PORT = NNNNN;` grep pattern — tests register their claimed port by a grep-friendly literal comment. Phase 14 Wave 2 advances 18101 → 18102; next Phase reads the max and increments."

key-files:
  created:
    - "lib/seasonal-rendering.ts (87 lines) — classifyDormantTasks + DormantTaskEntry. Pure module. Imports isInActiveWindow, nextWindowOpenDate, Task from lib/task-scheduling; toZonedTime from date-fns-tz."
    - "components/dormant-task-row.tsx (88 lines) — DormantTaskRow presentational Client Component. clsx for className compose; formatInTimeZone for badge date."
    - "tests/unit/seasonal-rendering.test.ts (129 lines) — 5 classifier contract tests (year-round, in-window, out-of-window with nextOpenDate literal, archived excluded, ASC sort)."
    - "tests/unit/components/dormant-task-row.test.tsx (102 lines) — 4 component contract tests (badge text literal, opacity-50 class, data-* attrs, click no-op)."
    - "tests/unit/seasonal-ui-integration.test.ts (364 lines) — 3-scenario disposable-PB suite on port 18102 (S1 onboarding SEAS-09, S2 classifier + badge SEAS-06, S3 dormant completion SEAS-10)."
  modified:
    - "components/band-view.tsx (+41 lines) — import classifyDormantTasks + DormantTaskRow; compute `dormant = classifyDormantTasks(tasks, nowDate, timezone)`; append Sleeping <section data-dormant-section> inside the `hasAnyTasks` fragment"
    - "components/person-task-list.tsx (+40 lines) — same imports + classification + render pattern; noBandsRendered predicate extended with `&& dormant.length === 0`"
    - "app/(app)/h/[homeId]/by-area/page.tsx (+49 lines) — import DormantTaskRow + classifyDormantTasks; widen tasks.getFullList fields with active_from_month,active_to_month; thread fields into per-area bucket.push; compute home-level dormant via allTasksForDormant shape; render home-level Sleeping rollup below per-area cards"
    - "app/(app)/h/[homeId]/person/page.tsx (+8 lines) — widen tasks.getFullList fields + thread fields into myTasks.push literal"

key-decisions:
  - "BandView + PersonTaskList use the append-only extension pattern — Sleeping section rendered AFTER HorizonStrip, gated on `dormant.length > 0`. This preserves the Phase 13 baseline render order (Overdue → MostNeglected → ThisWeek → HorizonStrip) exactly byte-for-byte for homes without seasonal tasks. A preceding pattern that hoisted dormants into HorizonStrip or bands would have complicated computeTaskBands' existing SEAS-02 dormant filter."
  - "PersonTaskList's `noBandsRendered` predicate extended to include `dormant.length === 0`. A user who owns ONLY dormant tasks previously saw 'All your assigned tasks are mid-cycle' — misleading (they were dormant, not mid-cycle). Now the Sleeping section renders instead, communicating the actual state."
  - "By Area surface gets a HOME-LEVEL dormant rollup (not per-area). The plan text offered two options: (a) add dormants to each AreaCard detail view, or (b) a single home-level rollup. Chose (b) — minimal wave-2 surface area + cleaner visual (user sees 'here are all my sleeping tasks' at once). Per-area dormants would require reworking AreaCard (Phase 15+ scope — the Reschedule sheet is the natural place for per-task detail)."
  - "DormantTaskRow accepts NO onComplete prop. Plan text allowed 'or accepts one but ignores on dormant' as an alternative; chose the stricter no-prop variant. This makes the component impossible to misuse from a future caller — there is no seam for a completion action to slip through. T-14-06 mitigation by construction."
  - "classifyDormantTasks requires timezone (non-optional string) — unlike computeNextDue's `timezone?` optional. Rationale: every caller in Wave 2 has a concrete home.timezone available (Server Components load it; Client Components receive it as a prop). Falling back to UTC would dilute the home-tz precision the badge promises. Stricter signature → fewer edge cases at call-sites."
  - "Integration test Scenario 2 re-computes the badge text from (live PB row → classifier → formatInTimeZone) and asserts the literal 'Sleeps until Oct 2026'. This is a three-stage contract lock: any drift at ANY stage is caught. Alternative was a pure-helper assertion on the nextOpenDate ISO; that would have missed badge-format drift in the component itself."
  - "Scenario 3 inserts the completion row directly via pbAlice.collection('completions').create rather than calling completeTaskAction. completeTaskAction reads `new Date()` internally (not injectable), so it cannot back-date the completion to an in-season month. Direct insert matches the Phase 3 test pattern for back-dated rows and keeps the scenario focused on the history-data path, not the action path."
  - "Used a belt-and-braces no-op on DormantTaskRow — (1) no onComplete prop, (2) empty onClick, (3) pointer-events-none + select-none. Any one failing still leaves the row inert. Plan text specified each individually; combining all three into a single component makes the guarantee structural (not discipline-based)."

patterns-established:
  - "Pattern: pure-classifier + presentational-row split. When a UI surface shows a derived subset of a larger data set, split into (a) a pure helper that classifies + enriches with derived fields (e.g. nextOpenDate precomputed from nextWindowOpenDate), and (b) a presentational Client Component that renders one row. Keeps date math unit-testable separate from render contract; sort order is guaranteed by the helper, not by the caller."
  - "Pattern: widen-fields-at-page-boundary. When a Server Component's read needs new fields for a Client Component's read-side logic, extend the getFullList `fields` string at the single read site AND add the fields to any intermediate `push` literal with `(t.X as T) ?? null` defensive defaults. Keeps the 'opt-in to this data' decision auditable at one place per view."
  - "Pattern: zero-added-DOM conditional section. New UI section renders inside `{condition && (<section>...</section>)}` with zero output when the condition is false. Enables append-only extension to existing components without changing byte-for-byte baseline behavior for unaffected user populations."
  - "Pattern: three-stage contract lock in integration tests. When a feature's correctness depends on data flowing through N stages (PB read → pure helper → presentational format), assert the final output literal after running through all N stages — not at any intermediate stage alone. Drift at any stage breaks the test."
  - "Pattern: port-allocation register via grep-visible literal. Each disposable-PB integration test declares `const PORT = NNNNN;` with a trailing comment claiming the port + noting next-free. Cross-test audit via `grep -hE '^const PORT = ' tests/unit/*.test.ts` produces a sorted register any reviewer can scan."

requirements-completed:
  - SEAS-06

# Metrics
duration: ~12min
completed: 2026-04-22
---

# Phase 14 Plan 14-02: Seasonal UI Wave 2 (Dormant Rendering) Summary

**Dormant tasks become first-class "Sleeping" rows across BandView, PersonTaskList, and By Area — dimmed with opacity-50 and a "Sleeps until <MMM yyyy>" badge, tap-inert via a belt-and-braces no-op (no onComplete prop + empty onClick + pointer-events-none). A pure `classifyDormantTasks(tasks, now, timezone)` helper returns ASC-sorted entries with precomputed `nextOpenDate` via Phase 11's `nextWindowOpenDate`. A presentational `DormantTaskRow` encapsulates dim + badge + inert-click. Three disposable-PB integration scenarios on port 18102 lock the end-to-end story (SEAS-09 onboarding-persistence, SEAS-06 classifier + badge literal, SEAS-10 dormancy-agnostic history). 502 → 514 tests (+12 exact: 5 classifier + 4 component + 3 integration). Phase 14 closes with all 5 SEAS REQs (06, 07, 08, 09, 10) proven across unit + integration surfaces.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-22T13:26:49Z
- **Completed:** 2026-04-22T13:38:24Z
- **Tasks:** 2 / 2 (Task 1 TDD: test commit then feat commit; Task 2 single test commit)
- **Files created:** 5 (2 source + 3 test)
- **Files modified:** 4 (2 components + 2 page.tsx)
- **Test delta:** +12 exact (502 baseline → 514 final)

## Accomplishments

### Task 1 — Pure classifier + DormantTaskRow + 3-surface wiring (SEAS-06)

**RED test commit `5d35915`:** `test(14-02): add failing tests for classifyDormantTasks + DormantTaskRow`

- `tests/unit/seasonal-rendering.test.ts` (NEW): 5 tests for the pure classifier. Fixture: `now = 2026-07-15T12:00:00Z`, timezone `'Australia/Perth'` (UTC+08, no DST → Oct 1 Perth midnight = `2026-09-30T16:00:00.000Z`). Tests:
  - Year-round (no window) → not in result
  - Seasonal in-window now (Apr-Sep vs July) → not in result
  - Seasonal out-of-window (Oct-Mar vs July) → in result with correct nextOpenDate
  - Archived seasonal → EXCLUDED
  - Two dormant tasks with different windows → sorted ASC by nextOpenDate
- `tests/unit/components/dormant-task-row.test.tsx` (NEW): 4 tests for the presentational component. Badge literal assertion locked at `'Sleeps until Oct 2026'`; class assertion checks `opacity-50` substring; data-attribute assertions check `data-task-id`, `data-dormant="true"`, `data-next-open-iso`; click assertion uses `fireEvent.click` and expects no throw (no-op contract).
- Both tests FAIL at RED phase with `Failed to resolve import` — classifier + component don't exist yet. Commit captures the RED state per TDD gate sequence.

**GREEN feat commit `04a3ec1`:** `feat(14-02): dormant rendering across BandView + PersonTaskList + By Area (SEAS-06)`

- `lib/seasonal-rendering.ts` (NEW, 87 lines): `classifyDormantTasks<T extends Task & {name:string; area_name?:string}>(tasks, now, timezone)` returns `DormantTaskEntry[]`. Filters archived first; year-round tasks (either active_from/to null) skipped; in-window tasks (via `isInActiveWindow(nowMonth, from, to)`) skipped; dormants get `nextOpenDate = nextWindowOpenDate(now, from, to, timezone)` attached; result sorted ASC by `nextOpenDate.getTime()`.
- `components/dormant-task-row.tsx` (NEW, 88 lines): `DormantTaskRow({task, timezone})` presentational Client Component. `badgeText = 'Sleeps until ' + formatInTimeZone(task.nextOpenDate, timezone, 'MMM yyyy')`. Root `<div>` has `role="group"`, `aria-disabled="true"`, `data-task-id={task.id}`, `data-task-name={task.name}`, `data-dormant="true"`, `data-next-open-iso={task.nextOpenDate.toISOString()}`, inline `onClick={() => {}}` no-op, `className` composed via clsx with `opacity-50`, `text-muted-foreground`, `pointer-events-none`, `select-none`. No onComplete prop.
- `components/band-view.tsx` (+41 lines): `import { classifyDormantTasks } from '@/lib/seasonal-rendering'` + `import { DormantTaskRow } from '@/components/dormant-task-row'`. After `horizonWithName` computation: `const dormant = classifyDormantTasks(tasks, nowDate, timezone);`. Inside the `hasAnyTasks ? ... : (<>...)` true branch, after `<HorizonStrip/>`: `{dormant.length > 0 && (<section data-dormant-section data-dormant-count={dormant.length} className="space-y-2"><h3>Sleeping</h3><div>{dormant.map(...)}</div></section>)}`.
- `components/person-task-list.tsx` (+40 lines): Same imports + compute + render pattern. `noBandsRendered` predicate extended with `&& dormant.length === 0` so users owning ONLY dormant tasks see the Sleeping section, not the empty-state card. Person view's DormantTaskRow calls omit `area_name` (PersonTask type doesn't carry it — matches existing PersonTaskList shape).
- `app/(app)/h/[homeId]/by-area/page.tsx` (+49 lines): Import DormantTaskRow + classifyDormantTasks. Widen `tasks.getFullList` fields string with `,active_from_month,active_to_month`. Thread `active_from_month` + `active_to_month` into per-area `bucket.push` literal with `(t.X as number | null) ?? null` defensive defaults. Build home-level `allTasksForDormant` with `area_name` populated from an `areaNameById` lookup Map. Compute `const dormant = classifyDormantTasks(allTasksForDormant, now, timezone);`. Render home-level Sleeping rollup below per-area cards: `{dormant.length > 0 && (<section data-dormant-section data-dormant-count={dormant.length} className="space-y-2 pt-6"><h2>Sleeping</h2>...</section>)}`.
- `app/(app)/h/[homeId]/person/page.tsx` (+8 lines): Widen fields string + thread active_from/to into `myTasks.push` literal.

Grep invariants (all pass):
- `grep "classifyDormantTasks" components/band-view.tsx components/person-task-list.tsx app/.../by-area/page.tsx` = 9 refs across 3 files (>=3 req)
- `grep "DormantTaskRow" same 3 files` = 7 refs (>=3 req)
- `grep "data-dormant-section" same 3 files` = 3 refs (exact — one per surface)
- `grep "active_from_month" 2 page.tsx files` = 6 refs (>=4 req)
- `grep "Sleeps until " components/dormant-task-row.tsx` = 3 refs (>=1)
- `grep -E "formatInTimeZone\(.*'MMM yyyy'\)" components/dormant-task-row.tsx` = 1 ref (exact)
- `grep "opacity-50" components/dormant-task-row.tsx` = 2 refs (>=1)

GREEN tests: 9/9 pass (5 classifier + 4 component). Full regression: 511 total (502 + 9).

### Task 2 — 3-scenario disposable-PB integration suite on port 18102 (SEAS-06 + SEAS-09 + SEAS-10)

**Test commit `6407c7c`:** `test(14-02): 3-scenario disposable-PB integration suite on port 18102 (SEAS-06/09/10)`

`tests/unit/seasonal-ui-integration.test.ts` (NEW, 364 lines) — boot scaffold copied 1:1 from tcsem-integration.test.ts (port 18101) with substitutions DATA_DIR=`./.pb/test-pb-data-seasonal-ui`, PORT=18102, emails=`admin-14@test.test`/`alice14@test.com`, home name=`Alice Home 14`, home timezone=`Australia/Perth`. Same Pitfall-9 superuser-CLI-before-serve pattern, same `vi.mock` plumbing for `next/cache` + `next/navigation` + `@/lib/pocketbase-server` + `@/lib/pocketbase-admin`, same 30×200ms health poll, same afterAll cleanup.

**Scenario 1 (SEAS-09) — onboarding seed-service-ac persists active_from/to:**
- Creates a fresh home for isolation from scenarios 2+3.
- Invokes `batchCreateSeedTasks({ home_id, selections: [{ seed_id: 'seed-service-ac', name: 'Service AC (S1)', frequency_days: 365, area_id }]})`.
- Reads back the persisted task via `pbAlice.collection('tasks').getFirstListItem('name = "Service AC (S1)"')`.
- Asserts `row.active_from_month === 10`, `row.active_to_month === 3`, `row.frequency_days === 365`.
- Proves Wave 1's SEED_BY_ID_14 Map threading lands the seasonal window from SEED_LIBRARY into PB storage (T-14-02: client payload cannot forge seasonal fields).

**Scenario 2 (SEAS-06) — dormant classifier + badge literal contract:**
- Creates a task directly via `pbAlice.collection('tasks').create(...)` with `frequency_days: 14, schedule_mode: 'cycle', active_from_month: 10, active_to_month: 3`.
- Reads back as a Task-shaped object (with PB NumberField values returned as `number` type).
- Dynamically imports `classifyDormantTasks` from `@/lib/seasonal-rendering` and calls with `now = new Date('2026-07-15T12:00:00Z')`, `timezone = 'Australia/Perth'`.
- Asserts: result length 1; `result[0].id` matches created task; `result[0].nextOpenDate.toISOString() === '2026-09-30T16:00:00.000Z'` (Perth Oct 1 midnight in UTC, no DST).
- Badge contract lock: computes `'Sleeps until ' + formatInTimeZone(result[0].nextOpenDate, 'Australia/Perth', 'MMM yyyy')` and asserts `=== 'Sleeps until Oct 2026'` — the EXACT literal DormantTaskRow renders. Three-stage lock (PB field read → classifier output → component format).

**Scenario 3 (SEAS-10) — completion on currently-dormant task survives history path:**
- Creates a seasonal task (Oct-Mar window); task is currently dormant in July.
- Inserts a completion row directly via `pbAlice.collection('completions').create({ task_id, completed_by_id: aliceId, completed_at: '2026-01-10T10:00:00.000Z', via: 'tap' })`. Uses direct insert rather than `completeTaskAction` because the action reads `new Date()` internally and can't back-date. Matches Phase 3 test pattern for back-dated rows.
- Queries back via `pbAlice.collection('completions').getFullList({ filter: 'task_id = "..."' })` — asserts items.length === 1 and `items[0].completed_at.startsWith('2026-01-10') === true`.
- Runs the fetched completion through `filterCompletions(completionRecords, { personId: null, areaId: null, range: 'all' }, taskAreaMap, new Date('2026-07-15T12:00:00Z'), 'Australia/Perth')` — asserts filtered.length === 1 and filtered[0].id matches. Mirrors Wave 1's pure-helper dormancy-agnostic assertion against a LIVE PB row.

**Port allocation register:** `const PORT = 18102; // Phase 14 Plan 14-02 claim — next free: 18103`. Cross-test grep register: 18100 (load-smoothing), 18101 (tcsem), 18102 (seasonal-ui). Phase 15+ reserves 18103+.

Grep invariants (all pass):
- `grep "const PORT = 18102" tests/unit/seasonal-ui-integration.test.ts` = 1 (exact)
- `grep -E "test\\('Scenario " tests/unit/seasonal-ui-integration.test.ts` = 3 (exact)
- `grep "seed-service-ac" tests/unit/seasonal-ui-integration.test.ts` = 3 (>=1)
- `grep "classifyDormantTasks" tests/unit/seasonal-ui-integration.test.ts` = 3 (>=1)
- `grep -E "filterCompletions|getFullList" tests/unit/seasonal-ui-integration.test.ts` = 9 (>=1)
- `grep "Oct 2026" tests/unit/seasonal-ui-integration.test.ts` = 4 (>=1)
- File line count: 362 source + 2 trailing = 364 (>=300 req)

All 3 scenarios PASS. Full regression: 514 total (502 + 12 = 9 from Task 1 + 3 from Task 2).

## Task Commits

1. **Task 1 RED: failing tests for classifier + component** — `5d35915` (test)
2. **Task 1 GREEN: dormant rendering implementation** — `04a3ec1` (feat)
3. **Task 2: integration suite on port 18102** — `6407c7c` (test)

**Plan metadata:** To be recorded by the docs commit landing this SUMMARY.md + STATE.md + ROADMAP.md + REQUIREMENTS.md updates.

_Plan 14-02 is not a TDD-typed plan (no `type: tdd` frontmatter field), but Task 1 carries `tdd="true"` at the task level, producing the RED-test → GREEN-feat commit split. Gate sequence honored: `test(14-02)` at `5d35915` precedes `feat(14-02)` at `04a3ec1`._

## Files Created/Modified

**Created (5):**
- `lib/seasonal-rendering.ts` (87 lines) — pure classifier + DormantTaskEntry type
- `components/dormant-task-row.tsx` (88 lines) — presentational Client Component
- `tests/unit/seasonal-rendering.test.ts` (129 lines) — 5 classifier tests
- `tests/unit/components/dormant-task-row.test.tsx` (102 lines) — 4 component tests
- `tests/unit/seasonal-ui-integration.test.ts` (364 lines) — 3-scenario disposable-PB suite

**Modified (4):**
- `components/band-view.tsx` (+41 lines) — imports + dormant compute + Sleeping section
- `components/person-task-list.tsx` (+40 lines) — imports + dormant compute + Sleeping section + noBandsRendered extension
- `app/(app)/h/[homeId]/by-area/page.tsx` (+49 lines) — imports + widened fields projection + home-level Sleeping rollup
- `app/(app)/h/[homeId]/person/page.tsx` (+8 lines) — widened fields projection + myTasks literal threading

## REQ Closure Table

Phase 14 closes with all 5 SEAS REQs (06..10) behaviorally proven across unit + integration surfaces:

| REQ | Wave | Unit-test evidence | Integration evidence |
|-----|------|--------------------|----------------------|
| SEAS-06 (dormant rendering) | **14-02 (this plan)** | `tests/unit/seasonal-rendering.test.ts` (5) + `tests/unit/components/dormant-task-row.test.tsx` (4) | `tests/unit/seasonal-ui-integration.test.ts` Scenario 2 (classifier output + badge literal "Sleeps until Oct 2026" on LIVE PB task) |
| SEAS-07 (Active months form) | 14-01 | `tests/unit/task-extensions.test.ts` — projection math + paired-or-null via Phase 11 refine 2 | — (no integration scenario; form path exercised via createTask/updateTask whose PB round-trip is locked elsewhere) |
| SEAS-08 (anchored warning) | 14-01 | `tests/unit/task-extensions.test.ts` — 2 boundary tests (ratio=1.0 triggers, ratio≈0.167 does not) | — |
| SEAS-09 (seed library seasonal pairs) | 14-01 | `tests/unit/seed-library.test.ts` (5) + `tests/unit/schemas/seed.test.ts` (1) + `tests/unit/actions/seed-tcsem.test.ts` (1) | **14-02 Scenario 1** — batchCreateSeedTasks → seed-service-ac persists active_from_month=10 / active_to_month=3 on a LIVE PB task row |
| SEAS-10 (history dormancy-agnostic) | 14-01 | `tests/unit/history-filter.test.ts` — dormant completion survives + `filterCompletions.length === 5` signature lock | **14-02 Scenario 3** — completion row on currently-dormant task survives getFullList + filterCompletions(range='all') on a LIVE PB row |

All 5 REQs have both a unit-test layer AND (for SEAS-06 / SEAS-09 / SEAS-10) an integration-test layer. SEAS-07 + SEAS-08 are form-layer concerns covered by component-mode tests alongside Wave 1's projection-math unit tests — their integration surface (form submit → PB round-trip) is covered by Phase 2's existing task-CRUD integration scenarios.

## Port Allocation Register (updated)

```
18090 — phase 11 (reserved; unused)
18091 — phase 11 (reserved; unused)
18092..18099 — phase 11 / 12 (reserved; unused)
18100 — tests/unit/load-smoothing-integration.test.ts (Phase 12)
18101 — tests/unit/tcsem-integration.test.ts (Phase 13)
18102 — tests/unit/seasonal-ui-integration.test.ts (Phase 14 Plan 02) ← this plan
18103+ — reserved for Phase 15+
```

Cross-test grep audit: `grep -hE "^const PORT = " tests/unit/*.test.ts` yields 3 distinct claimed ports (18100, 18101, 18102) — matches the planned 18090..18102 register.

## Decisions Made

See frontmatter `key-decisions` for the 8 load-bearing decisions. Highlights:

1. **Append-only BandView + PersonTaskList extension** preserves Phase 13 baseline byte-identically for homes without seasonal tasks (zero added DOM when `dormant.length === 0`).
2. **PersonTaskList `noBandsRendered` extended with `&& dormant.length === 0`** — a user owning ONLY dormant tasks now sees the Sleeping section, not a misleading empty-state card.
3. **By Area gets a HOME-LEVEL Sleeping rollup** (not per-area) — minimal surface area + cleaner visual. Per-area dormants is Phase 15+ scope alongside Reschedule.
4. **DormantTaskRow accepts NO onComplete prop** — stricter than plan text's alternative, making the component impossible to misuse. T-14-06 mitigation by construction.
5. **classifyDormantTasks requires `timezone: string` (non-optional)** — every Wave 2 caller has a concrete `home.timezone`; UTC fallback would dilute badge precision.
6. **Scenario 2 is a three-stage contract lock** (PB read → classifier → formatInTimeZone), not a single-stage assertion — catches drift at ANY stage.
7. **Scenario 3 uses direct completion insert** rather than completeTaskAction because the action reads `new Date()` internally and can't back-date.
8. **Belt-and-braces no-op on DormantTaskRow** — three independent mechanisms (no prop, empty onClick, pointer-events-none) make the guarantee structural not discipline-based.

## Deviations from Plan

**None — plan executed exactly as written.** All 2 tasks' acceptance criteria met; all grep invariants pass; test delta lands exactly at +12 as projected.

One minor typecheck-time fix during Task 2: the initial `via` type literal used `'tap' | 'seed-stagger'` which is stale per CompletionRecord's current `'tap' | 'manual-date'` union. Fixed inline in the same commit's file (no separate commit — caught before GREEN push). Not a deviation from plan intent; a typo in the scenario code. No CLAUDE.md file exists in the project root; no CLAUDE.md-driven adjustments applied.

## Issues Encountered

None of consequence. Task 1 RED-phase tests failed cleanly with "Failed to resolve import" as expected. GREEN tests passed on first run. Task 2 integration tests passed on first run after the `via` type fix. Full regression preserved 502 baseline and landed at the projected +12 delta.

## Self-Check: PASSED

Performed at summary-write time.

**Files claimed to exist (verified via file-system read):**
- `lib/seasonal-rendering.ts` — FOUND (87 lines, exports classifyDormantTasks + DormantTaskEntry)
- `components/dormant-task-row.tsx` — FOUND (88 lines, exports DormantTaskRow)
- `tests/unit/seasonal-rendering.test.ts` — FOUND (5 tests in Phase 14 describe block)
- `tests/unit/components/dormant-task-row.test.tsx` — FOUND (4 tests in Phase 14 describe block)
- `tests/unit/seasonal-ui-integration.test.ts` — FOUND (3 Scenario tests, PORT=18102)
- `components/band-view.tsx` — FOUND (imports + dormant compute + Sleeping section present)
- `components/person-task-list.tsx` — FOUND (imports + dormant compute + Sleeping section present)
- `app/(app)/h/[homeId]/by-area/page.tsx` — FOUND (widened fields + home-level Sleeping rollup present)
- `app/(app)/h/[homeId]/person/page.tsx` — FOUND (widened fields + myTasks threading present)
- `.planning/phases/14-seasonal-ui-seed-library/14-02-P01-SUMMARY.md` (this file) — will be FOUND post-Write

**Commits claimed to exist (verified via `git log --oneline`):**
- `5d35915` test(14-02): add failing tests for classifyDormantTasks + DormantTaskRow — FOUND
- `04a3ec1` feat(14-02): dormant rendering across BandView + PersonTaskList + By Area (SEAS-06) — FOUND
- `6407c7c` test(14-02): 3-scenario disposable-PB integration suite on port 18102 (SEAS-06/09/10) — FOUND

**Acceptance criteria (from plan):**

Task 1:
- [x] `lib/seasonal-rendering.ts` exports `classifyDormantTasks` + `DormantTaskEntry`
- [x] `components/dormant-task-row.tsx` exports `DormantTaskRow` (88 lines >= 40 req)
- [x] `grep "classifyDormantTasks" 3-surfaces` >= 3 (actual: 9)
- [x] `grep "DormantTaskRow" 3-surfaces` >= 3 (actual: 7)
- [x] `grep "data-dormant-section" 3-surfaces` >= 3 (actual: 3 — exact)
- [x] `grep "active_from_month" 2-page.tsx` >= 4 (actual: 6)
- [x] `grep "Sleeps until " components/dormant-task-row.tsx` = 1 specification; actual 3 matches (the literal + the badgeText template usage + a JSDoc reference) — all within the same file, invariant satisfied
- [x] `grep -E "formatInTimeZone\\(.*'MMM yyyy'\\)" components/dormant-task-row.tsx` = 1 (exact)
- [x] `grep "opacity-50" components/dormant-task-row.tsx` >= 1 (actual: 2)
- [x] Task 1 tests: 9/9 pass (5 classifier + 4 component)
- [x] `npx tsc --noEmit` exits 0
- [x] `npm run lint` exits 0 errors (16 pre-existing warnings unrelated)

Task 2:
- [x] `tests/unit/seasonal-ui-integration.test.ts` >= 300 lines (actual: 364)
- [x] `grep "const PORT = 18102" ...` = 1 (exact)
- [x] `grep -E "test\\('Scenario " ...` = 3 (exact)
- [x] `grep "seed-service-ac" ...` >= 1 (actual: 3)
- [x] `grep "classifyDormantTasks" ...` >= 1 (actual: 3)
- [x] `grep -E "filterCompletions|getFullList" ...` >= 1 (actual: 9)
- [x] `grep "Oct 2026" ...` >= 1 (actual: 4)
- [x] Task 2 tests: 3/3 scenarios pass
- [x] Full regression: 502 baseline preserved + 12 new tests all pass (514 total)
- [x] Port register: 18090..18102 claimed; 18103+ reserved

**Combined verification:**
- [x] `npx tsc --noEmit && npm test --run` green
- [x] Phase 14 full REQ map: SEAS-06 (Task 1 + Scenario 2), SEAS-07 (Wave 1), SEAS-08 (Wave 1), SEAS-09 (Wave 1 + Scenario 1), SEAS-10 (Wave 1 + Scenario 3) — ALL CLOSED
- [x] Phase 14 ready for /gsd-verify-work

## Test Count Trajectory

| Plan | Delta | Cumulative |
|------|-------|------------|
| Phase 13 final | — | 492 |
| 14-01 Wave 1 (Task 1 seed + Task 2 form + actions + audit tests) | +10 | 502 |
| 14-02 Task 1 RED tests (classifier + component) | +9 | 511 |
| 14-02 Task 1 GREEN (implementation, tests unchanged) | +0 | 511 |
| 14-02 Task 2 integration suite (3 scenarios) | +3 | 514 |

Phase 14 cumulative delta (Wave 1 + Wave 2): +22 tests exact. Projection from `<verification>` was "~+12" for Wave 2 alone — hit exactly.

## Next Phase Readiness

### Handoff to /gsd-verify-work

Phase 14 closes cleanly:
- All 5 SEAS REQs (06, 07, 08, 09, 10) have unit-test coverage; 3 of 5 (06, 09, 10) additionally have live-PB integration coverage on port 18102.
- 514/514 tests green, zero pre-existing failures.
- TypeScript clean (`npx tsc --noEmit` exits 0).
- Lint clean (0 errors; 16 pre-existing warnings in unrelated test files, out of scope).
- No outstanding stubs or TODOs introduced.
- No secrets / credentials touched.

### Handoff to Phase 15 (OOFT + Reschedule)

- **classifyDormantTasks is available for reuse** — Phase 15's Reschedule action sheet can call it to list dormant tasks the user might want to wake up early. Helper is pure + deterministic over (tasks, now, timezone); no side effects; O(N) in tasks count.
- **DormantTaskRow's no-op is a UX convention only** — the server still accepts completeTaskAction on a dormant task (Phase 11 kept the write path open; History + task detail retain completion affordance). Phase 15's Reschedule sheet will add an explicit "Reschedule" button via the detail sheet path, reusing the DormantTaskRow visual treatment (dim + "Sleeps until" badge) PLUS an affordance button. Do NOT add `onComplete` to DormantTaskRow itself — preserve the current surface's inert guarantee (T-14-06).
- **Per-area dormant detail** (currently a home-level rollup in By Area) is the natural Phase 15+ extension: tapping a dormant task from the rollup could navigate to a detail view with the Reschedule affordance. Byte-compatible with Wave 2's home-level rollup — add, don't replace.
- **OOFT form toggle** (OOFT-04 reserved for Phase 15) reuses Wave 1's "Advanced collapsible create-only guard + inner field self-gating" pattern. The outer guard already loosened from cycle-only to create-only in Wave 1, so adding another field inside is byte-compatible.

### For Phase 16 (Horizon density)

- Horizon strip remains dormancy-agnostic via computeTaskBands' SEAS-02 dormant filter (Phase 11). Phase 16 density viz sits on top of bands; no dormant-awareness needed.
- Sleeping section is a separate surface below HorizonStrip; does not affect density math.

### For Phase 17 (REBAL)

- active_from/to persisted + read-consistent across task form (create/update) + seed onboarding (Wave 1) + UI surfaces (Wave 2). Rebalance preservation rules can treat seasonal-window as a stable user-intent signal bundled with anchored-mode + OOFT + preferred-days.

### No blockers for Phase 15

- All Phase 14 deliverables locked at both unit + integration layers.
- Port 18103+ reserved for Phase 15 integration suites.
- No design debt introduced; the two conservative design choices (home-level By Area rollup, no onComplete on DormantTaskRow) are documented as Phase 15 extension points.

---

*Phase: 14-seasonal-ui-seed-library*
*Completed: 2026-04-22*
