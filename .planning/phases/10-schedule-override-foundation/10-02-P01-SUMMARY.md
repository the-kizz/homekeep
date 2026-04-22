---
phase: 10
plan: 02
subsystem: schedule-override-foundation
tags:
  - snooze
  - compute-next-due
  - signature-extension
  - coverage
  - band-classification
  - scheduler
  - wave-2
dependency_graph:
  requires:
    - "Override type (Plan 10-01)"
    - "getActiveOverridesForHome (Plan 10-01)"
  provides:
    - "computeNextDue(task, last, now, override?) — extended signature with D-06 override branch"
    - "computeCoverage(tasks, latestByTask, overridesByTask, now)"
    - "computeTaskBands(tasks, latestByTask, overridesByTask, now, timezone)"
    - "computeWeeklySummary(completions, tasks, areas, overridesByTask, now, timezone)"
    - "computeAreaCoverage / computeAreaCounts — override Map forwarded"
    - "detectAreaCelebration(tasks, before, after, overridesByTask, now)"
    - "Scheduler processOverdueNotifications + processWeeklySummaries batch-fetch overrides"
    - "BandView / PersonTaskList accept overridesByTask Record prop; Map reconstructed inline"
  affects:
    - "Plan 10-03 (completeTaskAction atomic consumption)"
    - "Phase 12 LOAD — will insert smoothed branch between override and natural (D-07)"
tech-stack:
  added: []
  patterns:
    - "RSC boundary serialization: Object.fromEntries / new Map(Object.entries(...))"
    - "Batch-fetch overrides before per-home loop (Pitfall performance, N+1 defeat)"
    - "D-10 read-time filter: !override.consumed_at + snooze > lastCompletion"
    - "Optional param with ?. — callers can omit for byte-identical v1.0 behavior"
    - "Falsy-check guard (!override.consumed_at) covers A2 edge (null / '' / undefined)"
key-files:
  created: []
  modified:
    - "lib/task-scheduling.ts (+72 lines; override branch + JSDoc)"
    - "lib/coverage.ts (+17 lines; overridesByTask 3rd arg)"
    - "lib/band-classification.ts (+15 lines; overridesByTask 3rd arg)"
    - "lib/weekly-summary.ts (+19 lines; overridesByTask 4th arg)"
    - "lib/area-coverage.ts (+21 lines; wrapper forwards Map)"
    - "lib/scheduler.ts (+19 lines; getActiveOverridesForHome in both tick paths)"
    - "lib/area-celebration.ts (+28 lines; Rule 3 blocking fix — override 4th arg)"
    - "lib/actions/completions.ts (+14 lines; passes empty Map, Plan 10-03 will swap in)"
    - "components/band-view.tsx (+26 lines; Record prop + Map reconstruction)"
    - "components/person-task-list.tsx (+19 lines; same pattern)"
    - "components/task-list.tsx (+6 lines; passes undefined — Phase 2 surface)"
    - "app/(app)/h/[homeId]/page.tsx (+9 lines; fetch + serialize + prop)"
    - "app/(app)/h/[homeId]/by-area/page.tsx (+21 lines; fetch + inline Map usage)"
    - "app/(app)/h/[homeId]/person/page.tsx (+8 lines; fetch + serialize + prop)"
    - "tests/unit/task-scheduling.test.ts (+210 lines; 9 new override tests)"
    - "tests/unit/coverage.test.ts (+113 lines; 3 new SNZE-09 tests)"
    - "tests/unit/band-classification.test.ts (+124 lines; 3 new SNZE-09 band tests)"
    - "tests/unit/weekly-summary.test.ts (+82 lines; 1 new W-OV-1 test)"
    - "tests/unit/area-coverage.test.ts (+97 lines; 2 new A-OV-1/2 tests)"
    - "tests/unit/area-celebration.test.ts (+64 lines; 1 new P-OV-1 test)"
    - "tests/unit/scheduler.test.ts (+85 lines; 1 new Scenario E SNZE-10 test)"
decisions:
  - "Falsy-check (!override.consumed_at) used instead of strict === null per Wave 1 A2 handoff; PB 0.37.1 returns null/''/undefined for fresh DateField"
  - "Rule 3 blocking fix: detectAreaCelebration needed override param — added and passes empty Map from completeTaskAction (Plan 10-03 will inject real Map post atomic consumption)"
  - "overridesByTask inserted AFTER latestByTask/completions, BEFORE now/timezone in every helper signature (family convention)"
  - "TaskList (Phase 2 area-detail) passes undefined — out-of-scope for this plan's UI surfaces"
  - "Scheduler reuses port 18097 for SNZE-10 scenario E (reuse disposable PB — no new port allocation)"
  - "RSC serialization: Object.fromEntries on server, new Map(Object.entries(...)) inline in client — empty Record default preserves v1.0 behavior"
metrics:
  duration: ~19min
  completed: 2026-04-22
---

# Phase 10 Plan 02: Signature Threading — computeNextDue Override Branch + Helpers + Call Sites

Threading `override?: Override` and `overridesByTask: Map<string, Override>` through the entire compute pipeline from the pure `computeNextDue` function through five helpers, three pages, and two client components. Every v1.0 call site continues to work unchanged — 333 pre-existing tests stay green (D-14 regression gate), and 20 new behavioral tests cover SNZE-05 / SNZE-09 / SNZE-10.

## What Was Built

### Core signature extension (Task 1)

`lib/task-scheduling.ts` — `computeNextDue` gains an optional `override?: Override` 4th parameter. When present AND `!override.consumed_at` AND `snooze_until > lastCompletion.completed_at` (D-10 read-time filter), returns `new Date(override.snooze_until)`. Otherwise falls through to the existing cycle/anchored branches — byte-identical to v1.0. JSDoc updated with branch-order precedence (archived → frequency-validate → **override** → Phase 12 LOAD → cycle → anchored).

### Helper thread-through (Task 2)

Five helpers accept `overridesByTask: Map<string, Override>`:

| Helper | Signature position | Where used |
|---|---|---|
| `computeCoverage` | 3rd arg (before `now`) | Per-task loop → `.get(task.id)` |
| `computeTaskBands` | 3rd arg (before `now, timezone`) | Per-task loop → `.get(task.id)` |
| `computeWeeklySummary` | 4th arg (after `areas`, before `now`) | Forwards into `computeCoverage` AND per-task neglected loop |
| `computeAreaCoverage` | 3rd arg (thin wrapper) | Forwards to `computeCoverage` |
| `computeAreaCounts` | 3rd arg (thin wrapper) | Forwards to `computeTaskBands` |

Rule 3 deviation (blocking): `detectAreaCelebration` (lib/area-celebration.ts) also needed the override Map because it calls `computeAreaCoverage` internally. Signature extended; call site in `completeTaskAction` passes `new Map()` for now — Plan 10-03 will inject the fetched Map after atomic consumption.

### Call-site wiring (Task 3)

- **lib/scheduler.ts** — `processOverdueNotifications` adds `const overridesByTask = await getActiveOverridesForHome(pb, homeId)` after `latestByTask` derivation; each `computeNextDue` call forwards `overridesByTask.get(task.id)`. `processWeeklySummaries` does the same before its `computeWeeklySummary` call.
- **app/(app)/h/[homeId]/page.tsx** — fetches overrides once, serializes via `Object.fromEntries`, passes as `overridesByTask` prop to BandView.
- **app/(app)/h/[homeId]/by-area/page.tsx** — fetches overrides once, uses the Map directly in the `areas.map(...)` loop (no RSC boundary — AreaCard receives pre-computed numbers).
- **app/(app)/h/[homeId]/person/page.tsx** — fetches overrides, serializes, passes to PersonTaskList.
- **components/band-view.tsx** — accepts `overridesByTask?: Record<string, Override>`, reconstructs Map via `new Map(Object.entries(overridesByTask ?? {}))`, threads into `computeTaskBands` + `computeCoverage`.
- **components/person-task-list.tsx** — same pattern as BandView.
- **components/task-list.tsx** — passes `undefined` as 4th arg to `computeNextDue` (Phase 2 area-detail; out of snooze UI scope).

### Exact insertion points in `lib/task-scheduling.ts`

- Import added line 4: `import type { Override } from '@/lib/schedule-overrides';`
- Override branch: lines 121–130 — after archived short-circuit (line 95) AND frequency-validation throw (lines 97–102), BEFORE cycle branch (line 132). This is the D-07-locked position; Phase 12 will insert the `next_due_smoothed` LOAD branch between this override branch and the cycle branch.

## Decisions Made During Execution

1. **Falsy check `!override.consumed_at`, NOT strict `=== null`.** Wave 1 (Plan 10-01) resolved A2: PB 0.37.1 can return `null`, `''`, or `undefined` for a fresh DateField. Test O9 explicitly exercises the empty-string path. The plan instructions in `<action>` suggested `override.consumed_at === null`, but the Wave 1 handoff + prompt-level instructions clearly required the falsy form — I followed the prompt + Wave 1 handoff.

2. **Rule 3 blocking fix — `detectAreaCelebration` needed the override Map.** The plan's caller inventory named 5 production + 3 pages + 3 components, but `lib/area-celebration.ts` calls `computeAreaCoverage` internally and broke under the new Map-requiring signature. Fixed inline by adding `overridesByTask` as the 4th parameter and passing an empty Map from `completeTaskAction` (Plan 10-03 will inject the real Map during atomic consumption). Test file `area-celebration.test.ts` gained a P-OV-1 test covering cross-task override effect on the celebration predicate.

3. **TypeScript inference was clean throughout.** No Override union edge cases surfaced — the optional `override?: Override` parameter compiles cleanly with both `undefined` and a constructed Override literal. Tests exercise both forms explicitly (O8 asserts equivalence).

4. **RSC serialization pattern: `Object.fromEntries` → Record, `new Map(Object.entries(...))` in client.** Applied identically in `/h/[homeId]/page.tsx` → BandView and `/h/[homeId]/person/page.tsx` → PersonTaskList. The by-area page uses the Map directly (no RSC hop — pre-computes coverage numbers server-side and passes primitives to AreaCard).

5. **Scheduler port reuse — 18097.** The plan permitted either reusing 18097 (this file's existing port) or claiming 18098 (Plan 10-01's claimed port). Chose reuse to avoid port-log churn; the test is a new `test()` block within the existing `describe.sequential` so PB serve lifecycle is shared cleanly.

6. **`computeWeeklySummary` argument order.** The actual v1.0 signature was `(completions, tasks, areas, now, timezone)` (completions FIRST, not tasks). The plan text said "between `completions` and `weekStartIso`" but the function never had `weekStartIso` — the scheduler builds that separately. Inserted `overridesByTask` after `areas`, before `now` to match the family convention. Updated call site in `lib/scheduler.ts:318`.

## Test Results

```
npm test   (full suite)
  Test Files  46 passed (46)
       Tests  353 passed (353)
    Duration  55.75s

npm run build   (Next.js production build)
  Build succeeded, 22 routes compiled.

npx tsc --noEmit
  Clean (zero errors).
```

**353 = 333 baseline + 20 new behavioral tests.**

### New tests by file

| File | Prior | Added | New | Requirement |
|------|------:|------:|----:|-------------|
| `tests/unit/task-scheduling.test.ts` | 14 | 9 (O1-O9) | 23 | SNZE-05 (D-06 + D-10) |
| `tests/unit/coverage.test.ts` | 10 | 3 (C-OV-1/2/3) | 13 | SNZE-09 |
| `tests/unit/band-classification.test.ts` | 12 | 3 (B-OV-1/2/3) | 15 | SNZE-09 band movement |
| `tests/unit/weekly-summary.test.ts` | 9 | 1 (W-OV-1) | 10 | SNZE-09 weekly coverage |
| `tests/unit/area-coverage.test.ts` | 10 | 2 (A-OV-1/2) | 12 | SNZE-09 area helpers |
| `tests/unit/area-celebration.test.ts` | 8 | 1 (P-OV-1) | 9 | Override passthrough |
| `tests/unit/scheduler.test.ts` | 4 | 1 (Scenario E) | 5 | **SNZE-10** |
| **Total** | **67** | **20** | **87** | |

Other files: 266 pre-existing tests remain untouched (includes integration tests from Plan 10-01, all Phase 2–9 tests). 333 + 20 = 353 reconciles.

### SNZE requirements verified

- **SNZE-05** (`computeNextDue` override branch, D-06 + D-10): Tests O1-O9 in `task-scheduling.test.ts` cover override precedence, consumed rejection, D-10 stale filter, null lastCompletion, archived short-circuit, anchored compatibility, undefined-arg parity, and A2 empty-string coverage. 
- **SNZE-09** (snoozed task contributes 1.0 health + moves out of overdue band): Tests C-OV-1 (coverage 1.0), B-OV-1/2 (band movement thisWeek/horizon), A-OV-1/2 (area wrappers forward Map), W-OV-1 (weekly summary coverage + neglected). 
- **SNZE-10** (scheduler ref_cycle keys on override.snooze_until free-by-construction): Scheduler Scenario E asserts `ref_cycle.includes(overrideSnoozeIso)` AND `!ref_cycle.includes(naturalNextDueIso)`. Verified against disposable PB on port 18097. 

## TypeScript Inference Edge Cases

None encountered. The `Override | undefined` union from `Map.get(task.id)` flows cleanly through `computeNextDue`'s optional 4th parameter. A couple of spots to note:

1. In `tests/unit/task-scheduling.test.ts` Test O9, asserting `''` on `consumed_at` required a type-cast (`'' as unknown as string | null`) because the Override type declares `consumed_at: string | null`. The cast documents that the field can actually receive empty-string from PB — it isn't asserting the type is wrong. Plan 10-03 may tighten this by normalizing at the helper boundary.

2. The `overridesByTask?` optional prop in BandView/PersonTaskList defaults to `{}` via nullish coalescing (`overridesByTask ?? {}`). No type error because `Record<string, Override>` is structurally compatible with `{}`.

## Serialization Approach for the RSC Boundary

**Decision: Object.fromEntries at server, new Map(Object.entries) inline at client.**

Server (page.tsx):
```typescript
const overridesMap = await getActiveOverridesForHome(pb, homeId);
const overridesByTask = Object.fromEntries(overridesMap);
// ... <BandView overridesByTask={overridesByTask} />
```

Client (band-view.tsx top-of-render):
```typescript
const overridesMap = new Map<string, Override>(
  Object.entries(overridesByTask ?? {}),
);
```

Reconstruction is O(n) over active-override count, which in realistic households is 0–5; total cost is negligible next to React's render tree. Doing it inline (not in a `useMemo`) is intentional — React Compiler handles memoization; and because the map is rebuilt from a stable Record reference, it's referentially stable enough for downstream `.get(id)` calls.

Empty-Record default (`overridesByTask ?? {}`) preserves the v1.0 default-behavior contract: callers that haven't been migrated still render correctly with no overrides applied.

## Deviations from Plan

### [Rule 3 - Blocking] `detectAreaCelebration` needed the override Map
- **Found during:** Task 2 — typecheck failed at `lib/area-celebration.ts:37-38` after extending `computeAreaCoverage`.
- **Issue:** `detectAreaCelebration` wasn't in the plan's file list but it calls `computeAreaCoverage` internally. Its own signature didn't expose a Map, so the extended signature made this file fail to compile.
- **Fix:** Added `overridesByTask: Map<string, Override>` as the 4th parameter. `completeTaskAction` passes `new Map()` (empty — Plan 10-03 will swap in the real fetched Map once atomic consumption lands).
- **Files modified:** `lib/area-celebration.ts`, `lib/actions/completions.ts`, `tests/unit/area-celebration.test.ts`.
- **Commit:** f398f0f (bundled into Task 2 commit — this fix belonged to the Task 2 typecheck closure).
- **Test added:** P-OV-1 in `area-celebration.test.ts` — confirms override Map is consulted by both before/after branches.

No other deviations. Plan 10-02 executed as written apart from this closure fix.

## Commits

| Hash | Subject |
|------|---------|
| 7e62735 | feat(10-02): extend computeNextDue with override branch (D-06, D-10) |
| f398f0f | feat(10-02): thread overridesByTask Map through coverage + band helpers |
| 8495440 | feat(10-02): wire override fetch into scheduler + pages + components (SNZE-10) |

## Handoff to Plan 10-03 (Wave 3 — atomic consumption)

### computeNextDue signature now includes override?

Plan 10-03's post-completion toast computation (`lib/actions/completions.ts:236-247`) currently passes `undefined` for the 4th arg:

```typescript
const nextDue = computeNextDue(
  { id: ..., created: ..., archived: false, frequency_days: ..., schedule_mode: ..., anchor_date: ... },
  { completed_at: now.toISOString() },
  now,
  // 4th arg = undefined implicitly
);
```

Plan 10-03 should evaluate whether to fetch the active override and pass it. HOWEVER: the D-10 read-time filter handles this case for free — immediately after completion, `lastCompletion.completed_at = now`, and if the override's `snooze_until <= now`, D-10 stales it. So passing `undefined` (current state) is correct if atomic consumption has run: the override's `consumed_at` would be set in the same batch, and even if the read races, D-10 catches it.

**Recommendation:** keep the `undefined` for now; document the D-10 trust in Plan 10-03's summary.

### `detectAreaCelebration` caller still passes empty Map

`lib/actions/completions.ts` call:
```typescript
if (detectAreaCelebration(tasksInArea, latestBefore, latestAfter, new Map(), now)) {
```

Plan 10-03 has two options:
1. **Keep empty Map** — per D-10, the just-consumed override is stale vs. `latestAfter` (which has the new completion), so overrides for OTHER tasks in the same area still wouldn't be consulted; celebration would trigger "optimistically" for snoozed other tasks.
2. **Inject real Map** — fetch `getActiveOverridesForHome` inside `completeTaskAction` and pass it to `detectAreaCelebration` (at the cost of one extra PB roundtrip per completion).

**Recommendation:** Plan 10-03 should prefer option 2 when it's already fetching overrides for the atomic-consumption update. The cost is amortised — one Map fetch serves both the consumption write AND the celebration predicate AND the toast's next-due.

### Test port allocation log (unchanged)

No new port claimed — scheduler Scenario E reused 18097 (the existing scheduler test file's port). Plan 10-03 can claim 18098 (Plan 10-01's original allocation) OR 18099 if it prefers a fresh disposable PB instance for atomic-consumption scenarios.

### Override `consumed_at` is now a load-bearing falsy check

All three consumers (`computeNextDue`, `schedule-overrides` helpers, the new tests) treat `!consumed_at` as "active". If Plan 10-03 ever writes `consumed_at: false` or `0` or other falsy non-date values, that would be treated as "still active" incorrectly. PB 0.37.1 DateField only produces ISO strings / null / undefined / empty-string in practice, so this is fine today.

## Self-Check: PASSED

- [x] `lib/task-scheduling.ts` contains `override?: Override` — FOUND at line 93
- [x] `lib/task-scheduling.ts` contains `from '@/lib/schedule-overrides'` — FOUND at line 4
- [x] `lib/task-scheduling.ts` contains `override && !override.consumed_at` — FOUND at line 121
- [x] `lib/task-scheduling.ts` contains `snoozeUntil > lastCompletedAt` — FOUND at line 126
- [x] `tests/unit/task-scheduling.test.ts` has 23 tests (14 original + 9 new) — VERIFIED
- [x] `grep -c "computeNextDue.*undefined" tests/unit/task-scheduling.test.ts` >= 14 — VERIFIED (all 14 original calls + parity test)
- [x] `lib/coverage.ts` / `lib/band-classification.ts` / `lib/weekly-summary.ts` / `lib/area-coverage.ts` contain `overridesByTask: Map<string, Override>` — VERIFIED
- [x] `lib/scheduler.ts` has 2x `getActiveOverridesForHome(pb, homeId)` (overdue + weekly) — VERIFIED
- [x] `lib/scheduler.ts` contains `overridesByTask.get(task.id)` — VERIFIED
- [x] `components/band-view.tsx` contains `overridesByTask` — VERIFIED
- [x] `components/person-task-list.tsx` contains `overridesByTask` — VERIFIED
- [x] `components/task-list.tsx` contains `computeNextDue.*undefined` — VERIFIED
- [x] All 3 pages contain `getActiveOverridesForHome` — VERIFIED
- [x] `app/(app)/h/[homeId]/page.tsx` contains `Object.fromEntries` — VERIFIED
- [x] Commit 7e62735 in git log — VERIFIED
- [x] Commit f398f0f in git log — VERIFIED
- [x] Commit 8495440 in git log — VERIFIED
- [x] `npm test` full-suite 353/353 pass — VERIFIED
- [x] `npm run build` exit 0 — VERIFIED
- [x] `npx tsc --noEmit` clean — VERIFIED
