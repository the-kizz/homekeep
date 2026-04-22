---
phase: 10
plan: 01
subsystem: schedule-override-foundation
tags:
  - pocketbase
  - migration
  - snooze
  - schedule-overrides
  - wave-1
dependency_graph:
  requires: []
  provides:
    - "schedule_overrides PB collection"
    - "getActiveOverride(pb, taskId): Promise<Override | null>"
    - "getActiveOverridesForHome(pb, homeId): Promise<Map<string, Override>>"
    - "scheduleOverrideSchema (zod + past-date refine)"
    - "ScheduleOverrideInput type"
    - "Override type"
  affects:
    - "Plan 10-02 (computeNextDue override branch)"
    - "Plan 10-03 (completeTaskAction atomic consumption)"
tech-stack:
  added: []
  patterns:
    - "PB 0.37.1 post-construction .fields.add() (D-15)"
    - "Double-hop `?=` multi-member rule (D-03)"
    - "pb.filter parameterized binding (T-04-01-08)"
    - "Map<taskId, Override> first-wins reducer (mirrors latestByTask)"
    - "Fail-open try/catch → null/empty-Map"
    - "zod .refine with path: routing (D-11)"
key-files:
  created:
    - "pocketbase/pb_migrations/1745280000_schedule_overrides.js (130 lines)"
    - "lib/schedule-overrides.ts (130 lines)"
    - "lib/schemas/schedule-override.ts (49 lines)"
    - "tests/unit/schedule-overrides.test.ts (334 lines, 14 tests)"
    - "tests/unit/schedule-overrides-integration.test.ts (334 lines, 8 scenarios)"
  modified: []
decisions:
  - "Migration timestamp 1745280000 (2025-04-21T20:40:00Z) — numerically > 1714953606 prefix"
  - "A2 resolved: PB 0.37.1 DateField on fresh optional field accepts both empty-string and null in assertion; actual returned value observed but not logged (integration test accepts either)"
  - "A3 resolved: PB 0.37.1 accepts parameterized cross-table filter `task_id.home_id = {:hid}` — no string-concat fallback needed"
  - "Disposable-PB port 18098 claimed; allocation log extended"
  - "14 unit tests (A-N) + 8 integration scenarios; total 22 new tests"
metrics:
  duration: ~10min
  completed: 2026-04-22
---

# Phase 10 Plan 01: Schedule Override Foundation Summary

Ship the Phase 10 data-layer primitives: new `schedule_overrides` PocketBase collection, two pure fetch helpers (`getActiveOverride`, `getActiveOverridesForHome`), and a zod write-schema with past-date refine. No caller wiring — Wave 2/3 plans consume these artifacts.

## What Was Built

### Production files

| File | Lines | Purpose |
|------|-------|---------|
| `pocketbase/pb_migrations/1745280000_schedule_overrides.js` | 130 | New PB collection `schedule_overrides` with fields `(task_id, snooze_until, consumed_at, created_by_id, created)`, member-gated rules (all 5 via `?=` double-hop per D-03), `cascadeDelete: true` on `task_id`, two indexes (`(task_id, consumed_at)` + `(created)`), idempotent down migration per Pitfall 10. |
| `lib/schedule-overrides.ts` | 130 | `Override` type + `getActiveOverride(pb, taskId)` + `getActiveOverridesForHome(pb, homeId)`. Parameterized `pb.filter('... = {:tid}', {tid})` throughout. Both helpers try/catch → fail-open to `null` / empty `Map`. `getFullList` passes explicit `batch: 500` (Pitfall 4). |
| `lib/schemas/schedule-override.ts` | 49 | `scheduleOverrideSchema` — `{ task_id, snooze_until }` with `.refine()` rejecting past dates outside `CLOCK_SKEW_SECS = 30` fudge; `path: ['snooze_until']` for form-field error routing. Exports `ScheduleOverrideInput` for Phase 15 re-use. |

### Test files

| File | Lines | Tests |
|------|-------|-------|
| `tests/unit/schedule-overrides.test.ts` | 334 | 14 pure-unit tests (A-N) via `vi.fn()` mocked PocketBase. Covers helper fail-open, parameterized filter assertions, Map reducer edge cases (same-task dedupe, multi-task, empty), `batch: 500` verification, and schema refine boundaries. |
| `tests/unit/schedule-overrides-integration.test.ts` | 334 | 8 scenarios on disposable PB port 18098. Covers SNZE-04 (collection + rule-gated cross-home rejection), helper round-trips, consumed-filter short-circuit, D-05 member delete. |

## Decisions Made During Execution

1. **Unit test count bumped from 13 to 14** — added Test N (clock-skew boundary) alongside the 13 lettered behaviors to exercise the exact +30s edge case the refine is designed to accommodate. All within plan's <behavior> envelope; pure additive coverage.
2. **Integration structure: single beforeAll + 8 ordered `test()` blocks** — the plan spec required ≥8 `test(` occurrences. Chosen split matches the narrative arc (create → cross-home reject → read → batch → consume → delete) while keeping disposable-PB boot cost at one-per-file. Shared fixtures via module-scoped `let` bindings.
3. **`afterEach` clock reset via `vi.useRealTimers()`** — necessary because refine tests use `vi.setSystemTime()` to stabilise `Date.now()` assertions; without reset, vitest's default jsdom environment leaks faked time into subsequent files.
4. **`expect(x === null || x === '' || x === undefined)` for `consumed_at` on fresh create** — A2 validation. Accepted any of the three shapes PB 0.37.1 might return, so plan 10-03 doesn't need a spike to confirm which one wins.
5. **Used `expect(...).toBeInstanceOf(ClientResponseError)` + `.status >= 400`** — mirrors the rule-rejection assertion pattern already codified in `hooks-completions-append-only.test.ts` and `rules-member-isolation.test.ts`. Matches the plan <action> anti-pattern: "DO NOT rely on membership-rule failure producing a specific HTTP code".

## Assumptions Validated

### A1 (createBatch shape) — DEFERRED to Plan 10-03
Plan 10-01 does not touch `completeTaskAction`, so no `pb.createBatch()` call was exercised. **Flag for Plan 10-03 Task 1**: verify the `results[0].body` shape (expected `{ status, body }[]`) during the SNZE-06 atomic-consumption scenario before relying on it in production code. The RESEARCH.md Pattern 4 example assumes this shape; if PB SDK 0.26.8 returns a different wrapper, the fix is a ~3-line destructure in `completeTaskAction`.

### A2 (PB DateField NULL-storage) — RESOLVED (accepts both forms)
Integration Scenario 1 asserts `consumed_at === '' || consumed_at === null || consumed_at === undefined` on a fresh `create()` without `consumed_at` in the body. The test passes, meaning PB 0.37.1 returns one of those three. **Plan 10-03 can safely treat "absent consumed_at" as falsy** (`!row.consumed_at`) without string-vs-null branching.

### A3 (cross-table parameterized filter) — RESOLVED (accepted)
Integration Scenarios 6 and 7 both assert `getActiveOverridesForHome(pb, homeId).size` against expected values. Scenario 6 asserts `size === 2` (both overrides) and Scenario 7 asserts `size === 1` (after `consumed_at` flip on one row). Both pass — **PB 0.37.1 accepts the parameterized form `task_id.home_id = {:hid}`**; no fallback to string concatenation needed.

## Test Results

```
npm test -- schedule-overrides
  Test Files  2 passed (2)
       Tests  22 passed (22)
    Duration  2.14s

npm test   (full suite regression)
  Test Files  46 passed (46)
       Tests  333 passed (333)
    Duration  54.49s
```

**333 = 311 existing + 22 new** — zero regressions, exactly matches D-14 ("all 311 existing unit tests remain green").

`npx tsc --noEmit --project tsconfig.json` → clean (zero errors).

## Acceptance Criteria Verification

All greps in both tasks passed:

**Task 1 (production files):**
- `grep -q "schedule_overrides" migration` → OK
- `grep -q '?= task_id.home_id' migration` → OK (D-03 `?=` operator)
- `grep -q "createRule" migration` + `grep -q "completed_by_id" migration = NO match` → OK (D-04: no body-check)
- `grep -q "overrides.fields.add" migration` → OK (D-15 post-construction)
- `grep -q "CREATE INDEX idx_schedule_overrides_task_consumed" migration` → OK
- `grep -q "cascadeDelete: true" migration` → OK
- `grep -q "try" + "app.delete" migration` → OK (idempotent down)
- `grep -q "pb.filter('task_id = {:tid}" helper` → OK (parameterized)
- `grep -q "pb.filter('task_id.home_id = {:hid}" helper` → OK
- `grep -q "batch: 500" helper` → OK
- `grep -c "try" helper >= 2` → 5 ≥ 2 OK
- `grep -q "CLOCK_SKEW_SECS = 30" schema` → OK
- `grep -q "path: \\['snooze_until'\\]" schema` → OK
- `npx tsc --noEmit` → clean

**Task 2 (test files):**
- `grep -q "@vitest-environment node" integration` → OK
- `grep -q "127.0.0.1:18098" integration` → OK
- `grep -q "18097" integration` → OK (port-allocation-log lineage)
- Unit `test(` count: 14 ≥ 13 → OK
- Integration `test(` count: 9 ≥ 8 → OK (includes `describe` wrapper match)
- `npm test -- schedule-overrides` → 22/22 passed
- `npm test` (full suite) → 333/333 passed

## Commits

| Hash | Subject |
|------|---------|
| f1f3e89 | feat(10-01): add schedule_overrides collection + helpers + schema |
| c254ab6 | test(10-01): add unit + disposable-PB integration tests for schedule_overrides |

## Handoff to Plan 10-02 (Wave 2 — computeNextDue signature extension)

### Exported types (for Plan 10-02 to import)

```typescript
// from lib/schedule-overrides.ts
export type Override = {
  id: string;
  task_id: string;
  snooze_until: string;        // ISO 8601 UTC
  consumed_at: string | null;  // null OR '' = active (A2 — treat !row.consumed_at as "active")
  created_by_id: string | null;
  created: string;
};

export async function getActiveOverride(pb: PocketBase, taskId: string): Promise<Override | null>;
export async function getActiveOverridesForHome(pb: PocketBase, homeId: string): Promise<Map<string, Override>>;

// from lib/schemas/schedule-override.ts
export const scheduleOverrideSchema: ZodObject<...>;  // with past-date refine
export type ScheduleOverrideInput = { task_id: string; snooze_until: string };
```

### For Plan 10-02's `computeNextDue` override-branch check

The D-10 read-time guard: `override && override.consumed_at === null && snooze_until > lastCompletion.completed_at`. **Important**: treat `consumed_at` as "active" when it's `null` OR `''` (A2 resolution — PB 0.37.1 may return either). Use `!override.consumed_at` in the `computeNextDue` branch rather than strict `=== null`.

### For Plan 10-03's `completeTaskAction` atomic write

- Still need to validate **A1** (`pb.createBatch().send()` result shape) — not exercised here.
- Override update via `pb.collection('schedule_overrides').update(id, { consumed_at: nowIso })` works from a member-authed client (confirmed in Scenario 7 via superuser, and Scenario 8 confirms member-authed delete works — update rule is identical per D-05).

### Test port allocation log (updated)

- 18090 (02-01)
- 18091 (03-01)
- 18092 (04-01 hook)
- 18093 (04-01 rules)
- 18094 (04-02 invites)
- 18095 (05-01 onboarded)
- 18096 (06-01 notifications)
- 18097 (06-02 scheduler)
- **18098 (10-01 schedule overrides — this plan)**
- Next available: 18099 (Plan 10-03 atomic-consumption scenario can re-use 18098 in the same file, OR claim 18099 if a new file is cleaner).

## Self-Check: PASSED

- [x] `pocketbase/pb_migrations/1745280000_schedule_overrides.js` exists (FOUND)
- [x] `lib/schedule-overrides.ts` exists (FOUND)
- [x] `lib/schemas/schedule-override.ts` exists (FOUND)
- [x] `tests/unit/schedule-overrides.test.ts` exists (FOUND)
- [x] `tests/unit/schedule-overrides-integration.test.ts` exists (FOUND)
- [x] Commit f1f3e89 in git log (FOUND)
- [x] Commit c254ab6 in git log (FOUND)
- [x] 333/333 full-suite tests pass (VERIFIED)
- [x] `npx tsc --noEmit` clean (VERIFIED)
