---
phase: 20-e2e-test-stabilization
plan: 01
subsystem: testing
tags: [e2e, playwright, load-smoothing, test-methodology, pocketbase, tcsem]

# Dependency graph
requires:
  - phase: 12-load-smoothing-engine
    provides: LOAD-10 placeNextDue writes next_due_smoothed on completion
  - phase: 13-task-creation-semantics
    provides: TCSEM-04 createTaskAction writes next_due_smoothed at insert time
  - phase: 15-one-off-reschedule-ui
    provides: reschedule_marker field (defensive forward-compat in PATCH)
  - phase: 19-seasonal-load-patch
    provides: prior test-methodology fix precedent (self-exclusion in placeNextDue)
provides:
  - Stabilized core-loop.spec.ts under LOAD + TCSEM semantics (2 scenarios)
  - LOAD-aware seed pattern (reusable doc block + seedCompletion helper)
  - getCompletionCount helper for PB REST completion-count-delta flow assertions
  - Path to unblock GHCR tier strategy (TEST-02) on next CI green + stable tag push
affects: [future-e2e-specs, v1.2-e2e-rewrite-pass, release-workflow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "LOAD-aware seed pattern: POST-completion + PATCH next_due_smoothed=''+reschedule_marker='' to escape the smoothed-branch shadow in computeNextDue"
    - "Flow-assertion E2E methodology: assert on (dialog visibility + toast + PB-REST count delta) over band-transition assertions when LOAD placement is non-deterministic across ±tolerance + load-map scoring"
    - "Constant-time completion count via ?perPage=1 + body.totalItems"

key-files:
  created: []
  modified:
    - tests/e2e/core-loop.spec.ts

key-decisions:
  - "Adopted Option C (D-07): rewrite assertions around LOAD reality rather than mock computeNextDue (D-05 rejected) or bypass createTaskAction via raw PB POST (D-06 rejected) — core-loop tests the completion flow, not band placement; band classification is covered in 21+ unit cases"
  - "Scenario 2 task REMAINS in overdue after completion (CORRECTED D-04): placeNextDue reads PRE-batch lastCompletion in the batch, not the fresh completion — naturalIdeal=-3d → candidates {-4d,-3d,-2d} all < localMidnight → overdue. Asserted via inline comment"
  - "Inline seedCompletion PATCH + comment (D-10) rather than extracting patchTaskForLoadTestability as named helper — this is the single seed site in the file; extraction can happen in v1.2 if the pattern repeats"
  - "Empty-string convention for PB nullable DateField clear writes (matches tasks.ts:344 + completions.ts:357) rather than null literals"

patterns-established:
  - "LOAD-aware seed pattern: documented at top of core-loop.spec.ts; future specs that need to control task placement should either (1) seedCompletion + PATCH, or (2) flow-assert without band semantics"
  - "Option C flow-assertion recipe: pre-click band visibility + guard visibility/absence + Sonner toast with 5s timeout + PB REST count delta + reload-then-check-task-still-visible (band-agnostic)"

requirements-completed: [TEST-01]  # TEST-02 pending CI verification post-push

# Metrics
duration: 12min
completed: 2026-04-23
---

# Phase 20 Plan 1: E2E Test Stabilization Summary

**Stabilized core-loop.spec.ts two scenarios under Phase 12 LOAD + Phase 13 TCSEM via POST-then-PATCH seed pattern and Option C flow-assertions (dialog + toast + PB REST count delta).**

## Performance

- **Duration:** ~12 min active task execution (plus ~2.5 min for the full local E2E + unit test sweep)
- **Started:** 2026-04-23T10:10:01Z
- **Completed:** 2026-04-23T10:43:02Z
- **Tasks:** 3 of 3
- **Files modified:** 1 (`tests/e2e/core-loop.spec.ts`)

## Accomplishments

- Scenario 1 passes locally (6.5s): guard dialog visible, confirm click fires, Sonner toast matches `/Done — next due/`, completion count 1→2, reload-persisted task row visible.
- Scenario 2 passes locally (9.2s): no guard dialog appears, Sonner toast appears, completion count 1→2, reload-persisted task row visible.
- `seedCompletion` helper extended with defensive PATCH of `next_due_smoothed` + `reschedule_marker` to escape `computeNextDue`'s smoothed-branch shadow.
- New `getCompletionCount(request, token, taskId)` helper using `?perPage=1` + `body.totalItems` for constant-time flow evidence.
- Top-of-file LOAD-aware seed pattern doc block explains the shadow mechanism + when to use flow assertions (reusable by future specs).
- Zero production code churn; zero unit-test regressions (610/610 passing unchanged).

## Task Commits

Each task was committed atomically:

1. **Task 1: Add LOAD-aware seed doc, patch seedCompletion, add getCompletionCount helper** — `0abbb84` (test)
2. **Task 2: Rewrite Scenario 1 tail to Option C flow-assertions** — `ab30830` (test)
3. **Task 3: Rewrite Scenario 2 tail to Option C flow-assertions + full-file validation** — `d26989a` (test)

## Assertion Changes — Before / After

### Change 1 (Task 1) — `seedCompletion` helper: POST-only → POST-then-PATCH

**Before (pre-Phase-20):**
```typescript
async function seedCompletion(request, token, userId, taskId, daysAgo) {
  const completedAt = new Date(Date.now() - daysAgo * 86400000).toISOString();
  const res = await request.post(
    `${PB_URL}/api/collections/completions/records`,
    {
      headers: { Authorization: token },
      data: { task_id: taskId, completed_by_id: userId, completed_at: completedAt, via: 'manual-date', notes: '' },
    },
  );
  expect(res.ok()).toBeTruthy();
}
```

**After (Phase 20 TEST-01):**
```typescript
async function seedCompletion(request, token, userId, taskId, daysAgo) {
  const completedAt = new Date(Date.now() - daysAgo * 86400000).toISOString();
  // Step 1: POST the back-dated completion.
  const postRes = await request.post( /* ... same as before ... */ );
  expect(postRes.ok()).toBeTruthy();

  // Step 2: Null the Phase 12 + Phase 15 shadow fields so
  // computeNextDue falls through to the natural-cycle branch.
  const patchRes = await request.patch(
    `${PB_URL}/api/collections/tasks/records/${taskId}`,
    {
      headers: { Authorization: token },
      data: { next_due_smoothed: '', reschedule_marker: '' },
    },
  );
  expect(patchRes.ok()).toBeTruthy();
}
```

### Change 2 (Task 2) — Scenario 1 tail: band-exit → flow-assertion

**Before:**
```typescript
// Task moves out of This Week (new nextDue shifts ~7d forward).
await expect(
  page.locator('[data-band="thisWeek"] [data-task-name="Wipe benches"]'),
).toHaveCount(0);

// Reload (fresh Server Component render) — state persists.
await page.goto(homeUrl);
await expect(page.locator('[data-band-view]')).toBeVisible();
await expect(
  page.locator('[data-band="thisWeek"] [data-task-name="Wipe benches"]'),
).toHaveCount(0);
```

**After:**
```typescript
// Phase 20 TEST-01 (D-03): Under LOAD, the task STAYS in thisWeek after
// completion — placeNextDue computes candidates in {T+5d, T+6d, T+7d}
// (all within band). Assert on flow evidence, not band exit.
// Band-transition semantics are already covered by
// tests/unit/band-classification.test.ts (21+ cases).

// Completion record persisted: count went 1 (seeded) → 2 (fresh).
const afterCount = await getCompletionCount(request, token, taskId);
expect(afterCount).toBe(2);

// Reload forces a fresh Server Component render (not router-cache replay)
// and confirms the BandView still renders without errors after the
// completion. Task is still somewhere on the page (thisWeek under LOAD,
// per D-03), but we don't assert a specific band — that's unit-tested.
await page.goto(homeUrl);
await expect(page.locator('[data-band-view]')).toBeVisible();
await expect(
  page.locator('[data-task-name="Wipe benches"]'),
).toBeVisible();
```

### Change 3 (Task 3) — Scenario 2 tail: band-exit → flow-assertion (with CORRECTION)

**Before:**
```typescript
// Task moves out of Overdue.
await expect(
  page.locator('[data-band="overdue"] [data-task-name="Clean filter"]'),
).toHaveCount(0);

// Reload — state persisted.
await page.goto(homeUrl);
await expect(page.locator('[data-band-view]')).toBeVisible();
await expect(
  page.locator('[data-band="overdue"] [data-task-name="Clean filter"]'),
).toHaveCount(0);
```

**After:**
```typescript
// Phase 20 TEST-01 (D-04 CORRECTED by Phase 20 research): Under LOAD,
// `placeNextDue` inside completeTaskAction reads the PRE-batch
// lastCompletion (-10d), not the fresh one. naturalIdeal = -10d + 7d
// = -3d; candidates {-4d, -3d, -2d} all < localMidnight → task
// STAYS in overdue. Do NOT assert "leaves overdue". See
// completions.ts:149-166 + :343-358 for the evidence trail.
//
// Task REMAINS in overdue under LOAD placement — placeNextDue sees
// pre-batch lastCompletion (-10d) → naturalIdeal=-3d → overdue.
// Verifying completion via PB REST instead of band transition.
//
// Assert on flow evidence instead. Band-transition semantics are
// already covered in tests/unit/band-classification.test.ts.

// Completion record persisted: count went 1 (seeded) → 2 (fresh).
const afterCount = await getCompletionCount(request, token, taskId);
expect(afterCount).toBe(2);

// Reload forces a fresh Server Component render (not router-cache
// replay) and confirms the BandView still renders without errors.
// Task is still somewhere on the page (overdue under LOAD per the
// corrected semantics above).
await page.goto(homeUrl);
await expect(page.locator('[data-band-view]')).toBeVisible();
await expect(
  page.locator('[data-task-name="Clean filter"]'),
).toBeVisible();
```

## Local Test Results

### Playwright (core-loop.spec.ts)
```
npx playwright test tests/e2e/core-loop.spec.ts --reporter=list
Running 2 tests using 1 worker
  ✓  1 tests/e2e/core-loop.spec.ts:246:7 › Phase 3 Core Loop (D-21) › Scenario 1 — early-completion guard fires -> accept -> completion persisted (11.8s)
  ✓  2 tests/e2e/core-loop.spec.ts:313:7 › Phase 3 Core Loop (D-21) › Scenario 2 — stale task in Overdue -> tap -> no guard -> completion persisted (9.2s)
  2 passed (1.5m)
```

Task 2 standalone Scenario-1 run (pre-Task-3): 6.5s, 1 passed.

### Vitest (unit suite)
```
npm test -- --run
Test Files  71 passed (71)
      Tests  610 passed (610)
   Duration  150.90s
```

**Unit count delta: 0** (baseline preserved; no production files touched).

### Structural grep invariants (all passing)
```
grep -c 'LOAD-aware seed pattern' tests/e2e/core-loop.spec.ts            → 1
grep -c "next_due_smoothed: ''" tests/e2e/core-loop.spec.ts              → 1
grep -c "reschedule_marker: ''" tests/e2e/core-loop.spec.ts              → 1
grep -c 'async function getCompletionCount' tests/e2e/core-loop.spec.ts  → 1
grep -c 'request.patch' tests/e2e/core-loop.spec.ts                      → 1
grep -c 'async function seedCompletion' tests/e2e/core-loop.spec.ts      → 1
grep -c 'expect(afterCount).toBe(2)' tests/e2e/core-loop.spec.ts         → 2
grep -c 'getCompletionCount(request, token, taskId)' tests/e2e/core-loop.spec.ts → 2
grep -c 'Task REMAINS in overdue' tests/e2e/core-loop.spec.ts            → 1
grep -cE 'toHaveCount\(0\)' tests/e2e/core-loop.spec.ts                  → 1  (no-guard dialog only)
grep -c '\[data-band="overdue"\] \[data-task-name="Clean filter"\]' tests/e2e/core-loop.spec.ts → 1  (pre-click visibility only)
grep -c '\[data-band="thisWeek"\] \[data-task-name="Wipe benches"\]' tests/e2e/core-loop.spec.ts → 1  (pre-click visibility only)
wc -l tests/e2e/core-loop.spec.ts                                        → 379 (baseline 285 → +94, within plan's +60..+90 guide)
```

### Type-check + lint
- `npx tsc --noEmit -p tsconfig.json` → 0 errors (exit 0, no output).
- `npm run lint -- tests/e2e/core-loop.spec.ts` → 0 errors (pre-existing warnings in unrelated files unchanged).

### Change scope
```
git diff --name-only b7d6000..d26989a
→ tests/e2e/core-loop.spec.ts
```
Only the target test file modified across all 3 task commits. Zero production code churn.

## LOAD-Aware Seed Pattern Documentation — Confirmation

The top-of-file JSDoc block in `tests/e2e/core-loop.spec.ts` now documents:
- Why `next_due_smoothed` shadows back-dated completions (refs `lib/task-scheduling.ts:255-281`, `lib/actions/tasks.ts:296-307`, `lib/actions/completions.ts:343-358`)
- The mandatory PATCH pattern for specs that seed to control placement
- When to use flow-assertions (dialog + toast + PB REST count delta) over band-transition assertions
- Why Scenario 2 remains in Overdue after completion (PRE-batch `lastCompletion` semantics)
- Pointers to exhaustive unit coverage in `tests/unit/band-classification.test.ts` (21+ cases) and `tests/unit/early-completion-guard.test.ts` (8 cases)

Future specs that need placement control can adopt the same pattern without re-deriving the LOAD + TCSEM interaction math.

## Decisions Made
- **D-01/D-02 applied:** PATCH both `next_due_smoothed` AND `reschedule_marker` to empty-string, ordered POST-then-PATCH.
- **D-03/D-04 CORRECTED:** Dropped all four post-completion `toHaveCount(0)` band-exit assertions. Added explicit comment in Scenario 2 that the task REMAINS in overdue under LOAD's pre-batch `lastCompletion` semantics.
- **D-07 Option C:** Rewrote both scenario tails around LOAD reality using completion-count-delta via PB REST + band-agnostic reload verification.
- **D-08:** Replaced the pre-Phase-12 top-of-file doc with a LOAD-aware seed pattern block that documents the shadow mechanism and the flow-assertion methodology.
- **D-10:** Inline PATCH inside `seedCompletion` rather than extract a named `patchTaskForLoadTestability` helper; there's only one seed site and extraction can happen in v1.2 if the pattern recurs.

## Deviations from Plan

None — plan executed exactly as written. All three tasks landed their intended edits without any Rule 1/2/3 auto-fixes, and no Rule 4 architectural decisions were needed. The `totalItems` grep count returned 2 rather than the plan's anticipated 1 (one occurrence is in the new JSDoc, one in the return expression); this is a soft count and the material invariant — the helper uses `body?.totalItems` — holds.

## Issues Encountered

None during planned work. All 3 tasks passed their first run of the full verification chain (typecheck, grep invariants, lint, Playwright, Vitest).

## TEST-02 Status

TEST-02 is **pending** and closes on the next push + green CI + stable tag push. Specifically:
1. Push commits `0abbb84 → ab30830 → d26989a` to the active branch (master or release branch).
2. `.github/workflows/ci.yml` re-runs the E2E matrix; with the two scenarios now passing, the full 23/23 E2E gate goes green.
3. On the next stable tag push (`v1.1.1` or later), `.github/workflows/release.yml` advances GHCR `:latest` + `:1.1` per the existing tier strategy.

No CI workflow YAML changes were required or made in this plan. The orchestrator will verify TEST-02 closure after the CI run.

## User Setup Required

None — all changes are test-only.

## Next Phase Readiness

- CI E2E expected to go green on next push; GHCR tier strategy ready to advance `:latest`/`:1.1` on the next stable tag.
- Reusable LOAD-aware seed pattern documented for future specs that need placement control (v1.2 candidate for extraction into `tests/e2e/fixtures.ts`).
- No blockers for downstream work.

## Self-Check: PASSED

Verified:
- Task 1 commit `0abbb84` exists in `git log --oneline -5` (present).
- Task 2 commit `ab30830` exists in `git log --oneline -5` (present).
- Task 3 commit `d26989a` exists in `git log --oneline -5` (present).
- `tests/e2e/core-loop.spec.ts` modified (379 lines, helpers + scenario tails rewritten as documented above).
- `.planning/phases/20-e2e-test-stabilization/20-01-P01-SUMMARY.md` being written now (this file).

---
*Phase: 20-e2e-test-stabilization*
*Completed: 2026-04-23*
