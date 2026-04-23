# Phase 15 Validation — One-Off & Reschedule UI

**Generated:** 2026-04-22
**Phase:** 15 — One-Off & Reschedule UI
**Mode:** standard
**Plans:** 3 (Wave 1 Data → Wave 2 UI → Wave 3 Integration)

---

## 1. Wave Structure

| Wave | Plan | Objective | Files Modified | Autonomous |
|------|------|-----------|----------------|------------|
| 1 | 15-01 | Data layer: migration 1745280003, zod + type passthrough, snooze + reschedule server actions, ~8 unit tests | 5 | yes |
| 2 | 15-02 | UI: OOFT form toggle + RescheduleActionSheet + ExtendWindowDialog + 4 entry-point wirings, ~13 unit tests | 13 | yes |
| 3 | 15-03 | Integration: 4-scenario disposable-PB suite on port 18103 | 1 | yes |

**Dependency graph:** 15-02 depends on 15-01 (imports the new server actions). 15-03 depends on both (exercises full stack).

**No checkpoints:** Phase 15 has no `checkpoint:human-verify` or `checkpoint:decision` tasks — all work is autonomous. Visual verification is covered by the component unit tests (mocked DOM) + the 4 integration scenarios.

---

## 2. REQ-ID Coverage Audit

All 6 REQ-IDs are covered in at least one plan, with multi-wave reinforcement for the core behaviors:

| REQ-ID | Wave 1 (Data) | Wave 2 (UI) | Wave 3 (Integration) | Closed? |
|--------|---------------|-------------|----------------------|---------|
| OOFT-04 | zod refine 1 (required-when-OOFT) + refine 3 (anchored incompatible) confirmed live | Form Recurring/One-off toggle + 4 unit tests | Scenario 1 creates OOFT on live PB + completes + archives | ✅ |
| SNZE-01 | snoozeTaskAction + rescheduleTaskAction exported with stable signatures | RescheduleActionSheet + entry wiring (BandView / PersonTaskList / TaskDetailSheet / By Area) | Scenarios 1 + 2 + 3 + 4 all invoke one of the actions | ✅ |
| SNZE-02 | — (data layer N/A) | Default date = computeNextDue (natural, no override/smoothed) per D-06; 1 unit test | Default date tested in Scenario 1 via natural next-due + 5 unit tests in Wave 2 | ✅ |
| SNZE-03 | — (data layer N/A) | Radio default "Just this time" per D-04; unit test asserts | Scenarios 1 + 4 (snooze path) + Scenarios 2 + 3 (reschedule path) exercise both radio arms | ✅ |
| SNZE-07 | reschedule_marker field + rescheduleTaskAction sets it + ~4 unit tests | — (UI writes via Wave 1 action) | Scenarios 2 + 3 assert marker lands in PB + correct field per mode | ✅ |
| SNZE-08 | — (data layer N/A) | ExtendWindowDialog + 4 unit tests (cancel / extend / continue-anyway) | Scenario 4 widens active_to via updateTask then snooze lands | ✅ |

**Coverage invariant:** Every REQ-ID appears in the `requirements:` frontmatter of at least one plan. Cross-referenced:

```
15-01 frontmatter: [OOFT-04, SNZE-01, SNZE-02, SNZE-03, SNZE-07, SNZE-08]  (data touches all)
15-02 frontmatter: [OOFT-04, SNZE-01, SNZE-02, SNZE-03, SNZE-08]            (UI minus SNZE-07 marker)
15-03 frontmatter: [OOFT-04, SNZE-01, SNZE-02, SNZE-03, SNZE-07, SNZE-08]  (integration proves all)
```

---

## 3. Source-Artifact Coverage Audit

**GOAL (ROADMAP.md Phase 15 §Success Criteria):**

| Success Criterion | Plan | Evidence |
|-------------------|------|----------|
| "Task form cleanly distinguishes Recurring vs One-off..." | 15-02 | OOFT toggle Task A + 4 unit tests |
| "Tapping a Reschedule affordance on any task... opens an action sheet with date picker defaulting to natural next-due and radio (default: Just this time)" | 15-02 | RescheduleActionSheet component + 5 unit tests |
| "Just this time writes schedule_overrides; From now on mutates anchor_date OR next_due_smoothed with a marker flag, no override row written" | 15-01 + 15-03 | snoozeTaskAction vs rescheduleTaskAction split + unit tests + Scenarios 1/2/3 |
| "Picking a date outside seasonal window surfaces confirmation dialog before any write" | 15-02 + 15-03 | ExtendWindowDialog intercepts pre-submit + Scenario 4 widen flow |
| "After snooze lands, task reappears on chosen date across every view and ntfy fires one overdue notification at that new date" | 15-01 + 15-03 | snoozeTaskAction writes schedule_overrides row; Phase 10 computeNextDue override branch (already shipped) makes it visible; ntfy path already shipped per SNZE-10 (Phase 10). Scenario 1+4 verify the override row persists. |

**REQ (from REQUIREMENTS.md):** 6 REQ-IDs — OOFT-04, SNZE-01, SNZE-02, SNZE-03, SNZE-07, SNZE-08 — all mapped above.

**RESEARCH / CONTEXT (from 15-CONTEXT.md):** 18 locked decisions (D-01 through D-18):

| Decision | Plan Location |
|----------|---------------|
| D-01 Recurring/One-off top toggle | 15-02 Task 1 Part A |
| D-02 Anchored disabled for one-off | 15-02 Task 1 Part A (+ existing Phase 11 refine 3 defense-in-depth) |
| D-03 Form submit payload (freq=null + due_date or freq=number) | 15-02 Task 1 Part A (form state + existing createTaskAction path) |
| D-04 RescheduleActionSheet shape | 15-02 Task 1 Part C |
| D-05 Entry points | 15-02 Task 2 (TaskDetailSheet button + BandView/PersonTaskList/TaskList wiring) |
| D-06 Default date = natural next due | 15-02 Task 1 Part C (naturalTask clone with smoothed stripped) |
| D-07 reschedule_marker field shape | 15-01 Task 1 (migration + type + schema) |
| D-08 Marker lifecycle | 15-01 Task 2 (set on from-now-on; natural completion does NOT clear; REBAL clears in Phase 17) |
| D-09 No override row for from-now-on | 15-01 Task 2 rescheduleTaskAction body |
| D-10 ExtendWindowDialog trigger condition | 15-02 Task 1 Part C (`isCrossWindow` pre-submit check) |
| D-11 Dialog options (Cancel / Extend / Continue anyway) | 15-02 Task 1 Part D (ExtendWindowDialog) |
| D-12 Extend mechanics | 15-02 Task 1 Part C onExtend handler + Task 2 Part B BandView caller |
| D-13 snoozeTaskAction signature | 15-01 Task 2 |
| D-14 rescheduleTaskAction signature | 15-01 Task 2 |
| D-15 ActionResult discriminated union idempotency | 15-01 Task 2 (SnoozeResult + RescheduleResult types) |
| D-16 Migration timestamp 1745280003 | 15-01 Task 1 |
| D-17 ~15 unit + 4 integration tests on port 18103 | Waves 1 (+8) + 2 (+13) + 3 (+4) = 25 exact |
| D-18 Port 18103 | 15-03 Task 1 |

All 18 decisions are honored with explicit traceability comments in the plan task actions.

**Scope reduction audit:** Zero deferrals of locked decisions; no "v1 / v2 simplified" language detected in any of the 3 plan actions. The ONLY deferred-to-future-phase items are:
- Marker clearing on natural completion (correctly deferred to Phase 17 REBAL per D-08 — this is CONTEXT text, not plan-level scope reduction)
- Dormant-task Reschedule UX polish ("task will sleep through" messaging) — correctly listed in CONTEXT.md §deferred

---

## 4. Test Delta Projection

| Plan | Type | Expected Tests Added | Running Cumulative |
|------|------|----------------------|--------------------|
| 15-01 | Unit (actions) | +8 | 514 baseline + 8 = 522 |
| 15-02 | Unit (components × 3 files) | +13 | 522 + 13 = 535 |
| 15-03 | Integration | +4 | 535 + 4 = 539 |
| **Phase 15 total** | — | **+25** | **539** |

Baseline of 514 matches Phase 14 close per STATE.md / 14-02 SUMMARY.

**Rider-1 tolerance drift:** All reschedule test assertions use relative-time (`Date.now() + N*86400000`) per Phase 13 pattern. Exception: Scenario 4 uses hardcoded `'2026-10-15'` to exercise the cross-window behavior; expires if CI wall-clock advances past that date (documented inline per T-15-03-04 mitigation).

---

## 5. Port Allocation Register

**Before Phase 15:** 18090..18102 (13 claimed; 18103+ reserved)
**After Phase 15:** 18090..18103 (14 claimed; 18104+ reserved)

Only Wave 3 claims a new port. Waves 1 + 2 are unit-test-only (mocked PB).

Cross-test grep post-landing:
```bash
grep -hE "^const PORT = " tests/unit/*.test.ts | sort -u
# Expected output: 13 distinct values (18100..18103) — no duplicates
```

---

## 6. Files Modified Overview

| File | Plan | Change type |
|------|------|-------------|
| pocketbase/pb_migrations/1745280003_reschedule_marker.js | 15-01 | CREATE (new migration) |
| lib/schemas/task.ts | 15-01 (add reschedule_marker) + 15-02 (tighten due_date regex) | MODIFY |
| lib/task-scheduling.ts | 15-01 | MODIFY (Task type + optional field) |
| lib/actions/reschedule.ts | 15-01 | CREATE (new file; exports 2 actions) |
| lib/actions/tasks.ts | 15-02 | MODIFY (confirm / add due_date raw-parse reads) |
| tests/unit/actions/reschedule-actions.test.ts | 15-01 | CREATE |
| components/reschedule-action-sheet.tsx | 15-02 | CREATE |
| components/extend-window-dialog.tsx | 15-02 | CREATE |
| components/forms/task-form.tsx | 15-02 | MODIFY (OOFT toggle block) |
| components/task-row.tsx | 15-02 | MODIFY (JSDoc only; no behavior change) |
| components/task-detail-sheet.tsx | 15-02 | MODIFY (Reschedule footer button + onReschedule prop) |
| components/band-view.tsx | 15-02 | MODIFY (state + render RescheduleActionSheet) |
| components/person-task-list.tsx | 15-02 | MODIFY (state + render) |
| app/(app)/h/[homeId]/by-area/page.tsx | 15-02 | MODIFY (Client Component wiring — via TaskList) |
| tests/unit/components/task-form-ooft.test.tsx | 15-02 | CREATE |
| tests/unit/components/reschedule-action-sheet.test.tsx | 15-02 | CREATE |
| tests/unit/components/extend-window-dialog.test.tsx | 15-02 | CREATE |
| tests/unit/reschedule-integration.test.ts | 15-03 | CREATE |

**File-ownership check:** No file appears in more than one plan's `files_modified` with conflicting intent:
- `lib/schemas/task.ts` touched by 15-01 (add field) and 15-02 (regex tighten) — same wave-sequential pattern as Phase 13 (`lib/schemas/task.ts` touched by both 13-01 and 13-02). 15-02 depends on 15-01 via `depends_on: ["15-01"]`, so these are sequential, not parallel.
- All other files belong to exactly one plan.

---

## 7. Threat-Model Summary

| Phase | Threat Count | Mitigate | Accept | Transfer |
|-------|--------------|----------|--------|----------|
| 15-01 Data | 8 | 7 | 1 | 0 |
| 15-02 UI | 8 | 7 | 1 | 0 |
| 15-03 Integration | 5 | 5 | 0 | 0 |

Highest-value threats:
- **T-15-01-03 (reschedule_marker tampering):** server-timestamped; never client-controlled. Mitigation inline.
- **T-15-01-04 (rescheduleTaskAction payload conflation):** cycle vs anchored branches write EXACTLY one of the date fields; unit test asserts `.not.toHaveProperty` on the other. Prevents double-write silently crossing modes.
- **T-15-02-02 (due_date regex crafted-form):** Phase 13 WR-01 precedent tightens the regex. Rejects `<script>` style payloads at zod before PB.
- **T-15-02-04 (silent extend-window):** ExtendWindowDialog requires explicit click — no auto-extend path. "Continue anyway" keeps window unchanged; ONLY "Extend" widens.

---

## 8. Known Deviations from Context

None. All 18 CONTEXT.md decisions (D-01 through D-18) are honored exactly. Claude's Discretion items resolved as:

| Discretion Item | Resolution |
|-----------------|------------|
| Date picker choice (react-day-picker vs native) | Native `<Input type="date">` for v1.1 — matches existing task-form.tsx anchor_date / last_done / due_date inputs. react-day-picker deferred to later polish. |
| Sheet vs Drawer on desktop | Sheet side="bottom" on mobile, slides up; same pattern as TaskDetailSheet (D-04 recommended). |
| Entry point: "..." menu vs long-press | Long-press / right-click → TaskDetailSheet → Reschedule footer button. Recommended by D-05 for discoverability and matches existing VIEW-06 "long-press opens detail" convention from Phase 3. |

---

## 9. Next Steps

1. `/clear` to start a fresh context window.
2. Execute sequentially (plans have explicit dependencies):
   - `/gsd-execute-plan 15 15-01` (Wave 1 data)
   - `/gsd-execute-plan 15 15-02` (Wave 2 UI)
   - `/gsd-execute-plan 15 15-03` (Wave 3 integration)
3. After Wave 3 passes: `/gsd-verify-work 15` to close Phase 15.
4. Phase 16 (Horizon Density Visualization) unblocked after Phase 15 ships.

**Blockers:** None. Phase 15 is self-contained; all upstream dependencies (Phases 10, 11, 12, 13, 14) are shipped.

---

*Phase: 15-one-off-reschedule-ui*
*Validation generated: 2026-04-22*
