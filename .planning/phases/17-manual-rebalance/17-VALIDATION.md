# Phase 17 Manual Rebalance — Validation

**Phase:** 17-manual-rebalance
**Planned:** 2026-04-22
**Plans:** 2 (17-01 server + 17-02 UI/integration)
**REQ-IDs:** REBAL-01, REBAL-02, REBAL-03, REBAL-04, REBAL-05, REBAL-06, REBAL-07 (7 total; all 7 REBAL REQs)
**Ports claimed:** 18105 (integration suite)

## Source Audit — All Four Artifact Types

### GOAL (ROADMAP Phase 17 entry)

| Success Criterion | Covered By |
|---|---|
| 1. Settings → Scheduling surfaces a "Rebalance schedule" button that opens a preview modal before any write | 17-02 Task 1 (RebalanceCard + RebalanceDialog + Settings Card link) |
| 2. Preview modal shows counts only with breakdown by preservation reason | 17-02 Task 1 (Dialog render logic) + 17-01 Task 2 (Test P1 shape) + 17-02 Scenario 1 |
| 3. Anchored + override + marker tasks never re-placed | 17-01 Task 1 (classifier priority D-01) + Test A4 + 17-02 Scenario 2 |
| 4. Apply re-runs placeNextDue against fresh computeHouseholdLoad, ascending ideal-date order, updating in-memory load map between placements | 17-01 Task 2 (apply action steps 8-11) + Test A1 + Test A2 + 17-02 Scenario 2 Set.size ≥ 2 |
| 5. Second rebalance immediately after is a no-op on values (D-12) | 17-01 Task 2 Test A7 (idempotency) + 17-02 Scenario 3 |

### REQ (REQUIREMENTS.md phase_req_ids)

| REQ-ID | Covered By | Plan |
|---|---|---|
| REBAL-01 | classifier priority test (anchored first) + live-PB preservation check | 17-01 T1 Test 1, 17-01 T2 Test A4, 17-02 Scenario 2 |
| REBAL-02 | classifier priority test (active_snooze second) + live-PB preservation check | 17-01 T1 Test 2, 17-01 T2 Test A4, 17-02 Scenario 2 |
| REBAL-03 | classifier priority test (from_now_on third) + marker-clear on apply + live-PB marker/value preservation | 17-01 T1 Test 3, 17-01 T2 Test A5, 17-02 Scenario 2 |
| REBAL-04 | rebalanceable bucket re-placed via placeNextDue with fresh computeHouseholdLoad | 17-01 T2 Test A3, 17-01 T2 Test A4, 17-02 Scenario 2 |
| REBAL-05 | Settings → Scheduling "Rebalance schedule" button | 17-02 T1 (page + card + button) |
| REBAL-06 | Preview modal counts + breakdown (D-09 template) | 17-02 T1 Test 4, 17-02 Scenario 1 |
| REBAL-07 | Ascending ideal-date order + in-memory load-map threading between placements | 17-01 T2 Test A1 (order), Test A2 (real placeNextDue distinct dates), 17-02 Scenario 2 (Set.size ≥ 2) |

### RESEARCH (17-CONTEXT.md — no separate RESEARCH.md for this phase)

| RESEARCH Item | Plan Coverage |
|---|---|
| N/A — Phase 17 used the autonomous smart-discuss path (REBAL-01..07 fully specified in REQUIREMENTS.md + 3 rider decisions); no standalone RESEARCH.md was produced. Canonical refs in 17-CONTEXT.md point to 12-04 SUMMARY, 13-01 SUMMARY, and 15-01 SUMMARY for patterns. | All three referenced summaries' patterns threaded into 17-01 and 17-02 (load-map threading from 13-01; atomic batch + D-02 pattern from 10-03; action shape + discriminated union from 15-01). |

### CONTEXT (17-CONTEXT.md locked decisions D-01 through D-14)

| ID | Decision | Plan Coverage |
|---|---|---|
| D-01 | Priority order: anchored > active-override > from-now-on > rebalanceable | 17-01 T1 classifier (priority chain in if/else order) + 12 classifier tests |
| D-02 | Exclusions: archived, OOFT, dormant-seasonal | 17-01 T1 classifier early-continue on archived/OOFT/dormancy + Tests 5, 6, 7 |
| D-03 | Ascending natural-ideal sort for apply | 17-01 T2 apply step 9 (`ranked.sort`) + Test A1 |
| D-04 | Fresh load map computed ONCE at apply start, mutated per placement | 17-01 T2 apply step 8 (`computeHouseholdLoad` call) + step 10 (mutate-in-place loop) |
| D-05 | Single atomic `pb.createBatch()` for all writes | 17-01 T2 apply step 11 + grep invariant (`pb.createBatch` count = 1) + Test A6 |
| D-06 | Clear reschedule_marker on apply for from-now-on bucket (REVISION) | 17-01 T2 apply step 11 marker-clear loop + Test A5 + 17-02 Scenario 2 `!reschedule_marker` assertion |
| D-07 | Settings → Scheduling sub-page (`/h/[homeId]/settings/scheduling`) | 17-02 T1 (new Server Component at that path + Settings page Card link) |
| D-08 | Preview Dialog: fetch on open, Cancel/Apply buttons, success toast, router.refresh | 17-02 T1 RebalanceDialog `handleOpenChange` + `handleApply` + Tests 2, 3, 7 |
| D-09 | Counts text template: "Will update: N. Will preserve: M (A anchored, B active snoozes, C from-now-on)." | 17-02 T1 Dialog render + Test 4 |
| D-10 | `rebalancePreviewAction(homeId): Promise<{ok:true, preview:RebalancePreview} | {ok:false, formError}>` | 17-01 T2 action signature + 5 preview tests |
| D-11 | `rebalanceApplyAction(homeId): Promise<RebalanceResult>` membership-gated | 17-01 T2 action signature + Test A8 (membership gate) |
| D-12 | Second run idempotent on values (no-op semantics) | 17-01 T2 Test A7 + 17-02 Scenario 3 |
| D-13 | ~12 unit + 3 integration | 17-01 delivers 25 unit (12 classifier + 13 action); 17-02 delivers 8 RTL + 3 integration. Totals: 33 unit + 3 integration. |
| D-14 | Port 18105 claimed | 17-02 T2 integration suite `PORT = 18105` |

**Claude's Discretion items** (from 17-CONTEXT.md): UI layout (sub-page vs section → D-07 sub-page chosen); preview copy wording (D-09 template locked); marker-clearing semantics (D-06 revision locked CLEAR).

## Test Delta Projection

| Plan | New Tests | Cumulative |
|---|---|---|
| 17-01 Task 1 (classifier) | +12 | +12 |
| 17-01 Task 2 (actions) | +13 (5 preview + 8 apply) | +25 |
| 17-02 Task 1 (Dialog RTL) | +8 | +33 |
| 17-02 Task 2 (integration, port 18105) | +3 scenarios | +36 |

Baseline expected: ~582 tests (Phase 16 close = 582 per STATE.md trajectory). Phase 17 close projection: **~618 tests**.

## Port Allocation Register Update

| Plan | Port | Status |
|------|------|--------|
| 02-01 | 18090 | CLAIMED |
| 03-01 | 18091 | CLAIMED |
| 04-01 hook | 18092 | CLAIMED |
| 04-01 rules | 18093 | CLAIMED |
| 04-02 | 18094 | CLAIMED |
| 05-01 | 18095 | CLAIMED |
| 06-01 | 18096 | CLAIMED |
| 06-02 | 18097 | CLAIMED |
| 10-01 | 18098 | CLAIMED |
| 11-03 | 18099 | CLAIMED |
| 12-04 | 18100 | CLAIMED |
| 13-02 | 18101 | CLAIMED |
| 14-02 | 18102 | CLAIMED |
| 15-03 | 18103 | CLAIMED |
| 16-01 | 18104 | CLAIMED |
| **17-02** | **18105** | **CLAIMED (this phase)** |
| Phase 18+ | 18106+ | Reserved |

## Wave Structure

| Wave | Plan | Parallel? | Reason |
|------|------|-----------|--------|
| 1 | 17-01 | (sole) | Server half: classifier + actions + unit tests. No UI dependency. |
| 2 | 17-02 | (sole) | Client half: Settings page + Dialog + integration. Depends on 17-01's action exports + classifier. |

Cannot parallelize — 17-02 imports `rebalancePreviewAction` + `rebalanceApplyAction` from 17-01's `lib/actions/rebalance.ts`.

## Files Touched (no overlap between plans)

**17-01 creates/modifies:**
- `lib/rebalance.ts` (NEW)
- `lib/actions/rebalance.ts` (NEW)
- `tests/unit/rebalance.test.ts` (NEW)
- `tests/unit/actions/rebalance-actions.test.ts` (NEW)

**17-02 creates/modifies:**
- `app/(app)/h/[homeId]/settings/scheduling/page.tsx` (NEW)
- `components/rebalance-card.tsx` (NEW)
- `components/rebalance-dialog.tsx` (NEW)
- `app/(app)/h/[homeId]/settings/page.tsx` (MODIFY — add Scheduling Card)
- `tests/unit/rebalance-dialog.test.tsx` (NEW)
- `tests/unit/rebalance-integration.test.ts` (NEW)

Zero shared files between waves → clean hand-off via module exports.

## Risk Flags for Executor

1. **D-06 marker-clear value:** Phase 15 uses `null` to represent the "no marker" state in zod + Task type (`reschedule_marker?: string | null`). PB 0.37.1 DateField may round-trip cleared values as either `null` or empty string. 17-01 T2 Test A5 asserts the code writes `null`; 17-02 Scenario 2 uses truthy check `!reschedule_marker` to tolerate either storage form. Executor must match 17-01 code's chosen value in Test A5 assertion.

2. **REBAL-07 threading proof in Scenario 2:** Requires crafting seed state where, WITHOUT threading, multiple tasks would cluster on the same date. Recipe: 3 cycle tasks all with freq=14 and identical `created` timestamp (now-7d) → natural ideal cluster at now+7d → tolerance ±2 → 5-day search window all within same week. Threading forces placements to distinct days; without threading, all 3 would pick the same day (load Map shows 0 at ideal for all 3 lookups). `Set.size >= 2` is the weakest provable invariant; `== 3` might occasionally fail at boundary weekend/weekday mixes, so use `>= 2`.

3. **Task 1 classifier dormancy detection:** `classifyTasksForRebalance` calls `computeNextDue` on a synthesized "natural-only" view to detect dormancy. This is correct per D-02 but means the classifier depends on `computeNextDue`'s Phase 11 seasonal branches. If seasonal tests start failing, check that the synthesized `naturalView.next_due_smoothed = null` + `reschedule_marker = null` is preserved (otherwise the Phase 12 smoothed branch or Phase 15 marker branch could short-circuit dormancy).

4. **17-02 Scenario 3 expected counts:** Per D-06 revision, the first apply CLEARS markers, so the ex-marker task becomes rebalanceable on the second run. Second apply `updated` = 4 (not 3). Idempotency is on the 3 originally-rebalanceable tasks' VALUES, not on the updated COUNT. Plan language explicitly warns about this in the task description.

5. **Dialog preview fetch on open:** React Server Actions cannot be called from a Client Component render path. Fetch MUST be wrapped in `useTransition` fired from `onOpenChange`. Plan 17-02 gives the explicit code pattern.

## Phase Close Criteria

Phase 17 closes when all of:

- [ ] 17-01-P01-PLAN.md executed → `lib/rebalance.ts` + `lib/actions/rebalance.ts` + 25 unit tests green
- [ ] 17-02-P01-PLAN.md executed → Settings page + Dialog + 8 RTL tests + 3 integration scenarios green on port 18105
- [ ] Full regression `npm test --run` green with baseline + 36 new tests
- [ ] `npx tsc --noEmit` clean
- [ ] All 7 REBAL REQ-IDs mapped to evidence (see REQ table above)
- [ ] Commits include TDD RED→GREEN pairs for 17-01 tasks (Task 1 + Task 2)
- [ ] 17-01 and 17-02 SUMMARY files written with dependency graph, patterns, handoff sections
- [ ] STATE.md updated via gsd tooling (handled by /gsd-execute-phase commit hook, not manually)
- [ ] Ready for `/gsd-verify-work` phase close

## Handoff to Phase 18

Phase 17 is the last behavioral phase before SPEC v0.4 docs. Phase 18 DOCS-05 MUST document:

- REBAL algorithm: preservation priority (anchored > override > marker > rebalanceable), fresh load map + threading, ascending ideal-date sort, atomic batch, marker clear on apply.
- New `reschedule_marker` field semantics and its REBAL relationship (set by SNZE-07 "From now on"; cleared by REBAL apply for the from-now-on bucket).
- v1.1 minimal REBAL surface + v1.2 deferred items (per-task preview, undo, auto-trigger, area-scoped — all in REBAL-V2 section of REQUIREMENTS.md).

---

*Phase 17 validation authored 2026-04-22. 2 plans, 0 gaps, 7 REBAL REQs covered, port 18105 claimed.*
