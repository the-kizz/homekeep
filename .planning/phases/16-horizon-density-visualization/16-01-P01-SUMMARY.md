---
phase: 16
plan: 01
subsystem: horizon-density-visualization
tags:
  - phase-16
  - horizon-density
  - shift-badge
  - task-detail-sheet
  - load-visualization
  - lviz
requirements-closed: [LVIZ-01, LVIZ-02, LVIZ-03, LVIZ-04, LVIZ-05]
provides: "Horizon-density tint + ⚖️ ShiftBadge + TaskDetailSheet Schedule section — full UI read for the Phase 12 LOAD smoother"
dependency_graph:
  requires:
    - "lib/task-scheduling.ts#computeNextDue (Phase 2 + 10 + 11 + 12) — pure helper consumed by both getIdealAndScheduled and computeMonthDensity"
    - "lib/horizon-density.ts (NEW, this plan) — getIdealAndScheduled + computeMonthDensity + ShiftInfo"
    - "components/ui/sheet.tsx + components/ui/card.tsx — shadcn primitives preserved from Phase 3"
    - "tasks.next_due_smoothed field (Phase 12 LOAD-01) — read input for displacement detection"
    - "tasks.active_from_month/active_to_month (Phase 11 SEAS-01) — threaded for Schedule-section dormant exclusion"
  provides:
    - "lib/horizon-density.ts → getIdealAndScheduled + computeMonthDensity pure helpers + ShiftInfo type"
    - "components/shift-badge.tsx → ShiftBadge Client Component (⚖️ emoji + aria-label + title tooltip)"
    - "components/horizon-strip.tsx → density tint via bg-primary/{10,30,50} + Sheet drawer ShiftBadge"
    - "components/task-row.tsx → optional shiftInfo prop + inline ShiftBadge next to task name"
    - "components/task-band.tsx → optional shiftByTaskId Map prop threaded to TaskRow in both render branches"
    - "components/task-detail-sheet.tsx → Schedule section with Ideal/Scheduled dates + 'Shifted by N days' copy (D-08)"
    - "BandView + PersonTaskList → per-render shiftByTaskId compute, threaded to TaskBand/HorizonStrip/TaskDetailSheet"
  affects:
    - "Phase 17 REBAL — UI surface ready to show the effect of a manual rebalance (⚖️ badges flip on/off as next_due_smoothed mutates)"
    - "Phase 14 dormant surface — still untouched (DormantTaskRow has no ShiftBadge; D-07 compat preserved)"
    - "v1.2+ effort-aware density — the computeMonthDensity helper's Map<string, number> shape is the natural extension point"
tech-stack:
  added: []
  patterns:
    - "Pure helper module (lib/horizon-density.ts) mirroring lib/seasonal-rendering.ts posture — no I/O, no Date.now, deterministic"
    - "Strip-smoothed natural-baseline (D-04): `{...task, next_due_smoothed: null}` shallow-clone pattern re-used from Phase 15 RescheduleActionSheet"
    - "Per-render shift-map compute in parent, Map<id, {idealDate, scheduledDate, displaced}> threaded down — consumers stay render-only"
    - "Native `title` tooltip (no radix-tooltip dep) — D-05 discretion call"
    - "Three-tier density tint via `count/maxCount` normalisation — D-01 classification"
    - "Detail-sheet Schedule section gated on `shift.displaced` — section omitted entirely when ideal === scheduled (D-08/D-09)"
key-files:
  created:
    - "lib/horizon-density.ts (~132 lines — getIdealAndScheduled + computeMonthDensity + ShiftInfo)"
    - "components/shift-badge.tsx (~55 lines — inline ⚖️ span + title tooltip)"
    - "tests/unit/horizon-density.test.ts (8 tests — pure helper matrix)"
    - "tests/unit/components/shift-badge.test.tsx (3 tests — render shape)"
    - "tests/unit/components/horizon-strip-density.test.tsx (5 tests — tint-tier + dots-removed)"
    - "tests/unit/components/task-detail-sheet-schedule.test.tsx (3 tests — Schedule section gate)"
    - "tests/unit/horizon-density-integration.test.ts (~555 lines, 3 scenarios on port 18104)"
  modified:
    - "components/horizon-strip.tsx (+47 lines — shiftByTaskId prop, density tint, Sheet-drawer badge, 3-dot render removed)"
    - "components/task-row.tsx (+14 lines — shiftInfo prop + inline ShiftBadge next to task name)"
    - "components/task-band.tsx (+34 lines — shiftByTaskId prop + threading to TaskRow in both branches)"
    - "components/task-detail-sheet.tsx (+67 lines — widened task prop, lastCompletion prop, Schedule section + SheetDescription OOFT copy)"
    - "components/band-view.tsx (+22 lines — shiftByTaskId compute + prop pass to TaskBand×2 + HorizonStrip + TaskDetailSheet task-prop widen + lastCompletion threaded)"
    - "components/person-task-list.tsx (+19 lines — mirrors BandView for Person view)"
    - "app/(app)/h/[homeId]/page.tsx (+7 lines — fields projection widened + mappedTasks literal extended)"
    - "app/(app)/h/[homeId]/person/page.tsx (+9 lines — fields projection widened + myTasks.push literal extended)"
    - "tests/unit/horizon-strip.test.tsx (-22 +30 lines — retired 3-dot + +N overflow tests, consolidated into count-invariant test)"
decisions:
  - "mkTask test helper uses `'frequency_days' in partial` (NOT nullish-coalesce) — nullish-coalesce silently upgrades a passed `null` to the default 14, collapsing the OOFT test case to cycle. Discovered during Task 1 GREEN."
  - "window.matchMedia polyfilled at beforeAll in the task-detail-sheet-schedule test file — jsdom ships without it and TaskDetailSheet's useIsDesktop calls window.matchMedia inside a useEffect. Minimal MediaQueryList-shaped shim returns matches=false (mobile branch) for all queries."
  - "Task-detail-sheet-schedule tests query via `document.body.querySelector(...)` not `container` — shadcn Sheet portals its SheetContent out of the render container, so scoped queries miss. cleanup() runs between tests to prevent portaled DOM leak across it blocks."
  - "Retired the Phase 3 horizon-strip.test.tsx assertions on 3 dots + `+N` overflow — those locked the legacy render that D-01 explicitly replaces. Consolidated into a single test that asserts data-month-count is still load-bearing + no +N label ever surfaces + old 3-dot spans no longer render."
  - "TaskDetailSheet's SheetDescription line now reads 'One-off' (not the nonsensical 'Every null days') for OOFT tasks — paired with the frequency_days widening to number|null. Small copy-polish deviation (Rule 2): the existing code would render 'Every null days' once OOFT tasks opened the detail sheet, which is a pre-existing bug that only surfaces with the widened type."
  - "HorizonStrip max-count normaliser computed over buckets.values() length (not tasks.length) — empty-Map floor at 1 prevents divide-by-zero at the edges even though the emptyHorizon short-circuit upstream already handles zero-task cases."
  - "Schedule-section section omits entirely (NOT a placeholder 'No shift' state) — D-09 'hide when equal' plus LVIZ-05 reading 'section shows ideal-vs-scheduled WHEN smoothed' both point to no empty state."
  - "Integration suite Scenario 1 keeps the assertion conditional on displaced=true — in a single-task cluster the LOAD smoother legitimately chooses the exact natural day (no load pressure from siblings), so the assertion branches on the outcome rather than asserting displaced must be true. Three-stage lock still holds: the helper's verdict matches the UI-format pair's differ/match decision."
metrics:
  duration: ~40min
  completed: 2026-04-22
  tasks: 5
  files_created: 7
  files_modified: 9
  tests_added: 22 (8 helper + 3 shift-badge + 5 horizon-density + 3 schedule + 3 integration)
  tests_total: 560 (539 baseline + 21 net new — one legacy horizon-strip test was retired/consolidated)
---

# Phase 16 Plan 01: Horizon Density Visualization Summary

Phase 16 Plan 01 closes the UX loop on the Phase 12 LOAD smoother —
tasks the smoother displaced now wear a ⚖️ badge across every
primary task surface, the HorizonStrip tints month cells
proportional to density, and the TaskDetailSheet surfaces the
ideal-vs-scheduled dates when LOAD pushed a task off its natural
cadence. 7 files created, 9 modified, 21 net new tests (539 → 560
baseline), TypeScript clean, lint clean (0 new warnings).

## What Was Built

### Pure helpers (`lib/horizon-density.ts`)

Two exports, zero side effects, deterministic over
`(task, lastCompletion, now, timezone)`:

**`getIdealAndScheduled(task, lastCompletion, now, tz): ShiftInfo`**

Runs `computeNextDue` twice — once unmodified (returning `scheduled`)
and once with `next_due_smoothed` stripped via a shallow clone
(returning `ideal`, the natural cadence date). Compares day-rounded
UTC instants; `displaced = abs(scheduledMs - idealMs) / 86_400_000 >= 1`.

Null either side (archived task, same-season dormant, completed OOFT
→ `computeNextDue` returns null) collapses `displaced` to `false` by
construction. LOAD-06 anchored bypass is handled upstream — the
`schedule_mode` guard inside `computeNextDue` ignores the smoothed
field for anchored tasks, so both paths collapse to the same anchor
result and the helper reports `displaced=false` without needing an
explicit short-circuit.

**`computeMonthDensity(tasks, latestByTask, now, tz): Map<string, number>`**

Bucket-counter keyed by `formatInTimeZone(nextDue, tz, 'yyyy-MM')`.
Months with zero tasks do NOT appear in the Map (D-03: consumers
render default background for missing keys). Exclusions are all
upstream — archived / dormant / completed-OOFT / invalid-freq tasks
return null from `computeNextDue` and are silently skipped.

### `<ShiftBadge>` (`components/shift-badge.tsx`)

Inline `<span>` rendering the ⚖️ balance-scale emoji with
`aria-label="Shifted"` + native `title` tooltip "Shifted from
{idealDate} to {scheduledDate} to smooth household load" (D-05).
No new radix-tooltip dep — ships everywhere with zero weight added.
Caller guarantees `displaced=true` upstream; the component renders
unconditionally whenever mounted. T-16-01 Information Disclosure
mitigation: tooltip built from `formatInTimeZone` output, no
user-controlled string flows in.

### HorizonStrip density tint (`components/horizon-strip.tsx`)

- **Tint (D-01, LVIZ-01)**: per-cell background tint computed from
  `count / max(buckets.values())`. Empty → no tint. `ratio ≤ 0.33` →
  `bg-primary/10`. `0.33 < ratio ≤ 0.66` → `bg-primary/30`. `ratio >
  0.66` → `bg-primary/50`.
- **Legacy 3-dot render REMOVED (D-01)**: the per-cell 0..3 warm-dot
  spans + `+N` overflow label are gone. Density tint carries the
  at-a-glance signal; the Sheet drawer still surfaces exact
  per-month tasks on tap.
- **Drawer ShiftBadge (D-06, LVIZ-03)**: when `shiftByTaskId` has a
  `displaced=true` entry for a task, the drawer `<li>` renders
  `<ShiftBadge>` inline next to the task name.
- **Backward-compat**: `shiftByTaskId` is optional. Existing callers
  without it get the v3 tap-to-open-drawer behaviour byte-identical
  (Sheet + data-month-key + data-month-count + current-month border
  all preserved).

### TaskRow + TaskBand threading

- `TaskRow`: new optional `shiftInfo?: { idealDate, scheduledDate,
  timezone }` prop renders `<ShiftBadge>` next to `task.name`.
- `TaskBand`: new optional `shiftByTaskId?: Map<...>` prop pulled
  into both render branches (no-group + grouped) — for each task,
  checks `shiftByTaskId.get(t.id)?.displaced`, threads the
  derived `shiftInfo` to `TaskRow`.

### TaskDetailSheet Schedule section (`components/task-detail-sheet.tsx`)

- **Widened `task` prop shape**: `frequency_days: number | null`
  (OOFT ready), plus six new optional fields — `created`,
  `active_from_month`, `active_to_month`, `preferred_days`,
  `next_due_smoothed`, `due_date`, `reschedule_marker` — so the
  Schedule section can feed `getIdealAndScheduled` at render.
- **New optional `lastCompletion` prop** threaded from parent.
- **Schedule section (LVIZ-05, D-08, D-09)**: `<section
  data-testid="detail-schedule">` renders iff `shift.displaced`.
  Contains "Ideal: {MMM d, yyyy}" + "Scheduled: {MMM d, yyyy}" +
  "Shifted by {N} days to smooth household load." copy. Section
  omitted entirely when `ideal === scheduled` OR either side is null
  — detail sheet collapses back to Phase 15 byte-identical shape.
- **SheetDescription copy fix**: OOFT tasks (`frequency_days == null
  || <= 0`) now render "One-off" instead of the nonsensical "Every
  null days".

### BandView + PersonTaskList wiring

Both Client Components compute `shiftByTaskId` per render over
`tasks` + reused `latestByTask` via `getIdealAndScheduled`. The Map
is threaded to:

- `<TaskBand label="Overdue">` (both surfaces)
- `<TaskBand label="This Week">` (both surfaces)
- `<HorizonStrip>` (both surfaces)
- `<TaskDetailSheet>` (BandView only — Person view skips detail sheet
  by PERS-01 design)

BandView's `detailTask` prop widening threads the new Task fields
into the sheet's task prop; `lastCompletion` comes from
`detailCompletions[0]` (the `lastCompletionsByTaskId` Map owned by
the parent Server Component).

### Server Component field projections

- `app/(app)/h/[homeId]/page.tsx`: `fields:` projection widened to
  include `next_due_smoothed`, `preferred_days`, `due_date`,
  `reschedule_marker`. `mappedTasks` literal threads all four with
  `|| null` coercion (PB 0.37.1 empty-field read-back defense).
- `app/(app)/h/[homeId]/person/page.tsx`: mirrors the dashboard
  widening on its person-scoped fetch + `myTasks.push` literal.

## Tests (22 new — all pass)

### `tests/unit/horizon-density.test.ts` (8 tests)

| # | Test | Assertion |
|---|------|-----------|
| 1 | cycle task with smoothed ≠ natural | displaced=true, ideal/scheduled differ by diff |
| 2 | cycle task with smoothed === natural | displaced=false |
| 3 | cycle task with smoothed=null | ideal === scheduled, displaced=false |
| 4 | anchored with smoothed injected (LOAD-06) | ideal === scheduled, displaced=false |
| 5 | archived task | both null, displaced=false |
| 6 | same-season dormant seasonal | both null, displaced=false |
| 7 | OOFT task (frequency_days=null) | due_date both sides, displaced=false |
| 8 | computeMonthDensity bucket-count | archived excluded, Map<yyyy-MM, count> correct |

### `tests/unit/components/shift-badge.test.tsx` (3 tests)

Renders ⚖️ emoji, aria-label="Shifted", title attr contains both dates.

### `tests/unit/components/horizon-strip-density.test.tsx` (5 tests)

| # | Test | Assertion |
|---|------|-----------|
| 1 | empty month (count=0) | NO bg-primary/* class (D-03) |
| 2 | low-density month (ratio ≤ 0.33) | bg-primary/10 (D-01) |
| 3 | max-density month (ratio = 1.0) | bg-primary/50 (D-01) |
| 4 | 3-dot render gone | span.size-1.5.rounded-full.bg-primary returns 0 |
| 5 | mid-density (0.33 < ratio ≤ 0.66) | bg-primary/30 (D-01) |

### `tests/unit/components/task-detail-sheet-schedule.test.tsx` (3 tests)

| # | Test | Assertion |
|---|------|-----------|
| 1 | displaced (3 days) | detail-schedule renders with "Apr 24, 2026" + "Apr 27, 2026" + "smooth" + "3 days" |
| 2 | ideal === scheduled | section NOT rendered (D-09) |
| 3 | completed OOFT → null both sides | section NOT rendered |

### `tests/unit/horizon-density-integration.test.ts` (3 scenarios, port 18104)

| # | Scenario | Proves |
|---|----------|--------|
| 1 | Post-LOAD completion → helper displaced verdict matches UI format pair | LVIZ-03, LVIZ-05 three-stage contract (PB row → helper → format) |
| 2a | Anchored task with force-injected smoothed → ideal === scheduled | LVIZ-04, LOAD-06 read-side bypass |
| 2b | Same-season dormant seasonal → both null | Dormant never badges |
| 3 | 10 tasks across 6 months → computeMonthDensity bucket counts + tint-tier derivation | LVIZ-01 density math end-to-end |

## Verification Results

```bash
# Target test files — 22/22 pass
$ npm test -- tests/unit/horizon-density.test.ts \
              tests/unit/components/shift-badge.test.tsx \
              tests/unit/components/horizon-strip-density.test.tsx \
              tests/unit/components/task-detail-sheet-schedule.test.tsx \
              tests/unit/horizon-density-integration.test.ts --run
 Test Files  5 passed (5)
      Tests  22 passed (22)

# Full regression — 560/560
$ npm test --run
 Test Files  67 passed (67)
      Tests  560 passed (560)

# Type-check clean
$ npx tsc --noEmit
 (exit 0)

# Lint — 0 errors, 16 pre-existing warnings (unrelated to Phase 16)
$ npm run lint
 ✖ 16 problems (0 errors, 16 warnings)
```

**Grep invariants (plan <verification> block):**

| Check | Expected | Actual |
|-------|---------:|-------:|
| `grep -c "bg-primary/10\|bg-primary/30\|bg-primary/50" components/horizon-strip.tsx` | `>= 3` | `3` |
| `grep -c "size-1.5 rounded-full bg-primary" components/horizon-strip.tsx` | `= 0` | `0` |
| `grep -c "ShiftBadge" components/task-row.tsx components/horizon-strip.tsx` | `>= 2` | `8` (3+5) |
| `grep -cE "diffDays\s*>=\s*1\|Math.abs.*>=\s*1" lib/horizon-density.ts` | `>= 1` | `1` |
| `grep -c "detail-schedule" components/task-detail-sheet.tsx` | `>= 1` | `1` |
| `grep -c "getIdealAndScheduled" components/task-detail-sheet.tsx` | `>= 1` | `5` |
| `grep -c "next_due_smoothed: null" lib/horizon-density.ts` | `>= 1` | `3` |
| `grep -c "ShiftBadge" components/dormant-task-row.tsx` | `= 0` | `0` |
| `grep -c "const PORT = 18104" tests/unit/horizon-density-integration.test.ts` | `= 1` | `1` |
| `grep -cE "test\('Scenario " tests/unit/horizon-density-integration.test.ts` | `= 3` | `3` |

All 10 invariants met or exceeded.

**TDD gate sequence (Tasks 1, 2, 3):**

```
d2f5ec9 test(16-01): getIdealAndScheduled + computeMonthDensity (RED)
3a8cb9b feat(16-01): pure helpers ... (GREEN)
b15a57e test(16-01): ShiftBadge + density tint (RED)
e76d601 feat(16-01): ShiftBadge + HorizonStrip density (GREEN)
3d50ff1 test(16-01): TaskDetailSheet Schedule (RED)
5ec9bda feat(16-01): ShiftBadge wiring + Schedule section (GREEN)
```

Each `test(16-01):` commit precedes its paired `feat(16-01):` GREEN
commit — TDD gate sequence verifiable via `git log --oneline`.

## Deviations from Plan

### 1. [Rule 1 — Test helper bug] mkTask test helper collapsed OOFT tests to cycle

**Found during:** Task 1 GREEN gate (horizon-density.test.ts run).

**Issue:** The test helper `mkTask({ frequency_days: null, ... })`
used nullish-coalesce for defaults: `frequency_days: partial.frequency_days ?? 14`.
Passing `frequency_days: null` explicitly silently upgraded to 14
(cycle), collapsing the OOFT test case to a cycle task with freq=14
and lastCompletion=`created + 14d = 2026-03-15`. Expected 2026-05-15
(the due_date); got 2026-03-15.

**Fix:** Switched to `'frequency_days' in partial ? partial.frequency_days! : 14`
— preserves explicit `null` pass-through while keeping default for
missing key. Tests green 8/8.

**Files modified:** `tests/unit/horizon-density.test.ts`
**Commit:** `3a8cb9b`

### 2. [Rule 3 — jsdom missing DOM API] window.matchMedia polyfill for TaskDetailSheet test

**Found during:** Task 3 GREEN gate (task-detail-sheet-schedule.test.tsx).

**Issue:** jsdom ships without `window.matchMedia`. TaskDetailSheet's
`useIsDesktop` hook (Phase 3 file-header JSDoc) calls
`window.matchMedia('(min-width: 640px)')` inside a useEffect —
crashes the render with `TypeError: window.matchMedia is not a function`.

**Fix:** Added a minimal `MediaQueryList`-shaped polyfill in
`beforeAll`. Returns `matches: false` (mobile branch) uniformly —
we don't care about the desktop/mobile branch for these tests;
we just need the effect to run without crashing.

**Files modified:** `tests/unit/components/task-detail-sheet-schedule.test.tsx`
**Commit:** `5ec9bda`

### 3. [Rule 3 — Portal location] tests query document.body, not container

**Found during:** Task 3 GREEN gate.

**Issue:** Shadcn Sheet's `SheetContent` renders via a Radix portal
into `document.body` at the end. Testing Library's `container`
scope does NOT include portaled DOM, so
`container.querySelector('[data-testid="detail-schedule"]')` returned
null even when the section was rendering correctly.

**Fix:** Switched to `document.body.querySelector(...)` for all three
tests + added `cleanup()` in `afterEach` to prevent portaled DOM
from leaking across `it` blocks.

**Files modified:** `tests/unit/components/task-detail-sheet-schedule.test.tsx`
**Commit:** `5ec9bda`

### 4. [Rule 1 — Plan deliberately changes behaviour] retired legacy horizon-strip 3-dot tests

**Found during:** Task 2 GREEN gate (existing `tests/unit/horizon-strip.test.tsx`).

**Issue:** Two existing Phase 3 tests asserted the 3-dot render when
count=3 and the `+N` overflow label when count>3. D-01 explicitly
replaces that render with the density tint — both tests became stale
the moment Task 2 landed. Leaving them in place would have blocked
the plan's verification gate.

**Fix:** Consolidated the two stale tests into a single test asserting
the post-Phase-16 contract: `data-month-count` is still load-bearing
(same E2E hook Phase 3 locked), no `+N` label ever surfaces, and the
old 3-dot spans return 0 matches. Explicit test-name reference to
"Phase 16: dots + +N overflow replaced by density tint per D-01" so
the rationale survives future readers.

**Files modified:** `tests/unit/horizon-strip.test.tsx`
**Commit:** `e76d601`

### 5. [Rule 2 — Pre-existing OOFT copy bug surfaced by type widening] SheetDescription "Every null days"

**Found during:** Task 3 GREEN gate.

**Issue:** TaskDetailSheet's SheetDescription line reads "Every
{task.frequency_days} days". Before this plan, the `task` prop
typed `frequency_days` as `number` — so OOFT tasks coming through
the existing render path (rare but possible) would emit the
string "Every null days". Widening the type to `number | null`
(needed for the Schedule section's getIdealAndScheduled call)
makes this bug TypeScript-visible for the first time.

**Fix:** Branch the copy: `frequency_days != null && > 0 ? 'Every N
days' : 'One-off'`. Matches the Phase 15 form's Recurring/One-off
toggle semantics. Minor copy polish, no behavioural regression on
recurring tasks.

**Files modified:** `components/task-detail-sheet.tsx`
**Commit:** `5ec9bda`

## Commits

| Hash | Subject |
|------|---------|
| `d2f5ec9` | `test(16-01): add failing tests for getIdealAndScheduled + computeMonthDensity (RED)` |
| `3a8cb9b` | `feat(16-01): pure helpers getIdealAndScheduled + computeMonthDensity (LVIZ-01 LVIZ-03 LVIZ-04, D-04 D-10)` |
| `b15a57e` | `test(16-01): add failing tests for ShiftBadge + HorizonStrip density tint (RED)` |
| `e76d601` | `feat(16-01): ShiftBadge component + HorizonStrip density tint (LVIZ-01 LVIZ-03 D-01 D-05)` |
| `3d50ff1` | `test(16-01): add failing tests for TaskDetailSheet Schedule section (LVIZ-05, RED)` |
| `5ec9bda` | `feat(16-01): ShiftBadge wiring into TaskRow/TaskBand + TaskDetailSheet Schedule section (LVIZ-02 LVIZ-03 LVIZ-05 D-06 D-08 D-09)` |
| `5272053` | `feat(16-01): wire shift map + widen field projections in BandView + PersonTaskList (LVIZ-02 LVIZ-03 LVIZ-05 D-02 D-06)` |
| `7df1034` | `test(16-01): 3-scenario disposable-PB integration suite on port 18104 (LVIZ-01..05)` |

## Handoff to Phase 17 (REBAL)

Phase 16 closes the READ loop on LOAD. Phase 17 owns the WRITE loop:
a manual Settings-level "Rebalance all" button that recomputes the
entire `next_due_smoothed` snapshot. All Phase 16 UI surfaces are
already wired to the read path — after a rebalance + router.refresh,
the ⚖️ badges flip on/off naturally, the HorizonStrip retints, and
the TaskDetailSheet Schedule section recomputes.

**Wire-ready integration seams for Phase 17:**

```typescript
import { getIdealAndScheduled, computeMonthDensity } from '@/lib/horizon-density';
import { ShiftBadge } from '@/components/shift-badge';
```

**Open areas for future polish:**

- By-area page wiring of ⚖️ badges (still deferred from Phase 15
  Plan 02 Deviation 5 — requires TaskList → Client Component
  promotion).
- Effort-aware density (v1.2+) — the `computeMonthDensity` helper's
  Map<string, number> shape is the natural extension point; swap
  count for Σ effort.
- Per-task drill-down in the HorizonStrip drawer (v1.2+) —
  currently lists tasks alphabetically by next_due; could add a
  "heaviest day" pill when >1 task lands on the same day in a month.
- Motion on the ⚖️ emoji when the badge first appears (v1.2+ UX
  polish) — a subtle fade-in would reinforce "something changed".

**Next free port: 18105** (Phase 17+ integration reserved).

## Threat Flags

None found — all security-relevant surface is accounted for in the
plan's `<threat_model>` (T-16-01..06). The ShiftBadge's `title`
tooltip is built from `formatInTimeZone` output (T-16-01 mitigation
holds), the natural-ideal strip-and-recompute is read-only (T-16-02
mitigation holds), and all new row-level surfaces are pure read
paths that don't gate any server action (T-16-06 mitigation holds).

## Self-Check: PASSED

- [x] `lib/horizon-density.ts` exists — FOUND
- [x] `components/shift-badge.tsx` exists — FOUND
- [x] `tests/unit/horizon-density.test.ts` exists — FOUND
- [x] `tests/unit/components/shift-badge.test.tsx` exists — FOUND
- [x] `tests/unit/components/horizon-strip-density.test.tsx` exists — FOUND
- [x] `tests/unit/components/task-detail-sheet-schedule.test.tsx` exists — FOUND
- [x] `tests/unit/horizon-density-integration.test.ts` exists — FOUND
- [x] `components/horizon-strip.tsx` contains `bg-primary/10` + `/30` + `/50` — FOUND (3)
- [x] `components/horizon-strip.tsx` no longer contains `size-1.5 rounded-full bg-primary` — CONFIRMED (0)
- [x] `components/task-row.tsx` imports + renders ShiftBadge — FOUND (3 occurrences)
- [x] `components/task-detail-sheet.tsx` contains `data-testid="detail-schedule"` — FOUND (1)
- [x] `components/task-detail-sheet.tsx` calls `getIdealAndScheduled` — FOUND (5)
- [x] `lib/horizon-density.ts` contains `next_due_smoothed: null` strip pattern — FOUND (3)
- [x] `components/dormant-task-row.tsx` has NO ShiftBadge — CONFIRMED (0)
- [x] `app/(app)/h/[homeId]/page.tsx` contains `next_due_smoothed` in fields + mapping — FOUND (2)
- [x] `app/(app)/h/[homeId]/person/page.tsx` contains `next_due_smoothed` in fields + mapping — FOUND (2)
- [x] `tests/unit/horizon-density-integration.test.ts` contains exactly `const PORT = 18104` — FOUND (1)
- [x] Integration suite has exactly 3 scenarios — FOUND (3)
- [x] Commit `d2f5ec9` in git log (RED Task 1) — VERIFIED
- [x] Commit `3a8cb9b` in git log (GREEN Task 1) — VERIFIED
- [x] Commit `b15a57e` in git log (RED Task 2) — VERIFIED
- [x] Commit `e76d601` in git log (GREEN Task 2) — VERIFIED
- [x] Commit `3d50ff1` in git log (RED Task 3) — VERIFIED
- [x] Commit `5ec9bda` in git log (GREEN Task 3) — VERIFIED
- [x] Commit `5272053` in git log (Task 4 wiring) — VERIFIED
- [x] Commit `7df1034` in git log (Task 5 integration) — VERIFIED
- [x] `npm test --run` 560/560 — VERIFIED
- [x] `npx tsc --noEmit` clean — VERIFIED
- [x] `npm run lint` 0 errors — VERIFIED
