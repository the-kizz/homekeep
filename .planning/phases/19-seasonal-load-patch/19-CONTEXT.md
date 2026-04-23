# Phase 19: Seasonal/LOAD Patch — Context

**Gathered:** 2026-04-23
**Status:** Ready for planning
**Mode:** Autonomous smart-discuss (bugs documented in audit; no grey areas)

<domain>
## Phase Boundary

Fix three interacting bugs surfaced by Phase 16 visual UAT + CI E2E regression. All three MUST land together (fixing any in isolation exposes another, per prior inline-fix attempt documented in audit).

**In scope (3 REQ-IDs):**
- PATCH-01 Normalize PB 0.37.1 NumberField-cleared=0 for seasonal month fields to `null` at data-read boundaries + in `isInActiveWindow`
- PATCH-02 Fresh task + year-round (or current-month-in-window) should NOT trigger seasonal-wakeup branch; fall through to natural cadence
- PATCH-03 `placeNextDue` excludes the target task's own contribution from its input load map

**Out of scope:**
- New migrations (additive fixes only)
- UI changes (pure data-layer + scheduler)
- v1.2 feature work

**Deliverables:**
1. Patched `isInActiveWindow(month, from, to)` — treat `0` / null equivalently.
2. Patched `computeNextDue` seasonal branches — consistent `hasWindow` check across both sites; seasonal-wakeup branch guarded against fresh-task-in-window.
3. Data-read boundary fixes in 3 page.tsx files + rebalance action: `(t.active_from_month as number) ?? null` → replaced with a helper or inline pattern that coerces `0 → null`.
4. `placeNextDue(task, householdLoad, now, opts)` — strip the target task's own contribution from the passed load map before scoring.
5. Updated rebalance integration test Scenario 3 — assertion stays as-is (bit-identical) now that self-counting is fixed.
6. Regression coverage: add the 3 test cases from the prior aborted fix attempt.
</domain>

<decisions>
## Implementation Decisions

### PATCH-01: 0-vs-null NumberField coercion

- **D-01 (helper):** Add small pure helper `normalizeMonth(v: unknown): number | null` in `lib/task-scheduling.ts`:
  ```ts
  export function normalizeMonth(v: unknown): number | null {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 12) return null;
    return v;
  }
  ```
  Treats 0, -1, 13, null, undefined, strings all as `null`. Defense-in-depth.
- **D-02 (isInActiveWindow):** Update to delegate to normalizeMonth:
  ```ts
  const nFrom = normalizeMonth(from);
  const nTo = normalizeMonth(to);
  if (nFrom == null || nTo == null) return true;
  // ... existing wrap logic uses nFrom / nTo
  ```
- **D-03 (hasWindow in computeNextDue):** Both sites (smoothed branch + seasonal branch) use normalizeMonth:
  ```ts
  const fromM = normalizeMonth(task.active_from_month);
  const toM = normalizeMonth(task.active_to_month);
  const hasWindow = fromM != null && toM != null;
  ```
- **D-04 (page.tsx boundaries):** Dashboard / by-area / person / area-detail mapping: use normalizeMonth in the task-map literal instead of `?? null`. Makes the coercion explicit + testable.

### PATCH-02: Year-round fresh-task wake-up

- **D-05 (guard in wake-up branch):** The seasonal-wakeup branch fires when `lastInPriorSeason` is true. Add clause: don't fire if `inWindowNow && !lastCompletion` (fresh task whose current month is already in-window — it's already "awake", no wake-up date to render).
  ```ts
  if (lastInPriorSeason && !(inWindowNow && !lastCompletion)) {
    return nextWindowOpenDate(...);
  }
  ```
- **D-06 (existing test compat):** Test "Case B — wake-up from in-window month" (Nov in Oct-Mar window, null completion) expects `2027-10-01`. Under PATCH-02 logic: Nov is in-window AND lastCompletion is null → guard triggers → falls through to natural. This test's semantic was already "wake-up fires for fresh in-window tasks" — semantically broken per PATCH-02. Test must be updated: a fresh seasonal task whose current month is in-window should return natural cadence (task.created + freq), not a wake-up date. The tests that relied on old broken behavior get updated expectations.

### PATCH-03: placeNextDue self-counting

- **D-07 (minus-self approach):** Inside `placeNextDue`, before scoring candidates, clone `householdLoad` and decrement or remove the target task's existing contribution:
  ```ts
  const load = new Map(householdLoad);
  // If the task already has a smoothed/effective date, its own contribution
  // must NOT influence its re-placement. Subtract at its current position.
  const currentEffective = computeNextDue(task, lastCompletion, now, undefined, opts.timezone);
  if (currentEffective) {
    const k = isoDateKey(currentEffective, opts.timezone);
    const prev = load.get(k) ?? 0;
    if (prev > 0) load.set(k, prev - 1);
  }
  // ... score against `load` instead of `householdLoad`
  ```
- **D-08 (idempotency proof):** With self-counting fixed, consecutive rebalance runs on a stable set produce bit-identical placements — the rebalance-integration Scenario 3 test stays as-is and finally passes.

### Test updates

- **D-09 (add failing → green regression tests):**
  - `task-scheduling.test.ts`: 3 new tests — (a) active_from=0, active_to=0 → natural cadence; (b) active_from=1, active_to=12 fresh task → natural cadence; (c) active_from=1, active_to=12 with completion → natural cycle.
  - Seasonal integration test "Case B" — update expectation: fresh+in-window = natural (task.created + freq), not wake-up date.
  - Existing 598 unit + all integration tests stay green.

### Test scope

- **D-10 (~8 tests, mostly in-file edits):** 3 new unit tests for PATCH-01; 1 new unit for PATCH-02 (fresh+in-window); 1 for normalizeMonth helper; adjustments to Case B existing test. ~5-10 min execution.

### Port + migration

- **D-11 (no new port, no migration):** Pure app-layer fix. Existing test ports 18090..18105 unchanged.

### Claude's Discretion
- Whether normalizeMonth lives in task-scheduling.ts (scope creep) vs new `lib/seasonal-utils.ts` — recommend task-scheduling.ts for minimal surface.
- Whether to also normalize at PB fetch time (add `?fields=` projection filter that strips 0s) — recommend NO, app-layer coercion is sufficient + less brittle.
</decisions>

<canonical_refs>
- `.planning/v1.1-MILESTONE-AUDIT.md` §tech_debt — bug documentation
- `.planning/phases/14-seasonal-ui-seed-library/16-VERIFICATION.md` — Phase 16 UAT findings
- `.planning/phases/14-seasonal-ui-seed-library/14-CONTEXT.md` — seasonal semantics
- `lib/task-scheduling.ts` — isInActiveWindow + computeNextDue
- `lib/load-smoothing.ts` — placeNextDue + computeHouseholdLoad
- `lib/rebalance.ts` + `lib/actions/rebalance.ts` — integration point for self-counting
- `app/(app)/h/[homeId]/page.tsx` + by-area + person — data-read boundaries
- `tests/unit/rebalance-integration.test.ts` — Scenario 3 idempotency test (currently red)
- `tests/unit/task-extensions-integration.test.ts` — Case B (expectation needs update per D-06)
</canonical_refs>

<code_context>
### Historical context (audit details)

Prior inline-fix attempt revealed:
- Fixing PATCH-01 alone → rebalance idempotency test flips red (PATCH-03 was latent)
- Fixing PATCH-02 alone → Phase 11 "Case B" test flips red (semantic change)
- Fixing all three together → all tests green

### Integration points
- `isInActiveWindow` called from: computeNextDue (seasonal branches), Anchored warning in task-form, classifyDormantTasks helper
- `normalizeMonth` called from: page.tsx mappings (3 files), isInActiveWindow, hasWindow in computeNextDue
- `placeNextDue` called from: completeTaskAction, createTaskAction, batchCreateSeedTasks, rebalanceApplyAction — ALL need the self-exclusion to still work correctly. For create paths (no pre-existing smoothed), the subtraction is a no-op.
</code_context>

<specifics>
### Threats
- **T-19-01** — breaking v1.0 semantics. Mitigated: all v1.0 tasks have null active_from/to (never cleared to 0 in v1.0). No v1.0 test should touch the new guards.
- **T-19-02** — test expectations shifting under PATCH-02. Mitigated: explicit test updates in D-06; audit trail in PATCH-02 rationale.
- **T-19-03** — placeNextDue subtraction under-counts when called fresh (no existing smoothed). Mitigated: only subtracts when `load.get(k) > 0`; no-op for fresh tasks.
</specifics>

<deferred>
- Deeper load-map refactor (compute load excluding target task as first-class concept) — deferred to v1.2 if needed
- Schema-level validation that rejects 0 for NumberFields (PB hook) — brittle, app-layer coercion suffices
</deferred>

---

*Phase: 19-seasonal-load-patch*
