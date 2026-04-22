# Phase 13: Task Creation Semantics — Context

**Gathered:** 2026-04-22
**Status:** Ready for planning
**Mode:** Autonomous smart-discuss (TCSEM requirements fully specified in REQUIREMENTS.md; no user judgment calls required)

<domain>
## Phase Boundary

Every new task — custom or seed-batched — enters the system with a load-smoothed `next_due_smoothed` already populated, eliminating the v1.0 onboarding clumping problem at its source. "Last done" becomes an optional Advanced field; smart defaults handle the common case; SDST synthetic completions are fully removed.

**In scope (7 REQ-IDs):**
- TCSEM-01 Task form "Last done" optional field in Advanced collapsible (default collapsed)
- TCSEM-02 "Last done" provided + cycle mode → `first_ideal = last_done + frequency_days`, then load-smoothed
- TCSEM-03 "Last done" blank → smart-default: ≤7d → tomorrow; 8-90d → cycle/4; >90d → cycle/3 — then load-smoothed
- TCSEM-04 All new tasks get `next_due_smoothed` populated at creation (anchored is bypass per LOAD-06; OOFT is bypass per LOAD-09; cycle tasks always smoothed)
- TCSEM-05 `batchCreateSeedTasks` rewrite: call TCSEM per task, thread load map in-memory between tasks so cohort naturally distributes
- TCSEM-06 SDST removal: no synthetic `via='seed-stagger'` completions; remove any `completions.via` enum additions; remove SDST history/stats/notification filters
- TCSEM-07 v1.0 migration contract: zero changes to existing tasks; existing null `next_due_smoothed` continues natural cadence until post-upgrade completion

**Out of scope:**
- Action sheet reschedule UI (Phase 15)
- Seasonal "Active months" form section (Phase 14)
- Horizon density visualization (Phase 16)
- Manual rebalance (Phase 17)

**Deliverables:**
1. Task form component extension: Advanced collapsible with "Last done" date field.
2. `createTaskAction` (or equivalent server action) extended with TCSEM placement:
   - Compute `first_ideal` from `last_done + freq` (if provided) or smart default (if not)
   - Call `placeNextDue(task, householdLoad, now, opts)` from Phase 12
   - Write `next_due_smoothed` atomically with the task row (batch)
3. `batchCreateSeedTasks` rewrite: thread in-memory load Map across seeds; each placement updates the Map before the next seed's placement.
4. SDST removal: audit codebase for any synthetic-completion code or `via='seed-stagger'` references; delete.
5. Test coverage: ~12 unit tests (smart-default math, last-done math, batch accumulation) + 3 integration scenarios (custom create, seed batch, SDST absence).
</domain>

<decisions>
## Implementation Decisions

### Smart-default formula — REQUIREMENT-LOCKED (TCSEM-03)

- **D-01 (formula per TCSEM-03):**
  - `frequency_days <= 7`: first_ideal = `now + 1 day` (tomorrow)
  - `frequency_days` in `8..90`: first_ideal = `now + Math.floor(freq / 4)` days
  - `frequency_days > 90`: first_ideal = `now + Math.floor(freq / 3)` days
  - OOFT (null/0 freq): bypass — use `due_date` directly, no placement
  - Anchored mode: bypass — use natural anchored date (LOAD-06)

### Last-done handling (TCSEM-02)

- **D-02 (last_done provided + cycle mode):** `first_ideal = last_done + frequency_days`. If result ≤ now, still feed to `placeNextDue` — it will honor forward-only (result ≥ now via tolerance window; if deep overdue, returns clamped-to-today per T-12-04 documented behavior). Past first_ideal = legitimate ("I did this 3 months ago, next one soon").
- **D-03 (last_done + anchored mode):** "Last done" field is hidden / disabled when anchored is selected in the form. Anchored tasks don't have cycle semantics; last_done is meaningless. UI concern — form toggles field visibility on mode.
- **D-04 (last_done + OOFT):** "Last done" field hidden when OOFT is selected. OOFT uses explicit due_date from Phase 11; no last-done relationship.

### Placement integration (TCSEM-04)

- **D-05 (createTaskAction pattern mirrors completeTaskAction):** Same `pb.createBatch()` pattern from Phase 10+11+12. Compute first_ideal → fetch sibling tasks → `computeHouseholdLoad` → `placeNextDue` → append `tasks.create` with `next_due_smoothed: iso(placedDate)` in the payload (not a separate update — creation is the single op). All within one batch for atomicity.
- **D-06 (error fallback):** If placement throws, fall back to writing `next_due_smoothed = null`. v1.0 natural-cadence read behavior resumes. Completion-time placement (Phase 12) will fix on first completion. Log `console.warn`.
- **D-07 (useTemplate + seed-library paths):** Both custom-form creation AND seed-library one-off creation go through the same `createTaskAction`. Phase 5's `createTaskAction` (or nearest equivalent) is the single insertion point.

### batchCreateSeedTasks rewrite (TCSEM-05)

- **D-08 (in-memory load map threading):** Start with freshly fetched household load Map (existing tasks). For each seed in the batch:
  1. Compute first_ideal via D-01 smart default (seeds rarely have last_done; if present, use it)
  2. Call `placeNextDue(seedTask, householdLoad, now, opts)` — returns a date
  3. Mutate `householdLoad` in-memory: increment the count at the chosen ISO date key
  4. Next seed's placement sees the updated Map — naturally distributes cohort
- **D-09 (single PB batch for all seeds):** Existing Phase 5 `batchCreateSeedTasks` uses `pb.createBatch()` atomically. Phase 13 preserves that — all N `tasks.create` ops in one batch with smoothed dates already computed.
- **D-10 (performance):** 10-seed cohort × placement = 10 placeNextDue calls × ~4ms each = ~40ms worst case. Well under any user-perceptible budget.

### SDST removal (TCSEM-06)

- **D-11 (delete-not-rename approach):** Audit for any:
  - Migrations extending `completions.via` with `seed-stagger` value — DELETE or revert additive changes
  - Hook/trigger code emitting synthetic completions — DELETE
  - Filters in lib/notifications.ts / lib/coverage.ts / history view referencing `via='seed-stagger'` — DELETE filter branches
  - Test fixtures with synthetic completions — DELETE tests
  - CONTEXT/ROADMAP/SPEC references — NOTE only; Phase 18 will clean SPEC references
- **D-12 (audit methodology):** `grep -rn "seed-stagger\|SDST\|seed_stagger" --include="*.{ts,js,tsx,jsx}" .` — should return zero matches after Phase 13. Phase 18 cleans docs-level references.

### v1.0 migration contract (TCSEM-07)

- **D-13 (zero-change mandate):** No migration in Phase 13. Existing tasks keep `next_due_smoothed = NULL`. Phase 12's D-02 read-time fallback handles — natural cadence continues until post-upgrade completion triggers Phase 12's completeTaskAction placement. First-completion-writes-smoothed is the upgrade path.
- **D-14 (no backfill job):** No CLI/script/admin-action to batch-smooth v1.0 tasks. Users experience zero behavior change at upgrade; Manual Rebalance (Phase 17) is the opt-in tool if they want to smooth retroactively.

### Form UX (TCSEM-01)

- **D-15 (Advanced collapsible):** Shadcn Collapsible component or equivalent. Default closed. Label "Advanced". Contains:
  - "Last done (optional)" — date picker, only shown when mode = cycle (D-03/D-04 hide for anchored/OOFT)
- **D-16 (no other fields in Advanced for Phase 13):** Phase 14/15 may add more Advanced fields (active months, OOFT due date if moved here); Phase 13 ships just the one.

### Test scope

- **D-17 (~12 unit tests + 3 integration):**
  - 5 smart-default tests: freq=3 (tomorrow), freq=7 (tomorrow — boundary), freq=30 (cycle/4=7), freq=60 (15), freq=365 (cycle/3=121)
  - 3 last-done tests: last_done + cycle = last_done+freq; OOFT ignores last_done; anchored ignores last_done
  - 4 batch cohort tests: 5-seed cohort distributes (no clusters); empty seed list no-op; single seed places identically to solo create; 10-seed cohort respects load map
  - 3 integration scenarios on port **18101**:
    1. Custom create writes next_due_smoothed atomically (assert in same PB read)
    2. Seed-library 5-pack creation distributes across dates (assert no ≥3-cluster on any ISO date)
    3. SDST audit — integration seeds PB fresh, creates tasks, `via='seed-stagger'` never appears in any completions row

### Port + migration

- **D-18 (Port 18101 claimed):** 18090..18101 log (Phase 11 = 18099, Phase 12 = 18100, Phase 13 = 18101).
- **D-19 (No new migration):** Phase 13 is pure app-layer. No new fields on tasks, no new collection.

### Claude's Discretion

- Exact form component (Collapsible vs Details/Summary) — recommend shadcn Collapsible (existing usage pattern).
- Last-done field placement (before/after Advanced toggle) — recommend inside Advanced for TCSEM-01 compliance.
- Whether to export `computeFirstIdealDate(mode, freq, lastDone?, now)` helper — recommend yes (reuse in createTaskAction + batchCreate + tests).
- batchCreateSeedTasks call signature — keep existing shape, add load-map threading internally.
</decisions>

<canonical_refs>
## Canonical References

### Scope
- `.planning/ROADMAP.md` §"Phase 13" — TCSEM-01..07 success criteria
- `.planning/REQUIREMENTS.md` — 7 TCSEM-xx rows
- `.planning/v1.1/audit-addendum-load.md` §TCSEM — SDST removal rationale

### Phase 12 consumed primitives
- `lib/load-smoothing.ts` — `placeNextDue`, `computeHouseholdLoad`, `isOoftTask`
- `lib/task-scheduling.ts` — `computeNextDue` smoothed branch (read-side)
- `lib/actions/completions.ts` — Phase 12 batch extension pattern (mirror for createTaskAction)

### Phase 5 existing patterns
- `lib/actions/seed.ts` (or wherever batchCreateSeedTasks lives) — existing pb.createBatch seed-batch pattern
- `lib/seed-library.ts` — seed definitions (read-only reference)
- Task form component (`components/task-form.tsx` or similar) — existing form structure to extend

### SDST audit targets
- All `*.ts`, `*.js`, `*.tsx` files — grep for `seed-stagger`, `SDST`, `seed_stagger`
- `lib/notifications.ts` — check for filter branches
- `lib/coverage.ts` — check for filter branches
- Any pb_migrations files adding `via` enum values
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase 12 `placeNextDue` + `computeHouseholdLoad` + `isOoftTask` — Phase 13 is the 5th consumer (after read branch, write batch, perf, integration).
- Phase 10+11+12 `pb.createBatch()` pattern — createTaskAction mirrors it one-op style: single `tasks.create` with `next_due_smoothed` computed pre-send.
- Phase 5's `batchCreateSeedTasks` — existing implementation; Phase 13 extends not rewrites the batch pattern, just adds the placement loop inside.

### Integration Points
- `createTaskAction` server action (Phase 2 or 5 — find via grep `createTaskAction\|tasks.*create`) — primary extension point.
- Task form component (Phase 2/5) — Advanced collapsible addition.
- Seed library batch creation — Phase 5 `batchCreateSeedTasks`.

### Performance realities
- 5-seed cohort placement: ~20ms total. Not user-visible.
- 10-seed cohort placement: ~40ms. Still sub-100ms.
</code_context>

<specifics>
## Specific Ideas

### Threat model deltas
- **T-13-01 — Form bypass creating task without next_due_smoothed**: An attacker could POST directly to the PB tasks endpoint, bypassing createTaskAction. Mitigation: Phase 12's completeTaskAction placement backs this up — first completion writes smoothed date. D-06 fallback (placement error → null → natural cadence) also covers malformed task rows.
- **T-13-02 — Smart-default drift**: TCSEM-03 formulas are requirement-locked; test coverage (D-17) asserts exact values.
- **T-13-03 — SDST residue**: Any missed SDST reference leaves stale dead code. Mitigation: integration scenario 3 audits via grep + runtime presence check.
- **T-13-04 — Batch placement race**: Concurrent seed-batch creations could read stale load map. Mitigation: each createBatch is atomic; races resolve eventually via first-completion-smooths-all pattern (Phase 12).
</specifics>

<deferred>
## Deferred Ideas

### Out of Phase 13 scope
- **OOFT "do by" date field in form (OOFT-04)**: Phase 15.
- **Active months section (SEAS-07)**: Phase 14.
- **Preferred days dropdown in form (PREF-UI)**: Phase 14/15.
- **Manual rebalance tool**: Phase 17 (REBAL).
- **Retroactive smoothing of v1.0 tasks**: deferred by D-14 — manual rebalance handles.
</deferred>

---

*Phase: 13-task-creation-semantics*
*Context gathered: 2026-04-22 via autonomous smart-discuss*
