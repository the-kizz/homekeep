---
phase: 15-one-off-reschedule-ui
verified: 2026-04-22T00:00:00Z
status: gaps_found
score: 4/5 must-haves verified
overrides_applied: 0
gaps:
  - truth: "Tapping a \"Reschedule\" affordance on any task (in BandView, PersonTaskList, TaskDetailSheet, By Area) opens an action sheet with date picker defaulting to natural next-due and a \"Just this time\" / \"From now on\" radio (default: Just this time)"
    status: partial
    reason: "Reschedule entry point is wired from BandView (dashboard), PersonTaskList (long-press), and TaskDetailSheet (footer button) — 3 of the 4 required surfaces. The By Area surface was explicitly deferred in 15-02-P01-SUMMARY.md Deviation 5 with an architectural rationale (TaskList/AreaCard/DormantTaskRow are Server Components; threading Reschedule would require a Client Component promotion or parallel client surface). No later phase (16, 17, 18) addresses this — SC #2 explicitly names \"By Area\" and the ROADMAP contract is not fully met."
    artifacts:
      - path: "app/(app)/h/[homeId]/by-area/page.tsx"
        issue: "No RescheduleActionSheet import or setRescheduleTaskId wiring; AreaCard + DormantTaskRow are read-only with respect to reschedule in v1.1"
      - path: "components/area-card.tsx"
        issue: "Does not expose a reschedule entry point"
    missing:
      - "Promote app/(app)/h/[homeId]/by-area area-detail TaskList to a Client Component (or add a parallel client-side per-task surface) that wires `RescheduleActionSheet` the same way BandView + PersonTaskList do"
      - "Add at least one acceptance assertion (unit or integration) that the By Area surface exposes the Reschedule entry point"
      - "OR — accept as a documented override via overrides: frontmatter if product agrees the 3-surface coverage (which captures ~100% of v1.0 task-completion traffic per 15-02 Deviation 5) is sufficient for v1.1 and By Area Reschedule is re-scoped to v1.2+"
human_verification:
  - test: "Live smoke — snooze reappears in every view AND ntfy fires only for the new date (SC #5)"
    expected: "1) Create a cycle task in a live home. 2) From BandView's TaskDetailSheet > Reschedule, pick \"Just this time\" + +3 days, submit. 3) Confirm the task disappears from today's BandView, reappears in the day-3 BandView / PersonTaskList / By Area task lists. 4) Watch the ntfy channel — only ONE overdue notification fires when day-3 passes (not the original due date). 5) Repeat with \"From now on\" on an anchored task; confirm anchor_date has shifted and the task holds its new cadence on the next cycle."
    why_human: "SNZE-10 / SC #5 require proving both cross-view visibility on a LIVE calendar AND a time-based ntfy firing. Scenario 1 proves the override row persists atomically and computeNextDue (via Phase 10) consumes it, but no unit or integration test observes the task \"reappearing\" across views on a real clock, and no automated test asserts the scheduler fires exactly once at the new date."
  - test: "Form UX — OOFT toggle reveals/hides correctly on all viewport sizes"
    expected: "Open /h/[homeId]/tasks/new. 1) Default: \"Recurring\" radio checked, frequency + schedule_mode + anchor fields visible, no due-by date field. 2) Flip to \"One-off\": frequency + schedule_mode + anchor fields all HIDDEN (not just disabled), due-by date field appears. 3) Fill due_by, submit. 4) Edit the resulting task — form opens with \"One-off\" pre-selected and due_date populated. 5) Flip back to Recurring — due_date clears, frequency input restored to 7 (or prior value). Repeat on mobile viewport — sheet / form layout remains usable."
    why_human: "Unit tests (tests/unit/components/task-form-ooft.test.tsx) assert the 4 toggle behaviors in isolation with mocked RHF state, but visual confirmation on the actual form in both viewports + the round-trip of creating + editing an OOFT task end-to-end needs human eyes."
  - test: "Cross-window ExtendWindowDialog — UX copy + the three branches"
    expected: "1) Create a seasonal task with active_from=4 active_to=9 (Apr–Sep). 2) Reschedule it to Oct 15 via the sheet (picked month = 10 = outside window). 3) ExtendWindowDialog appears with copy \"'<task>' is only active from month 4 to 9. The date you picked (October) is outside that window.\" and three buttons: Cancel / Continue anyway / Extend active window. 4) Click Cancel — dialog closes, no write, sheet remains open with same picked date. 5) Repeat, click Continue anyway — snooze row written to Oct 15, task still appears dormant on Oct 15 (per isInActiveWindow). 6) Repeat, click Extend — active_to widens to 10, snooze row written, task is active on Oct 15."
    why_human: "Scenario 4 of reschedule-integration.test.ts asserts the DATA state (override row + active_to=10) but consciously skips the UI dialog flow. SC #4 (\"surfaces an 'Extend the active window?' confirmation dialog BEFORE any write happens\") cannot be verified programmatically without running the app — the dialog's visual appearance, copy correctness, button ordering, and the Cancel branch's \"no state change\" promise all need live verification."
---

# Phase 15: One-Off & Reschedule UI Verification Report

**Phase Goal:** Users can create one-off tasks and rearrange any task's next occurrence from any view via a mobile-friendly action sheet — snoozing (one-off override) or permanently shifting ("From now on" mutates anchor / `next_due_smoothed` with a marker flag preserved by REBAL) without needing to edit the task, with a confirmation dialog when a snooze escapes the active season.

**Verified:** 2026-04-22
**Status:** gaps_found
**Re-verification:** No — initial verification
**REQ-IDs (6):** OOFT-04, SNZE-01, SNZE-02, SNZE-03, SNZE-07, SNZE-08

## Goal Achievement

### Observable Truths (from ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Task form cleanly distinguishes "Recurring" (frequency required) vs "One-off" (frequency disabled/null); anchored mode is disallowed for one-off tasks | ✓ VERIFIED | `components/forms/task-form.tsx:204-300` has `taskType` state with radio group; selecting `one-off` sets `frequency_days=null` and forces `schedule_mode='cycle'` (line 287-300); conditional reveals hide frequency + anchor when `taskType === 'one-off'` (lines 373, 416, 451). 4 unit tests in `tests/unit/components/task-form-ooft.test.tsx` assert toggle + reveals. Phase 11 zod refine 3 (schemas/task.ts) provides defense-in-depth. `lib/actions/tasks.ts:73-99` reads `rawDueDate` + converts empty `frequency_days` → null so refine 1 surfaces the correct field error |
| 2 | Tapping a "Reschedule" affordance on any task (in BandView, PersonTaskList, TaskDetailSheet, **By Area**) opens an action sheet with date picker defaulting to natural next-due and radio (default: Just this time) | ✗ FAILED | Wired in 3 of 4 required surfaces. `band-view.tsx:168,503,524` wires `<RescheduleActionSheet>` via `setRescheduleTaskId` from TaskDetailSheet's `onReschedule`. `person-task-list.tsx:92,226,299` wires via the long-press/onDetail handler. `task-detail-sheet.tsx:84,170-182` renders `data-testid="detail-reschedule"` footer button. Default date = natural next-due (`naturalTask = {...task, next_due_smoothed:null}` then `computeNextDue`, reschedule-action-sheet.tsx:104-114). Radio default `'just-this-time'` (line 117). **By Area page (`app/(app)/h/[homeId]/by-area/page.tsx`) has no RescheduleActionSheet wiring** — consciously deferred in 15-02-P01-SUMMARY Deviation 5. ROADMAP SC #2 explicitly names "By Area" as a required surface |
| 3 | "Just this time" writes `schedule_overrides` row; "From now on" mutates `tasks.anchor_date` (anchored mode) or `tasks.next_due_smoothed` with a marker flag (cycle mode) directly — no override row written, marker flag detectable by REBAL preservation rules | ✓ VERIFIED | `lib/actions/reschedule.ts:68-136` `snoozeTaskAction` creates a `schedule_overrides` row via `pb.createBatch()` with atomic-replace-active consume of prior (lines 107-119). `rescheduleTaskAction` (156-212) uses a ternary payload: `schedule_mode === 'anchored'` → `{anchor_date, reschedule_marker}`; else `{next_due_smoothed, reschedule_marker}` (lines 192-195). No `schedule_overrides` write in the reschedule branch (D-09). Migration `1745280003_reschedule_marker.js` adds the field. Scenario 2 + 3 of reschedule-integration.test.ts assert marker timestamps land in PB with the correct branch field written and the other untouched. Unit test asserts `.not.toHaveProperty` on the inactive branch (T-15-01-04) |
| 4 | Picking a date outside a seasonal task's active window surfaces an "Extend the active window?" confirmation dialog before any write happens — cancelling closes the sheet with no state change | ✓ VERIFIED | `components/reschedule-action-sheet.tsx:127-141` `isCrossWindow` calls `isInActiveWindow`; `handleSubmitClick` (172-180) intercepts submit and opens `<ExtendWindowDialog>` BEFORE `doSubmit`. Dialog (`components/extend-window-dialog.tsx`) renders three buttons (Cancel / Continue anyway / Extend active window) with explicit user-click gates — no auto-extend path (T-15-02-04). Cancel path sets `setPendingSubmit(null)` without invoking either action. 4 unit tests in `tests/unit/components/extend-window-dialog.test.tsx` assert each callback wiring. UI-level dialog flow is not covered by Scenario 4 (intentional per 15-03 decisions) — see human_verification item 3 |
| 5 | After a snooze lands, the task reappears on the chosen date across every view and the ntfy scheduler fires one overdue notification at that new date (not the original) | ? NEEDS HUMAN | The server mechanics are sound: `snoozeTaskAction` writes a `schedule_overrides` row that Phase 10's `computeNextDue` reads (override branch short-circuits before smoothed/anchored/natural); `lib/scheduler.ts:224,332` batch-fetches `getActiveOverridesForHome` so `ref_cycle` rotates for snoozed tasks (SNZE-10, already shipped in Phase 10). Scenario 1 of the integration suite proves the override row persists through completion consumption. However, no automated test observes the task reappearing across BandView / PersonTaskList / By Area on a real clock, and no test asserts the scheduler fires exactly once at the new date. See human_verification item 1 |

**Score:** 4/5 truths verified (1 FAILED, 3 PASSED as programmatic, 1 NEEDS HUMAN)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `pocketbase/pb_migrations/1745280003_reschedule_marker.js` | Additive DateField `reschedule_marker` (required:false); idempotent UP + DOWN | ✓ VERIFIED | 34 lines; `DateField({name:'reschedule_marker', required:false})` + DOWN guards field removal via `getByName` (Pitfall 10). Timestamp = +1 from Phase 12's 1745280002 |
| `lib/actions/reschedule.ts` | `snoozeTaskAction` + `rescheduleTaskAction` with discriminated-union results | ✓ VERIFIED | 213 lines; `'use server'`; exports both actions + `SnoozeResult` + `RescheduleResult` types; atomic-replace-active via `pb.createBatch` in snooze; ternary payload in reschedule; membership gate; server-timestamped marker |
| `components/reschedule-action-sheet.tsx` | Shadcn Sheet with date picker, radio (default Just this time), cross-window interception | ✓ VERIFIED | 338 lines; imports both actions + `computeNextDue` + `isInActiveWindow`; renders `<ExtendWindowDialog>` conditionally; `data-testid="reschedule-sheet"` + `"reschedule-submit"` + `"reschedule-cancel"`; archived-task fallback renders "Task is not schedulable right now" |
| `components/extend-window-dialog.tsx` | Shadcn Dialog with three callbacks | ✓ VERIFIED | 115 lines; `Dialog`/`DialogFooter` with three `Button`s (`extend-cancel` / `extend-continue` / `extend-confirm`); presentational-only, no server-action imports |
| `components/task-detail-sheet.tsx` | `onReschedule` prop + footer button | ✓ VERIFIED | Optional `onReschedule?` prop (line 84); footer renders `data-testid="detail-reschedule"` button when provided (lines 170-182); closes sheet before firing callback (Pitfall 12) |
| `components/band-view.tsx` | Threads `onReschedule` + renders `<RescheduleActionSheet>` with `onExtendWindow` → `updateTask` | ✓ VERIFIED | `setRescheduleTaskId` state (line 168); `onReschedule={setRescheduleTaskId}` to TaskDetailSheet (line 503); conditional render block (513-548) with minimal FormData widen-window handler |
| `components/person-task-list.tsx` | Long-press → RescheduleActionSheet directly (skips TaskDetailSheet) | ✓ VERIFIED | `setRescheduleTaskId` state (line 92); `onDetail={setRescheduleTaskId}` wired to TaskBand long-press (lines 226, 236); conditional render block (290-323) |
| `components/forms/task-form.tsx` | OOFT toggle + due_date Controller | ✓ VERIFIED | `taskType` state + initial from `isOoftTask` (lines 147-210); Recurring/One-off radios (259-300); due_date Controller shown only when `taskType === 'one-off'` (416-444) |
| `tests/unit/reschedule-integration.test.ts` | Port 18103 + 4 scenarios | ✓ VERIFIED | 365 lines; `const PORT = 18103`; 4 `test('Scenario ...')` blocks; references migration `1745280003_reschedule_marker.js`; 12 references to `reschedule_marker` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| RescheduleActionSheet | snoozeTaskAction | Direct import + await on radio=just-this-time | WIRED | `reschedule-action-sheet.tsx:22` imports; line 150 calls |
| RescheduleActionSheet | rescheduleTaskAction | Direct import + await on radio=from-now-on | WIRED | Line 22 imports; line 154 calls |
| RescheduleActionSheet | ExtendWindowDialog | JSX render inside same fragment | WIRED | Line 29 imports; lines 293-334 render with 3 callbacks wired |
| RescheduleActionSheet | computeNextDue | Import + `naturalTask` clone with smoothed stripped | WIRED | Line 24 imports; lines 104-114 compute default date |
| RescheduleActionSheet | isInActiveWindow | Cross-window guard in handleSubmitClick | WIRED | Line 25 imports; line 136 calls |
| BandView | RescheduleActionSheet | State gate `{rescheduleTaskId && ...}` + render | WIRED | Line 29 imports; lines 513-548 render |
| BandView | updateTask (onExtendWindow) | FormData builder inside onExtendWindow callback | WIRED | Lines 530-544 build FormData + call updateTask |
| PersonTaskList | RescheduleActionSheet | State gate + render | WIRED | Line 27 imports; lines 290-323 render |
| TaskDetailSheet | onReschedule callback | Footer button closes sheet + fires callback | WIRED | Lines 170-182 render button; line 175-176 close + fire |
| rescheduleTaskAction | tasks.reschedule_marker + schedule_mode ternary | pb.update with exactly one date field | WIRED | lines 192-199 build payload via `schedule_mode === 'anchored'` ternary; writes marker + EXACTLY one of `anchor_date` or `next_due_smoothed` |
| snoozeTaskAction | schedule_overrides via pb.createBatch | Atomic-replace with prior consume | WIRED | Lines 107-119; uses `getActiveOverride` preflight |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| RescheduleActionSheet | `defaultDate` | `computeNextDue(naturalTask, lastCompletion, now, undefined, timezone)` | Yes (natural next-due from real task + lastCompletion props passed by caller) | ✓ FLOWING |
| RescheduleActionSheet | snooze result | `await snoozeTaskAction({task_id, snooze_until: iso})` → PB row | Yes (live PB write via createBatch in Scenario 1) | ✓ FLOWING |
| RescheduleActionSheet | reschedule result | `await rescheduleTaskAction({task_id, new_date})` → PB update | Yes (live PB update in Scenarios 2 + 3) | ✓ FLOWING |
| BandView | `rescheduleTaskId` → RescheduleActionSheet | `useState` + `setRescheduleTaskId(id)` from TaskDetailSheet onReschedule | Yes (id flows from clicked task through state) | ✓ FLOWING |
| PersonTaskList | `rescheduleTaskId` → RescheduleActionSheet | useState + long-press onDetail | Yes | ✓ FLOWING |
| ExtendWindowDialog | `onExtend` → `updateTask` FormData | Caller builds FormData with widened active_from/to | Yes (BandView + PersonTaskList both construct full taskSchema payload) | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test regression 539/539 green | `npm test --run` | `Test Files 62 passed (62); Tests 539 passed (539)` | ✓ PASS |
| TypeScript type-check clean | `npx tsc --noEmit` | Exit 0, no output | ✓ PASS |
| Reschedule integration suite passes | `npm test -- tests/unit/reschedule-integration.test.ts --run` | 4/4 (documented in 15-03 SUMMARY) | ✓ PASS |
| Port 18103 unique in test suite | `grep -hE "^const PORT = " tests/unit/*.test.ts \| sort -u` | 4 distinct values (18100, 18101, 18102, 18103) | ✓ PASS |
| Migration file resolves | `ls pocketbase/pb_migrations/1745280003_reschedule_marker.js` | File found (1203 bytes) | ✓ PASS |
| All 3 plan commits on master | `git log --oneline` | `fa11bbf`, `16f3c91`, `0fb6bab`, `a0a0d3d`, `e5ebb0f`, `992963b`, `cbfcf96`, `2b3e490` all present | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|------------|-------------|-------------|--------|----------|
| OOFT-04 | 15-01, 15-02, 15-03 | Form distinguishes Recurring vs One-off; anchored disallowed for one-off | ✓ SATISFIED | task-form.tsx toggle + conditional reveals; refine 3 defense-in-depth; Scenario 1 proves live OOFT creation path |
| SNZE-01 | 15-01, 15-02, 15-03 | Reschedule action sheet accessible from any task in any view | ⚠️ PARTIAL | 3 of 4 required surfaces wired (BandView, PersonTaskList, TaskDetailSheet). By Area surface deferred — see Gap above |
| SNZE-02 | 15-01, 15-02, 15-03 | Date picker defaults to natural next due | ✓ SATISFIED | `naturalTask` clone with `next_due_smoothed:null` + `computeNextDue(task, last, now, undefined, tz)`; 1 unit test asserts default |
| SNZE-03 | 15-01, 15-02, 15-03 | Radio default = "Just this time" | ✓ SATISFIED | `useState('just-this-time')` + unit test 3 in reschedule-action-sheet.test.tsx |
| SNZE-07 | 15-01, 15-03 | "From now on" mutates anchor_date (anchored) / next_due_smoothed (cycle) + marker; no override row | ✓ SATISFIED | Ternary payload in rescheduleTaskAction; Scenarios 2 + 3 assert both modes write correct field + marker; unit tests assert `.not.toHaveProperty` on other branch |
| SNZE-08 | 15-01, 15-02, 15-03 | Cross-season snooze prompts ExtendWindowDialog | ⚠️ PARTIAL | Component + 4 unit tests + data-level Scenario 4 verify mechanics. UI-level dialog flow (visual copy, 3 branches) routed to human_verification — intentional per 15-03 decisions |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | No TODO/FIXME/PLACEHOLDER in Phase 15 files | — | Clean — all files are substantive implementations |
| `app/(app)/h/[homeId]/by-area/page.tsx` | — | Missing Reschedule wiring (negative-space finding) | ⚠️ Warning | SC #2 surface parity — see Gap above. Not an anti-pattern in the traditional sense; this is a scope gap |

### Deferred Items

No later-phase deferrals apply. Phase 16 covers horizon density, Phase 17 covers manual rebalance + reads the `reschedule_marker` flag this phase shipped, Phase 18 covers docs. None of them re-open the By Area surface for Reschedule wiring.

### Human Verification Required

See `human_verification` list in frontmatter. Three items:
1. Live smoke — snooze reappears in every view AND ntfy fires only for the new date (SC #5).
2. Form UX — OOFT toggle reveals/hides correctly on all viewport sizes.
3. Cross-window ExtendWindowDialog — visual copy + three branches live.

### Gaps Summary

**Single gap:** By Area page Reschedule wiring — required by ROADMAP SC #2 (which explicitly names "By Area" as one of four surfaces) but consciously deferred during 15-02 execution with an architectural rationale (TaskList / AreaCard / DormantTaskRow are Server Components; threading Reschedule requires either a Client Component promotion or a parallel client-side surface).

The other three surfaces (BandView, PersonTaskList, TaskDetailSheet) are fully wired and 15-02 Deviation 5 argues they cover ~100% of v1.0 task-completion traffic. That may be true, but it does not match the ROADMAP contract as written. Three paths forward:

1. **Ship the By Area wiring.** Promote `app/(app)/h/[homeId]/by-area/[areaId]/...` TaskList (or add a parallel client-side per-task surface) to render `<RescheduleActionSheet>`. Add at least one assertion that By Area exposes the entry point.
2. **Formally accept the deferral via overrides frontmatter.** Add to VERIFICATION.md frontmatter:
   ```yaml
   overrides:
     - must_have: "Tapping a \"Reschedule\" affordance on any task (in BandView, PersonTaskList, TaskDetailSheet, By Area) opens an action sheet..."
       reason: "By Area wiring requires TaskList → Client Component promotion; BandView + PersonTaskList + TaskDetailSheet cover the primary task-completion paths for v1.1; By Area Reschedule re-scoped to v1.2+ polish"
       accepted_by: "keiron"
       accepted_at: "2026-04-22T00:00:00Z"
   ```
3. **Update the ROADMAP SC to match scope** (add a v1.1 Postscript noting the three-surface coverage). This keeps the contract honest.

Option 2 is the lowest-friction path if product agrees with the 15-02 Deviation 5 rationale. Option 1 is ~30-90 min of client-component promotion work + one new unit test + possibly a fifth integration scenario.

The three human-verification items are independent of this gap — they cover SC #5 (live view reappearance + ntfy firing), form UX on real viewports, and the UI-level ExtendWindowDialog flow that Scenario 4 intentionally skipped.

---

_Verified: 2026-04-22_
_Verifier: Claude (gsd-verifier)_
