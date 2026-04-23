# Phase 17: Manual Rebalance — Context

**Gathered:** 2026-04-22
**Status:** Ready for planning
**Mode:** Autonomous smart-discuss (REBAL-01..07 fully specified; minimal UI surface)

<domain>
## Phase Boundary

Manual escape hatch for forward-only smoothing: Settings → Scheduling → "Rebalance schedule" button → counts-only preview (preservation breakdown) → Apply that re-runs placeNextDue against fresh computeHouseholdLoad map for every non-preserved task. v1.1 minimal surface; per-task preview, undo, auto-trigger, area-scoped rebalance deferred to v1.2+.

**In scope (7 REQ-IDs):**
- REBAL-01 Anchored-mode tasks preserved (never re-placed)
- REBAL-02 Tasks with unconsumed schedule_overrides preserved (snooze user intent wins)
- REBAL-03 Tasks whose reschedule_marker is set preserved (SNZE-07 "From now on")
- REBAL-04 All other tasks re-placed via placeNextDue with fresh computeHouseholdLoad
- REBAL-05 Settings → Scheduling "Rebalance schedule" button
- REBAL-06 Preview modal — counts only: "Will update: N / Will preserve: M (A anchored, B active snoozes, C from-now-on shifts)"
- REBAL-07 Re-placement in ascending ideal-date order, updating in-memory load map between placements (deterministic, matches TCSEM pattern)

**Out of scope (v1.2+):**
- Per-task preview (REBAL-V2-01)
- Undo toast (REBAL-V2-02)
- Auto-triggered rebalance (REBAL-V2-03)
- Area-scoped rebalance (REBAL-V2-04)

**Deliverables:**
1. Server action `rebalancePreviewAction(homeId)` — dry-run: classifies tasks into 4 buckets (anchored, active-override, from-now-on, rebalanceable) and returns counts + breakdown.
2. Server action `rebalanceApplyAction(homeId)` — actually applies placeNextDue to the rebalanceable bucket. Single atomic pb.createBatch with N update ops. In-memory load map threaded (REBAL-07 pattern matches TCSEM batchCreateSeedTasks from Phase 13).
3. Pure helper `classifyTasksForRebalance(tasks, overridesByTask): { anchored, active_snooze, from_now_on, rebalanceable }` — Map-returning classification.
4. UI: Settings → Scheduling nav section, Rebalance button, preview Dialog with counts + breakdown, Apply button calling rebalanceApplyAction.
5. Tests: ~12 unit + 3 integration on port **18105**.
</domain>

<decisions>
## Implementation Decisions

### Classification buckets (REBAL-01/02/03)

- **D-01 (priority order for tie-breaking — a task in multiple buckets goes to the earliest):**
  1. Anchored: `task.schedule_mode === 'anchored'` (REBAL-01)
  2. Active-override: task has row in `overridesByTask` Map (REBAL-02)
  3. From-now-on: `task.reschedule_marker !== null` (REBAL-03)
  4. Rebalanceable: everything else (cycle mode, not-overridden, no marker)
- **D-02 (exclusions beyond buckets):** archived tasks excluded entirely. OOFT tasks (frequency_days null/0) excluded — OOFT doesn't smoother-place at all per LOAD-09. Dormant seasonal tasks (currently outside window) excluded — they'd just return null from placeNextDue.

### Apply algorithm (REBAL-04/07)

- **D-03 (ascending ideal-date order):** Sort rebalanceable bucket by each task's *natural* ideal date (computeNextDue with next_due_smoothed stripped). Earliest ideal first. Matches TCSEM pattern (first-seed gets earliest placement).
- **D-04 (fresh load map at start, then threaded):** Compute `computeHouseholdLoad(allTasks, now, 120)` once at start (includes anchored + overrides + from-now-on contributions). For each rebalanceable task: `placeNextDue(task, householdLoad, now, opts)` → returns date → add op to batch → mutate in-memory map (increment count at placed date).
- **D-05 (single atomic batch):** All N updates in one pb.createBatch. Atomic rollback on failure. Match Phase 13 batchCreateSeedTasks semantics.
- **D-06 (marker not cleared):** The reschedule_marker field on preserved tasks is NOT cleared by rebalance. Marker persists until the user explicitly edits the task or it's cleared via future UI. (v1.2 REBAL-V2 may revisit.) Actually — review: SNZE-07 context in Phase 15 D-08 said "Rebalance apply (Phase 17) clears markers for preserved tasks." Decision: clear marker for from-now-on bucket tasks during apply — the marker has served its purpose (preserved this run). Next rebalance re-treats them normally. This matches user intent: "From now on" was honored once; user explicitly accepted the schedule, now it's just a normal task.

### UI (REBAL-05/06)

- **D-07 (Settings → Scheduling nav):** Create `app/(app)/settings/scheduling/page.tsx` (or extend existing settings). Section header "Scheduling", Rebalance button with description text explaining what it does + which tasks are preserved.
- **D-08 (preview Dialog):** Shadcn AlertDialog or Dialog. Calls `rebalancePreviewAction` on open. Shows counts + breakdown. Buttons: "Cancel" / "Apply rebalance". On apply → `rebalanceApplyAction` → success toast "Rebalanced N tasks" → router.refresh.
- **D-09 (counts text):** Example: "Will update: 18. Will preserve: 7 (3 anchored, 2 active snoozes, 2 from-now-on)." Exact format up to designer discretion within this template.

### Server action signatures

- **D-10 (`rebalancePreviewAction(homeId): Promise<RebalancePreview>`):** Returns `{ update_count: number, preserve_anchored: number, preserve_override: number, preserve_from_now_on: number, preserve_total: number }`.
- **D-11 (`rebalanceApplyAction(homeId): Promise<RebalanceResult>`):** Returns `{ ok: true, updated: number } | { ok: false, formError: string }`. Membership-gated via assertMembership.

### No-op on second run (SC #5)

- **D-12 (idempotency):** Running rebalance on an already-smooth map produces zero actual date changes (each placeNextDue returns the same date). Batch still runs but update ops are no-ops (PB treats update-to-identical as write; acceptable). Test: run rebalance twice; second run's result count equals first run's result count but assert no task's `next_due_smoothed` value changed between invocations.

### Test scope

- **D-13 (~12 unit + 3 integration on port 18105):**
  - 4 classification tests: anchored bucketed; active-override bucketed; from-now-on bucketed; rebalanceable bucketed. Priority ordering covers overlap.
  - 4 apply-action tests: anchored untouched; override task untouched; marker task untouched (marker cleared after? per D-06); rebalanceable tasks get new dates.
  - 2 preview-action tests: counts breakdown correct; membership gate.
  - 2 marker lifecycle tests: reschedule_marker cleared after apply (D-06 revision); marker still preserves during preview (not yet applied).
  - 3 integration scenarios on port 18105:
    1. Preview shows correct counts for seeded mix of anchored+override+marker+cycle
    2. Apply updates only rebalanceable tasks; preserves the 3 bucket categories
    3. Second apply is effective no-op (dates stable)

### Port

- **D-14 (Port 18105 claimed):** 18090..18105 log.

### Claude's Discretion
- UI layout — Settings page structure, whether Rebalance gets its own sub-page vs section
- Exact wording of preview copy ("Will update" vs "Smooth forward")
- Marker-clearing semantics after apply — recommend CLEAR (revised D-06) so future rebalances treat the task normally
</decisions>

<canonical_refs>
- `.planning/ROADMAP.md` §"Phase 17"
- `.planning/REQUIREMENTS.md` REBAL-01..07
- `.planning/phases/12-load-smoothing-engine/12-04-P01-SUMMARY.md` (placeNextDue, computeHouseholdLoad)
- `.planning/phases/13-task-creation-semantics/13-01-P01-SUMMARY.md` (batchCreateSeedTasks load-map threading — exact pattern to replicate)
- `.planning/phases/15-one-off-reschedule-ui/15-01-P01-SUMMARY.md` (reschedule_marker field, snoozeTaskAction atomic-replace)
- `lib/load-smoothing.ts` (placeNextDue, computeHouseholdLoad)
- `lib/schedule-overrides.ts` (getActiveOverridesForHome)
- `lib/actions/seed.ts` (load-map threading pattern reference)
- `lib/actions/reschedule.ts` (action pattern reference)
</canonical_refs>

<deferred>
- Per-task preview modal (v1.2 REBAL-V2-01)
- Undo toast (v1.2 REBAL-V2-02)
- Auto-triggered rebalance (v1.2 REBAL-V2-03)
- Area-scoped rebalance (v1.2 REBAL-V2-04)
</deferred>

---

*Phase: 17-manual-rebalance*
*Context gathered: 2026-04-22*
