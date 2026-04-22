# Phase 12: Load-Smoothing Engine — Context

**Gathered:** 2026-04-22
**Status:** Ready for planning
**Mode:** Autonomous smart-discuss (STATE.md pre-locks all tolerance + forward-only + anchored-bypass decisions; phase is largely mechanical assembly over Phases 10+11 primitives)

<domain>
## Phase Boundary

Deliver the SPEC thesis — *"spread the year's work evenly across weeks"* — by making `computeNextDue` consult a stored `tasks.next_due_smoothed` that is chosen by a forward-only placement algorithm over a per-day household load map. All 6 branches of `computeNextDue` compose coherently; anchored tasks bypass smoothing entirely.

**Hard gate (user-flagged):** Phase 12's highest risk is the branch composition matrix. Every meaningful interaction across the 6 branches (override, smoothed, anchored, seasonal, one-off, natural) MUST be explicitly tested — no implicit fall-through assumptions. This is LOAD-15, the phase is not complete until green.

**In scope (15 REQ-IDs):**
- LOAD-01 `tasks.next_due_smoothed DATE` field (nullable additive migration)
- LOAD-02 `computeNextDue` consults `next_due_smoothed`
- LOAD-03 `placeNextDue(task, householdLoad, now, options): Date` pure helper
- LOAD-04 Tolerance window `min(0.15 * frequency_days, 5)` initial (rider 1 validation — widen to 14 if annual clusters bunched)
- LOAD-05 PREF narrows BEFORE load scoring (hard constraint)
- LOAD-06 Anchored tasks bypass smoothing (byte-identical v1.0 behavior for anchored)
- LOAD-07 Seasonal wake-up anchors to window start; smoother runs from second cycle
- LOAD-08 Snoozed tasks contribute snooze date to load map for OTHER tasks' placement
- LOAD-09 OOFT tasks contribute to load map on `due_date` but `next_due_smoothed` never set
- LOAD-10 Smoother runs on task creation AND on task completion (Phase 13 wires creation; Phase 12 wires completion)
- LOAD-11 Forward-only — placing one task never mutates another's `next_due_smoothed`
- LOAD-12 Tiebreakers: closest-to-ideal wins, then earlier wins
- LOAD-13 <100ms performance budget for 100-task household
- LOAD-14 `computeHouseholdLoad(tasks, now, windowDays): Map<ISODate, number>` single-query helper
- LOAD-15 Branch composition test matrix — hard gate

**Out of scope:**
- Task form creation wiring (Phase 13 TCSEM)
- Horizon density visualization (Phase 16 LVIZ — consumes this phase's load map)
- Manual rebalance (Phase 17 REBAL — reads `next_due_smoothed` and override markers)
- UI surfaces for "shifted" badges (Phase 16)
- Effort/capacity weighting (v1.2+ deferred)

**Deliverables:**
1. Migration: `tasks.next_due_smoothed DATE NULL` (additive, timestamp after Phase 11's 1745280001).
2. Pure helpers in `lib/load-smoothing.ts`:
   - `computeHouseholdLoad(tasks, now, windowDays): Map<string, number>` — ISO-date keyed day-count map
   - `placeNextDue(task, householdLoad, now, options): Date` — forward-only smoother
3. `computeNextDue` gains smoothed branch (position per D-16 Phase 11 + D-05 Phase 12 = override → smoothed → seasonal → OOFT → anchored/natural).
4. `completeTaskAction` batch extended: on completion, call `placeNextDue` for the completed task's next cycle and append `tasks.update(id, { next_due_smoothed: date })` to the batch.
5. Perf budget benchmark test (<100ms for 100 tasks).
6. Branch matrix: 6 branches × meaningful interactions = LOAD-15 hard gate.
7. Rider 1 tolerance validation: integration-seeded 30-task household, cluster-count check, widen-to-14 decision commit if clusters > N/4.
</domain>

<decisions>
## Implementation Decisions

### Data model

- **D-01 (LOAD-01): `tasks.next_due_smoothed DATE NULL` single additive field.** Migration `1745280002_next_due_smoothed.js` (timestamp +1 from Phase 11). Post-construction `.fields.add()` pattern. No index (low-cardinality per household; scans are bounded at <200 rows). v1.0 rows get null → read-time falls through to natural via D-02.
- **D-02 (LOAD-02): Branch order in `computeNextDue` after Phase 12:** override → **smoothed (NEW)** → seasonal-dormant → seasonal-wakeup → OOFT → anchored/cycle-natural. Smoothed lives between override (Phase 10, trumps all) and seasonal (Phase 11). Anchored bypasses smoothing (LOAD-06) via explicit guard: if `task.schedule_mode === 'anchored'`, skip smoothed branch.
- **D-03 (LOAD-06 anchored bypass precise):** Anchored-mode tasks do NOT consult `next_due_smoothed` — even if an anchor was flipped from cycle→anchored mid-v1.1. The `next_due_smoothed` field may contain a stale value; read-time guard `if (mode === 'anchored') skip smoothed` is authoritative. Anchored tasks STILL contribute to `computeHouseholdLoad` (they appear on the load map so other tasks' placement accounts for them).

### Placement algorithm

- **D-04 (LOAD-03 helper signature): `placeNextDue(task, householdLoad, now, { preferredDays?, tolerance? }): Date`.** Returns the chosen date as midnight in home timezone. Pure — no I/O, no side effects. Takes the household load map as an input (caller computed it once via `computeHouseholdLoad`).
- **D-05 (LOAD-04 tolerance default): `tolerance = min(0.15 * frequency_days, 5)` days each side of natural ideal.** For a 30-day task that's `min(4.5, 5) = 4.5` → round to 5; for a 365-day task that's `min(54.75, 5) = 5`. Override via optional `options.tolerance` for tests. Rider 1 validation (see D-17).
- **D-06 (LOAD-05 PREF first, load second): Narrowing order inside placeNextDue:**
  1. Generate candidate date set: natural_ideal ± tolerance (inclusive, step 1 day)
  2. Apply `narrowToPreferredDays(candidates, task.preferred_days)` (Phase 11 helper)
  3. If narrowed set empty, widen forward in +1 day increments up to +6 (PREF-03)
  4. Score remaining candidates by `householdLoad.get(iso(date)) ?? 0`
  5. Pick: lowest score → closest-to-ideal → earliest (LOAD-12 tiebreaker chain)
- **D-07 (LOAD-11 forward-only contract): `placeNextDue` returns a date ONLY for the argument task.** The returned date is written to `task.next_due_smoothed` by the caller (completeTaskAction's batch). No other task's record is ever mutated inside placeNextDue. If household load shifts because of this placement, OTHER tasks don't re-smooth until their own next completion triggers their own placeNextDue call. This is the LOAD-11 forward-only contract.
- **D-08 (LOAD-12 tiebreakers — exact order):**
  1. Lowest `householdLoad.get(iso(date))` value wins
  2. Among ties, smallest `|date - natural_ideal|` wins (closest-to-ideal)
  3. Among further ties, earliest date wins
  4. Fully ordered — no non-determinism

### Household load map

- **D-09 (LOAD-14 signature): `computeHouseholdLoad(tasks, now, windowDays): Map<string, number>`.** Key = ISO date string `YYYY-MM-DD` in home tz (NOT UTC — placement windows are home-tz aligned). Value = count of tasks whose effective next_due falls on that date. "Effective next_due" means the result of `computeNextDue` for each task (which includes the just-placed task for tail calls). Takes `windowDays` to bound iteration — default 120 days (covers longest meaningful tolerance for 365-day tasks).
- **D-10 (LOAD-08+09 load contributions): All task types contribute.**
  - Archived tasks: SKIP (excluded from map)
  - Dormant seasonal tasks: SKIP (their null next_due means no contribution)
  - OOFT tasks: contribute `1` on `due_date` (LOAD-09)
  - Snoozed tasks: contribute `1` on `override.snooze_until` (LOAD-08) — the override date is the "effective due" date
  - Anchored tasks: contribute `1` on their natural anchored date (LOAD-06 — anchored still LOAD-visible, just not smoothed)
  - Cycle tasks with `next_due_smoothed` set: contribute on smoothed date
  - Cycle tasks with `next_due_smoothed = NULL` (v1.0 holdovers): contribute on natural next_due
- **D-11 (LOAD-14 single query): Batch fetch once per `placeNextDue` invocation.** `pb.collection('tasks').getFullList({ filter: 'home_id = {:hid} && archived = false', fields: 'id,frequency_days,anchor_date,schedule_mode,preferred_days,active_from_month,active_to_month,due_date,next_due_smoothed' })` — single roundtrip, select only fields needed for load + placement. The override Map (from Phase 10's `getActiveOverridesForHome`) is passed in separately.
- **D-12 (LOAD-13 perf budget <100ms): Measured in a benchmark test.** `tests/unit/load-smoothing-perf.test.ts` seeds 100 task fixtures in-memory, runs `placeNextDue` once, asserts `performance.now()` delta < 100ms. No disposable-PB dependency — this is a pure algorithmic budget. Real-world latency includes PB roundtrip; that's a separate concern and handled by D-11's single-query rule.

### Integration points

- **D-13 (LOAD-10 completion trigger): Extend Phase 10+11 batch in `completeTaskAction`.**
  - After writing the completion record (Phase 10) and consuming any active override (Phase 10) and archiving OOFT if applicable (Phase 11)
  - IF task.schedule_mode === 'cycle' AND task.frequency_days != null && 0 (i.e., not OOFT, not anchored): compute placement
  - Call `computeHouseholdLoad(otherTasks, now, 120)` (fetch required — augments the batch with one read; acceptable per D-11 bound)
  - Call `placeNextDue(task, householdLoad, now, { preferredDays: task.preferred_days })`
  - Append `batch.collection('tasks').update(task.id, { next_due_smoothed: iso(placedDate) })` to the same batch
  - Rollback semantics: entire batch atomic (Phase 10 contract preserved). If placement errors (e.g. NaN date from corrupt data), swallow and leave `next_due_smoothed = NULL` — natural fallback per D-02.
- **D-14 (Phase 13 TCSEM forward contract): Task creation also triggers placement.** Phase 13 will wire `placeNextDue` into `createTaskAction` using the same pattern. Phase 12 ships only the completion trigger; creation trigger is Phase 13's TCSEM-01..07.
- **D-15 (LOAD-07 seasonal wake-up + smoothing handshake):** When a seasonal task wakes up (first cycle OR first cycle of new season), it anchors to `nextWindowOpenDate` without smoothing — the wake-up date is a calendar landmark, not a load-smoothing target. From the second completion onward, smoothing runs normally. Implementation: inside `computeNextDue` the seasonal-wakeup branch short-circuits before the smoothed branch would consult `next_due_smoothed`. Written to `next_due_smoothed` only from the second placement.

### Validation

- **D-16 (Branch matrix — LOAD-15 hard gate): 6 branches × 15 meaningful interactions.** Concrete test cases:
  - **Branch precedence (6 tests):** archived wins, override > smoothed, smoothed > seasonal, seasonal > OOFT, OOFT > cycle, cycle > anchored... wait — anchored is mutually exclusive with cycle per schedule_mode. Revise: 6 branches total (override | smoothed | seasonal-dormant | seasonal-wakeup | OOFT | cycle-natural-OR-anchored — last branch splits by schedule_mode but is the same branch structurally).
  - Actual branch precedence sequence test: override > smoothed > seasonal-dormant > seasonal-wakeup > OOFT > cycle/anchored.
  - **Interactions (15+ tests):**
    - override × smoothed (override wins, smoothed ignored)
    - override × seasonal (override wins even during dormant month)
    - override × OOFT (override wins, OOFT due_date ignored until override consumed)
    - smoothed × anchored (anchored bypasses smoothing — returns natural anchored date)
    - smoothed × seasonal-wakeup (seasonal-wakeup wins for first cycle; smoothed engages on second)
    - smoothed × PREF (narrow first, then score)
    - smoothed × empty-PREF-window (widen forward +1..+6)
    - seasonal-dormant × cycle-natural (dormant returns null, no fall-through)
    - seasonal-wakeup × PREF (wake-up anchors to window start; PREF does NOT narrow wake-up)
    - OOFT × PREF (no-op — OOFT returns due_date verbatim)
    - v1.0 holdover (null next_due_smoothed) + cycle mode → natural cadence
    - Post-completion: null before → non-null after (placement wrote)
    - OOFT contributes to load map but its own smoothed field stays null
    - Snoozed task contributes snooze_until date to load map for siblings
    - Anchored task contributes natural date to load map (not smoothed)
  - 21 total branch/interaction cases minimum. Additional edge cases encouraged.
- **D-17 (Rider 1 tolerance validation): 30-task test household check at phase close.**
  - Seed 30-task fixture covering 1, 7, 14, 30, 90, 365-day frequencies (5 tasks each)
  - Run placement for all 30 in sequence
  - Count task clusters on each ISO date — a "cluster" = 3+ tasks on same date
  - If total clusters > 7 (household-of-30 fairness threshold), widen default tolerance to `min(0.15 * freq, 14)` and update D-05 + LOAD-04 REQ text
  - Decision committed at phase close, documented in 12-SUMMARY.md

### Test scope

- **D-18 (~25 unit tests + 5 integration scenarios):**
  - 8 `computeHouseholdLoad` cases (all contributor types, empty, dormant excluded, window bounding)
  - 10 `placeNextDue` cases (tolerance at default, at override, PREF narrowing, PREF widening, tiebreakers, anchored skipped, OOFT skipped)
  - 21+ branch matrix cases (D-16) appended to `tests/unit/task-scheduling.test.ts`
  - 5 integration scenarios on port **18100** (next free):
    1. Migration correctness (next_due_smoothed DateField required:false)
    2. End-to-end completion flow writes next_due_smoothed atomically
    3. 100-task perf benchmark (LOAD-13)
    4. 30-task Rider 1 tolerance validation
    5. Post-v1.0-upgrade: v1.0 tasks with null next_due_smoothed complete, get smoothed-date post-completion, second completion reads smoothed

### Migration + port

- **D-19 (Migration timestamp 1745280002):** +1 from Phase 11's 1745280001. Additive single field. Down migration removes the field.
- **D-20 (Port 18100 claimed):** Phase 10 = 18098, Phase 11 = 18099, Phase 12 = 18100. Log 18090..18100.

### Phase 13 forward-compat

- **D-21 (TCSEM-01 contract): `placeNextDue` is the exact same helper Phase 13's createTaskAction will call.** Phase 13 reuses — does not re-implement. The only difference: creation has `lastCompletion = null`, so natural_ideal = `now + frequency_days`. Placement otherwise identical.

### Claude's Discretion

- Whether `computeHouseholdLoad` takes raw tasks or pre-computed next-due Map. Recommend raw tasks + internal loop — call-site ergonomics; Phase 13 will want the same signature.
- Benchmark harness choice (`performance.now()` vs `process.hrtime`) — recommend `performance.now()` (cross-runtime).
- Exact window day count for `computeHouseholdLoad` (default 120 vs 365) — recommend 120 (covers annual tolerance=5; 365 is overkill and 3x slower to build).
- Whether to emit telemetry on tolerance widening — no in v1.1 (no telemetry stack shipped).
</decisions>

<canonical_refs>
## Canonical References

### Scope & audit
- `.planning/v1.1/audit-addendum-load.md` — full LOAD algorithm spec; rider 1 tolerance default + widening criteria; rider 1 validation methodology
- `.planning/ROADMAP.md` §"Phase 12" — success criteria + LOAD-15 hard gate note
- `.planning/STATE.md` — LOAD decisions log (forward-only, tolerance default, anchored-bypass)

### Phase 10+11 consumed primitives
- `lib/task-scheduling.ts` — `computeNextDue` (Phase 10+11 extended); helpers `narrowToPreferredDays`, `isInActiveWindow`, `nextWindowOpenDate`, `effectivePreferredDays` (Phase 11)
- `lib/schedule-overrides.ts` — `getActiveOverride`, `getActiveOverridesForHome` (Phase 10)
- `lib/actions/completions.ts` — Phase 10 batch + Phase 11 OOFT archive op; Phase 12 extends with smoothing op
- `lib/coverage.ts` — dormant filter (Phase 11) reference

### Migration exemplars
- `pocketbase/pb_migrations/1745280001_task_extensions.js` — Phase 11 additive-fields-on-existing-collection; D-19 follows
- `pocketbase/pb_migrations/1745280000_schedule_overrides.js` — Phase 10 new-collection additive pattern

### Test templates
- `tests/unit/task-extensions-integration.test.ts` — port 18099, disposable PB boot + branch-composition integration pattern; D-18 port 18100 mirrors shape
- `tests/unit/task-scheduling.test.ts` — single-file test-of-truth for branch order (Phase 10+11+12)
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase 10+11 `pb.createBatch()` pattern in completeTaskAction extends cleanly with one more op (`tasks.update({next_due_smoothed})`). No new error semantics.
- Phase 11's `narrowToPreferredDays` pure helper is already written and tested — Phase 12's `placeNextDue` composes it as step 2 of the placement pipeline.
- Phase 11's `isInActiveWindow` gates the seasonal contribution to the load map in `computeHouseholdLoad` (dormant tasks excluded).
- `computeNextDue` already threads `timezone?` (Phase 11 A2 resolution) — Phase 12's smoothed branch uses the same param for load map key generation.

### Established Patterns
- Pure algorithm helpers in `lib/*.ts` (cf. `lib/coverage.ts`, `lib/schedule-overrides.ts`, Phase 11 `lib/task-scheduling.ts` extensions).
- Disposable-PB integration tests at `tests/unit/*-integration.test.ts` with `@vitest-environment node`.
- Port allocation log: 18090..18100 (Phase 12 claims 18100).
- ISO-8601 UTC storage; home-tz conversion at boundary (load map keys are home-tz-aligned since they feed into home-rendered UI indirectly via Phase 16).

### Performance realities
- 100-task household in-memory pass: ~3-5ms per `placeNextDue` observed on similar codebases (bounded iteration over 10-day window × simple Map lookup). Budget <100ms provides 20x headroom.
- `computeHouseholdLoad` over 120-day window with 100 tasks: ~1-2ms (iterate tasks, compute next_due each, accumulate in Map).
- PB roundtrip `getFullList` for 100 tasks + 7 fields: ~30-50ms warm. Total end-to-end well under 100ms.
</code_context>

<specifics>
## Specific Ideas

### Threat model deltas
- **T-12-01 — Placement non-determinism from clock skew**: Multiple concurrent completions in same second could race to read different `householdLoad` snapshots. Mitigated by D-07 forward-only contract — each placement is self-contained, siblings' smoothed dates don't change. Convergence is eventual (next completion sees the new snapshot). Integration scenario 5 covers.
- **T-12-02 — Denial-of-service via malicious task creation**: Attacker (household member) creates 10,000 tasks; `computeHouseholdLoad` OOMs or exceeds 100ms budget. Mitigated by existing PB rate-limit on tasks.create; LOAD-13 budget asserted under 100 tasks is the v1.1 realistic ceiling. Household-size-beyond-100 is v2+ concern (parked in v1.2+).
- **T-12-03 — v1.0 upgrade migration leaves `next_due_smoothed = NULL` for all tasks**: Mitigated by D-02 natural fallback. Users experience zero behavior change at upgrade; first post-upgrade completion writes the smoothed date. TCSEM-07 in Phase 13 ensures this is the intended upgrade path.
- **T-12-04 — Placement picks a past date**: Narrow tolerance window + heavy load could theoretically shift a date to "closest low-load day" which is earlier than natural ideal but still ≥ now. Mitigated by LOAD-03 "forward-only" interpretation: natural_ideal is always `lastCompletion + frequency_days`; tolerance bounds are symmetric but the result is always `>= now` because natural_ideal is already in the future relative to lastCompletion. Unit test asserts: for a task completed yesterday with freq=1, result is today or later, never yesterday-again.

### Performance notes
- Benchmark seed generator in `tests/unit/load-smoothing-perf.test.ts` creates 100 tasks with mixed frequencies; `placeNextDue` called once; `performance.now()` delta measured.
- `computeHouseholdLoad` is O(T × W) where T = task count, W = window days. 100 × 120 = 12k iterations — trivially under budget.
- `placeNextDue` is O(candidates × log N) for sort if tie-breaking. Candidates ≤ 2*tolerance+1 ≤ 11; effectively O(1) per placement.
</specifics>

<deferred>
## Deferred Ideas

### Out of Phase 12 scope
- **Task creation placement**: Phase 13 TCSEM.
- **Horizon density visualization**: Phase 16 LVIZ — consumes this phase's load map.
- **Shifted-date ⚖️ badge**: Phase 16 LVIZ — reads `next_due_smoothed` vs natural.
- **Manual rebalance**: Phase 17 REBAL — bulk re-runs placement.
- **Effort weighting (LOAD-V2-01)**: v1.2+.
- **Household capacity settings (LOAD-V2-02)**: v1.2+.
- **Completion feedback loop (LOAD-V2-03)**: v1.2+.
- **Learned-frequency adjustment (LOAD-V2-04)**: v1.2+.
- **Effort-aware horizon viz (LOAD-V2-05)**: v1.2+.

### Claude's Discretion reserved
- Whether `placeNextDue` signature includes `lastCompletion` directly or derives it from `task.updated` — recommend explicit param for purity.
- Return type on `placeNextDue` — `Date` vs `{date, score, scoringTrace}`. Recommend just `Date` for v1.1; scoring trace is Phase 16 debugging territory.
</deferred>

---

*Phase: 12-load-smoothing-engine*
*Context gathered: 2026-04-22 via autonomous smart-discuss (all grey areas locked via STATE.md + audit-addendum-load.md; no user decision required — all LOAD-01..15 requirement semantics are pre-locked)*
