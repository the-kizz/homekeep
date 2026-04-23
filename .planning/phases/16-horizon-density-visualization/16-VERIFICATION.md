---
phase: 16-horizon-density-visualization
verified: 2026-04-22T16:05:00Z
status: human_needed
score: 8/8 must-haves verified
overrides_applied: 0
human_verification:
  - test: "VLD-01 — HorizonStrip density tint visually distinct across 3 tiers (LVIZ-01)"
    expected: "Tiers visually separable in both light and dark mode across a real seeded home; no tier collapses into another; current-month border still visible on top of any tint"
    why_human: "Visual distinctiveness of bg-primary/10 vs /30 vs /50 opacity is a perceptual check — automated DOM inspection confirms class strings are applied, but human eyeball is required to certify the three tiers are actually perceptually distinct under real rendering"
  - test: "VLD-02 — ⚖️ emoji renders consistently across platforms (LVIZ-03)"
    expected: "Colour-variant U+2696 FE0F emoji visible on desktop Chrome / desktop Firefox / desktop Safari / iOS Safari / Android Chrome next to the task name; native tooltip surfaces on hover (desktop) or long-press (mobile) with correct 'Shifted from {ideal} to {scheduled}' copy"
    why_human: "Emoji rendering depends on system font fallback chains that vary by OS/browser and cannot be verified in jsdom; Android in particular may ignore the FE0F variation selector on older versions"
  - test: "VLD-03 — TaskDetailSheet Schedule section layout on mobile + desktop (LVIZ-05)"
    expected: "At ≥640px: 2-column grid with labels left-aligned, dates right-adjacent, single-line 'Shifted by N days' copy; at <640px: dates don't wrap for typical 'Apr 24, 2026' strings; un-shifted task: section completely absent with no empty placeholder/header/spacing artifact"
    why_human: "Layout responsiveness at the 640px breakpoint is a visual-regression check that jsdom cannot evaluate; requires real browser rendering to confirm no wrap/overflow artifacts"
  - test: "VLD-04 — Badge absent on anchored and dormant tasks (LVIZ-04 + Phase 14 compat)"
    expected: "Dashboard renders anchored task with NO ⚖️ badge; Sleeping section renders seasonal dormant task with NO ⚖️ badge; even after admin manually force-sets next_due_smoothed on the anchored task via PB admin UI (simulating erroneous write), dashboard STILL shows no badge (read-side schedule_mode guard holds per LOAD-06)"
    why_human: "Integration test Scenario 2 proves the helper returns displaced=false for both cases, but visual confirmation the rendered DOM truly shows zero badges — plus the admin-UI tampering scenario — requires human verification"
  - test: "VLD-05 — HorizonStrip Sheet drawer shows ⚖️ badge inline with task names (LVIZ-02 + LVIZ-03, D-02)"
    expected: "Tapping a HorizonStrip month cell containing a shifted task opens the Sheet drawer; shifted task's <li> includes the ⚖️ emoji next to the task name; displayed date is the scheduled date (not the ideal); no layout break on long task names"
    why_human: "Sheet portal rendering + tap interaction + emoji-inline layout under real browser measurements cannot be verified in jsdom; long-task-name overflow is a visual regression concern"
---

# Phase 16: Horizon Density Visualization — Verification Report

**Phase Goal:** HorizonStrip shows per-month density; shifted tasks wear ⚖️ badge; TaskDetailSheet surfaces ideal vs scheduled dates.
**Verified:** 2026-04-22T16:05:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | HorizonStrip month cells tint background proportional to task count (bg-primary/10 → /30 → /50) | VERIFIED | `components/horizon-strip.tsx:147-155` computes `ratio = count/maxCount` with three-step tint thresholds (≤0.33 / ≤0.66 / >0.66); `bg-primary/10`, `bg-primary/30`, `bg-primary/50` all present (grep count = 3); `tests/unit/components/horizon-strip-density.test.tsx` 5/5 pass; integration Scenario 3 proves tint math with 10 real tasks across 6 months |
| 2 | Task with next_due_smoothed differing from natural ideal by ≥1 day displays ⚖️ badge next to name in BandView and PersonTaskList rows | VERIFIED | `components/task-row.tsx:129-135` conditionally renders `<ShiftBadge>` when `shiftInfo` prop present; `components/task-band.tsx:90-98` and `:185-193` compute `rowShiftInfo` from `shiftByTaskId.get(t.id)?.displaced`; BandView (`band-view.tsx:216-230`) and PersonTaskList (`person-task-list.tsx:117-130`) build `shiftByTaskId` per render via `getIdealAndScheduled`; full regression 560/560 green |
| 3 | Tasks whose scheduled date equals natural ideal show NO badge (LVIZ-04) | VERIFIED | `lib/horizon-density.ts:110` gates `displaced = diffDays >= 1`; unit Test 2 + 3 in `horizon-density.test.ts` lock the non-displaced branch; `task-band.tsx:91-98` only sets `rowShiftInfo` when `shift.displaced === true` so `shiftInfo` prop is undefined → ShiftBadge not rendered (line 129 falsy guard) |
| 4 | Dormant seasonal tasks never show ⚖️ badge (Phase 14 compat) | VERIFIED | `components/dormant-task-row.tsx` has ZERO ShiftBadge references (grep count = 0); `getIdealAndScheduled` returns `{ideal:null, scheduled:null, displaced:false}` when computeNextDue returns null for dormant tasks (lib/horizon-density.ts:100-102); horizon-density.test.ts Test 6 locks this |
| 5 | Anchored-mode tasks never show ⚖️ badge (LOAD-06 bypass) | VERIFIED | `lib/horizon-density.ts` relies on computeNextDue's `schedule_mode` guard — both paths (with and without stripped smoothed) return the same anchor date so `displaced=false` by construction; horizon-density.test.ts Test 4 proves this; integration Scenario 2 force-injects next_due_smoothed on an anchored task and confirms displaced=false |
| 6 | Opening a shifted task's detail sheet reveals Schedule section with ideal + scheduled dates + 'Shifted by N days' copy | VERIFIED | `components/task-detail-sheet.tsx:197-227` renders `<section data-testid="detail-schedule">` iff `shift.displaced && shift.ideal && shift.scheduled`; contains Ideal/Scheduled dates via `formatInTimeZone` + `differenceInCalendarDays` copy; `getIdealAndScheduled` called at line 147-154; `tests/unit/components/task-detail-sheet-schedule.test.tsx` 3/3 pass (shifted shows, equal hides, null hides) |
| 7 | When ideal === scheduled, Schedule section omitted entirely (D-09) | VERIFIED | Line 197 gate `{shift.displaced && ...}` — section absent not collapsed; test Test 2 + 3 in `task-detail-sheet-schedule.test.tsx` confirm `querySelector('[data-testid="detail-schedule"]')` returns null in both non-displaced cases |
| 8 | 3-scenario integration suite on port 18104 proves round-trip on live PocketBase (LVIZ-01..05) | VERIFIED | `tests/unit/horizon-density-integration.test.ts` (555 lines) contains exactly 3 scenarios via `grep "test\('Scenario "` = 3; `PORT = 18104` unique across all integration files; three-stage lock (PB row → helper → format) implemented in Scenario 1; Scenarios 2 + 3 exercise anchored-bypass + density math; all 3 pass in targeted run |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `lib/horizon-density.ts` | getIdealAndScheduled + computeMonthDensity + ShiftInfo (≥80 lines) | VERIFIED | 150 lines; exports all 3 symbols (grep confirms); `next_due_smoothed: null` strip pattern present (3 occurrences); `diffDays >= 1` displacement threshold at line 110 |
| `components/shift-badge.tsx` | ShiftBadge Client Component ⚖️ emoji + title tooltip (≥40 lines) | VERIFIED | 56 lines; exports ShiftBadge; `data-shift-badge`, `aria-label="Shifted"`, native `title` attr built from `formatInTimeZone` output |
| `components/horizon-strip.tsx` | Density tint via bg-primary/{10,30,50} replacing 3-dot render | VERIFIED | Contains all 3 tint classes (grep count = 3); legacy `size-1.5 rounded-full bg-primary` 3-dot render REMOVED (grep count = 0); Sheet drawer + data-month-key + data-month-count preserved |
| `components/task-detail-sheet.tsx` | Schedule section with data-testid="detail-schedule" | VERIFIED | Contains `data-testid="detail-schedule"` (1 occurrence); `getIdealAndScheduled` imported + called; conditional render gates section on `shift.displaced` |
| `tests/unit/horizon-density-integration.test.ts` | 3-scenario port-18104 suite (≥250 lines) | VERIFIED | 555 lines (>2× min); exactly 3 `test('Scenario ` invocations; `const PORT = 18104` appears exactly once and is unique across the entire tests/unit directory |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `components/task-row.tsx` | `components/shift-badge.tsx` | Conditional `<ShiftBadge>` render based on shiftInfo prop | WIRED | Line 7 imports ShiftBadge; line 129-135 renders conditionally on shiftInfo presence |
| `components/task-detail-sheet.tsx` | `lib/horizon-density.ts` | `getIdealAndScheduled(task, lastCompletion, now, tz)` at render | WIRED | Line 18 import; line 147-154 call with `taskForShift` + `lastCompletion`; result gates Schedule section |
| `components/horizon-strip.tsx` | `lib/horizon-density.ts` | `computeMonthDensity`-equivalent via local buckets (D-01 optimization) | WIRED | Plan explicitly allows reusing local `buckets` Map instead of importing computeMonthDensity (both paths identical; integration Scenario 3 verifies computeMonthDensity standalone); HorizonStrip still imports ShiftBadge (line 19) for drawer badges |
| `app/(app)/h/[homeId]/page.tsx` | `components/band-view.tsx` | Widened `fields:` projection includes next_due_smoothed | WIRED | `fields` string at line 111 explicitly lists next_due_smoothed + preferred_days + due_date + reschedule_marker; mappedTasks literal threads all 4 with `|| null` coercion (lines 171-175) |
| `app/(app)/h/[homeId]/person/page.tsx` | `components/person-task-list.tsx` | Widened projection includes next_due_smoothed | WIRED | `fields` string at line 124 lists all 4; myTasks.push literal threads all 4 with `|| null` coercion (lines 166-170) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| HorizonStrip (tint) | `buckets` Map keyed by month | Built from `tasks: ClassifiedTask[]` prop passed from BandView/PersonTaskList → which comes from Server Component `mappedTasks` → PB `tasks.getFullList` | YES — real tasks with real next_due_smoothed values flow through | FLOWING |
| ShiftBadge (badges) | `shiftByTaskId` Map | Parent (BandView/PersonTaskList) computes via `getIdealAndScheduled(t, last, nowDate, timezone)` per render over real tasks + real latestByTask | YES — computeNextDue runs twice against real PB task rows; displaced branches on real ms diff | FLOWING |
| TaskDetailSheet (Schedule) | `shift.ideal` / `shift.scheduled` | `getIdealAndScheduled(taskForShift, lastCompletion, new Date(), timezone)` at render; `lastCompletion` threaded from `detailCompletions[0]` owned by parent Server Component | YES — full Task prop shape widened to include all fields getIdealAndScheduled needs; lastCompletion flows from PB completions | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full regression green | `npm test --run` | 67 files, 560 tests passed | PASS |
| Targeted phase suite green | `npm test -- {5 phase files} --run` | 5 files, 22 tests passed | PASS |
| TypeScript clean | `npx tsc --noEmit` | Exit 0 (no output) | PASS |
| Port 18104 uniqueness | `grep -rE "const PORT = 181[0-9][0-9]" tests/` | 18100, 18101, 18102, 18103, 18104 — each unique | PASS |
| Integration scenario count | `grep "test\('Scenario " horizon-density-integration.test.ts` | 3 matches | PASS |
| Dormant compat (no badge) | `grep "ShiftBadge" components/dormant-task-row.tsx` | 0 matches | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| LVIZ-01 | 16-01-P01 | HorizonStrip month cells show density indicator proportional to task count | SATISFIED | `components/horizon-strip.tsx:147-155` three-tier tint; `horizon-strip-density.test.tsx` 5/5; integration Scenario 3 |
| LVIZ-02 | 16-01-P01 | Tapping heavy month opens existing Sheet with density-aware rendering | SATISFIED | Sheet open state preserved at `horizon-strip.tsx:185-227`; drawer renders ShiftBadge inline for displaced tasks (lines 203-217); backward-compat with existing `horizon-strip.tsx` tests |
| LVIZ-03 | 16-01-P01 | Task rows shifted by smoother show ⚖️ badge with tooltip | SATISFIED | `shift-badge.tsx` emoji + `title` tooltip; wired in TaskRow + TaskBand + HorizonStrip drawer; `shift-badge.test.tsx` 3/3; integration Scenario 1 live-PB |
| LVIZ-04 | 16-01-P01 | Badge appears only when displacement > 0 days | SATISFIED | `lib/horizon-density.ts:110` gates `displaced = diffDays >= 1`; unit Tests 2, 3; integration Scenario 2 anchored-bypass + dormant-null |
| LVIZ-05 | 16-01-P01 | TaskDetailSheet Schedule section shows ideal vs scheduled when smoothed | SATISFIED | `task-detail-sheet.tsx:197-227` conditional section with Ideal/Scheduled + "Shifted by N days"; `task-detail-sheet-schedule.test.tsx` 3/3 |

All 5 Phase 16 REQs SATISFIED. No orphaned requirements (REQUIREMENTS.md maps only LVIZ-01..05 to Phase 16 and all are claimed by 16-01-P01-PLAN.md).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No TODO/FIXME/placeholder comments in Phase 16 files | — | No concerns |
| — | — | No hardcoded empty arrays/objects that flow to rendering | — | Empty-state branches (`buckets.get(m.key) ?? []`) all fall back to null-render paths, not displayed-empty |
| — | — | No console-log-only handlers | — | All handlers wire to real server actions or state updates |

Zero anti-patterns detected. All "empty" defaults are correctly scoped (e.g. `maxCount < 1 ? 1 : maxCount` prevents divide-by-zero; optional `shiftByTaskId?` default behaviour preserves backward-compat).

### Roadmap Success Criteria Coverage

| SC | Text | Status | Evidence |
|----|------|--------|----------|
| SC1 | HorizonStrip density indicator scales monotonically; tap opens Sheet | SATISFIED | 3-tier tint with ratio-based thresholds; Sheet drawer preserved; integration Scenario 3 |
| SC2 | Shifted task shows ⚖️ badge in every view (BandView, By Area, Person, HorizonStrip sheet) | SATISFIED (with documented ADR) | BandView ✓ PersonTaskList ✓ HorizonStrip drawer ✓; By Area page renders AreaCard rollup (no per-task rows) — trivially no badge surface there, documented in PLAN D-06 |
| SC3 | Tasks whose scheduled === natural ideal show no badge | SATISFIED | Truth #3 verification above |
| SC4 | Tapping task with ⚖️ badge opens TaskDetailSheet with Schedule section | SATISFIED | onDetail handler on TaskRow (long-press/right-click) wired through BandView to TaskDetailSheet; Schedule section gated on shift.displaced |

### Human Verification Required

5 items need human testing on real browsers/devices. See 16-VALIDATION.md for the full manual verification matrix (VLD-01..05) with cross-platform smoke grid (Desktop Chrome/Firefox/Safari + iOS Safari + Android Chrome).

1. **VLD-01 Density tier visual separability** — Perceptual check that bg-primary/10 / /30 / /50 are actually distinct opacity tiers under real rendering (light + dark mode).
2. **VLD-02 Emoji cross-platform rendering** — U+2696 FE0F with emoji-presentation selector across 5 browsers.
3. **VLD-03 Schedule section responsive layout** — Grid alignment at ≥640px vs <640px breakpoints, no wrap artifacts.
4. **VLD-04 Badge absent on anchored + dormant** — Visual DOM confirmation + admin-UI tampering scenario.
5. **VLD-05 Sheet drawer badge inline** — Tap → Sheet → ⚖️ emoji beside task name, no layout break on long names.

### Gaps Summary

No automated gaps. All 8 must-have truths VERIFIED. All 5 LVIZ REQs SATISFIED. All 4 roadmap Success Criteria SATISFIED. Full regression 560/560 green, TypeScript clean, 0 new lint warnings. Phase 16 passes the goal-backward verification for code-level artifacts, wiring, and data flow.

Status is **human_needed** (not **passed**) because 16-VALIDATION.md defines five manual visual-verification checks (VLD-01..05) that automation cannot cover — emoji rendering, tint tier perceptual separability, responsive breakpoint layout, and visual DOM confirmation of the "no badge on anchored/dormant" invariant. Per GSD verification decision tree, the presence of any human-verification item — even with a perfect automated score — requires human_needed status.

Once the manual validation matrix in 16-VALIDATION.md is signed off by a human validator (desktop Chrome + one mobile browser minimum per column), Phase 16 can be marked complete.

---

*Verified: 2026-04-22T16:05:00Z*
*Verifier: Claude (gsd-verifier)*
