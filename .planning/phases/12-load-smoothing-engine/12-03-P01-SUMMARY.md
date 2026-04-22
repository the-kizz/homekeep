---
phase: 12-load-smoothing-engine
plan: 03
subsystem: completion-write-path
tags:
  - load-smoothing
  - completeTaskAction
  - atomic-batch-extension
  - wave-3
  - write-side
  - forward-only-write
  - isOoftTask-centralization
  - d-13-error-handling

# Dependency graph
requires:
  - phase: 12-load-smoothing-engine
    plan: 01
    provides: "placeNextDue + computeHouseholdLoad pure helpers; isOoftTask centralized export; Task.next_due_smoothed field"
  - phase: 12-load-smoothing-engine
    plan: 02
    provides: "computeNextDue smoothed branch (LOAD-02) — read-side consumer of the next_due_smoothed value this plan writes"
  - phase: 11-task-model-extensions
    plan: 03
    provides: "Phase 11 OOFT archive batch op pattern (tasks.update archived+archived_at atomic with completion write)"
  - phase: 10-schedule-override-foundation
    plan: 03
    provides: "Phase 10 atomic batch semantics (override consumption atomic with completion write); overridesByTask Map already fetched at line 222"
provides:
  - "completeTaskAction Phase 12 batch extension (LOAD-10) — atomic smoothed-date write appended to Phase 10+11 batch, gated on cycle && !OOFT"
  - "isOoftTask centralized use (4th callsite — Phase 11 Rule-1 drift prevention)"
  - "placement error → console.warn + natural fallback (D-13 error handling) — completion NEVER fails on placement error"
  - "LOAD-11 forward-only write invariant (batch op targets only task.id; no sibling mutations)"
  - "T-12-PLACE-ERR mitigation — inner try/catch around placement preserves completion atomicity; outer batch.send() still transactional"
  - "3 action-level unit bypass invariants (T28/T29/T30) — placeNextDue signature regression gate + anchored/OOFT bypass defense in depth"
affects:
  - "Phase 12 Wave 4 (12-04): integration Scenario 2 exercises the full batch flow end-to-end via disposable PB (completion → smoothed-date write → read-time pickup via Plan 12-02 branch)"
  - "Phase 13 TCSEM: createTaskAction will mirror this exact pattern (D-14) — same helpers, same isOoftTask guard, same timezone flow"
  - "Phase 16 LVIZ: will consume task.next_due_smoothed written by this batch via computeNextDue → computeHouseholdLoad composition"
  - "Phase 17 REBAL: preservation rules key on next_due_smoothed written or null (this plan's write-side is the source of the non-null values)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Inner try/catch inside the outer action-level try/catch — placement errors swallow to console.warn without failing the outer completion write (D-13)"
    - "Centralized helper export reuse — isOoftTask is called from 3+ sites (computeNextDue, completeTaskAction, placeNextDue guard); Phase 13 will be 4th"
    - "Batch op appended to existing transaction — no new PB transaction, no extra roundtrip; Phase 10+11 atomicity extends to the smoothed-date write"

key-files:
  created: []
  modified:
    - "lib/actions/completions.ts (412 → 511 lines; +102 insertions / -3 deletions) — imports + freqOoft rewire to isOoftTask + Phase 12 step 7.5 block inserted between OOFT-archive guard and batch.send()"
    - "tests/unit/load-smoothing.test.ts (602 → 652 lines; +50 insertions / 0 deletions) — new 'Phase 12 action-level bypass invariants' describe block with T28/T29/T30"

key-decisions:
  - "TypeScript cast: used `isOoftTask(task as unknown as Task)` instead of plan text's `isOoftTask(task as Task)`. Rationale: PocketBase's `RecordModel` type doesn't structurally overlap with `Task` enough for TS to accept a direct cast (TS2352 'neither type sufficiently overlaps'). The `as unknown as Task` pattern matches what the plan itself uses at line 343 for `placeNextDue(task as unknown as Task, ...)`. Byte-identical runtime behavior; pure TS ergonomics. Single-character fix, no semantic deviation."
  - "Insertion position: Phase 12 block landed immediately after the freqOoft `}` closure (now line 270) and before `// PB SDK 0.26.8 .send() resolves to ...` comment (now line 369). Preserves the existing `results[0].body` index for the completion — placement op appends at results[2] or results[3] depending on override+OOFT presence, and results[0] through results[n-1] ordering stays intact (A1 resolved in Phase 10 SUMMARY)."
  - "Error handling: inner try/catch wraps the entire placement block (fetch + compute + placeNextDue + batch.update). Any throw — PB fetch failure, NaN date from corrupt frequency_days, timezone miscast, etc — logs to console.warn and swallows. The completion itself is OUTSIDE this inner try/catch and still participates in batch.send() atomically. This is the D-13 best-effort contract: placement is fire-and-forget; completion correctness is paramount."
  - "Toast computation (lines 365-391 in pre-edit; now 462-488) left UNCHANGED per plan guidance. The existing `computeNextDue` call constructs a hand-built Task shape that does NOT include next_due_smoothed — intentionally, so the toast renders natural-cadence 'next due' for the user-facing post-completion feedback. The smoothed value is for the *next* cycle's placement, not this completion's immediate toast."

patterns-established:
  - "Pattern: Inner try/catch for best-effort batch extensions — when appending a non-critical op to an atomic batch, wrap the op's input preparation (fetches, computations) in an inner try/catch that can swallow errors WITHOUT compromising the outer batch's atomicity. The outer batch op set remains the correctness contract; the inner op is optional (best-effort)."
  - "Pattern: Centralized predicate helper with explicit drift-prevention comments — isOoftTask's JSDoc enumerates all 4 callsites (3 shipped + 1 pending Phase 13). When a 5th callsite appears, update the JSDoc count in the same commit."

requirements-completed:
  - LOAD-10

# Metrics
duration: ~5min
completed: 2026-04-22
---

# Phase 12 Plan 03: Load-Smoothing Engine Wave 3 — completeTaskAction batch extension (LOAD-10)

**Wired the write side: completeTaskAction's existing Phase 10+11 atomic batch now appends ONE additional `tasks.update({next_due_smoothed})` op, gated on `cycle && !isOoftTask(task)` — anchored tasks and OOFT tasks leave next_due_smoothed untouched (byte-identical v1.0/Phase 11 behavior); placement errors swallow to console.warn with natural-fallback (D-13); forward-only write invariant preserved (batch op targets only task.id).**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-22T11:22:10Z
- **Completed:** 2026-04-22T11:27:28Z
- **Tasks:** 2 / 2
- **Files modified:** 2 (completions action + load-smoothing unit tests)
- **Test delta:** +3 new (T28/T29/T30 in load-smoothing.test.ts). Net suite delta: 455 → 458.

## Accomplishments

### Task 1 — completeTaskAction Phase 12 step 7.5 inserted

Three-part edit to `lib/actions/completions.ts`:

**Part A — New imports (2 lines):**

```typescript
import { computeNextDue, isOoftTask, type Task } from '@/lib/task-scheduling';  // was: computeNextDue, type Task
import { computeHouseholdLoad, placeNextDue } from '@/lib/load-smoothing';       // new
```

**Part B — freqOoft rewired to centralized helper:**

```typescript
// BEFORE (Phase 11 Rule-1 inlined, 2 lines):
const freqOoft =
  task.frequency_days === null || task.frequency_days === 0;

// AFTER (Phase 12 centralized, 1 line):
const freqOoft = isOoftTask(task as unknown as Task);
```

Rewire is byte-identical runtime behavior — `isOoftTask` is `task.frequency_days === null || task.frequency_days === 0`. Value: 4th callsite now drains to one export; Phase 13's TCSEM will be the 5th, making the centralization payoff compounding.

**Part C — Phase 12 step 7.5 block inserted (line 272-368):**

Appended between the freqOoft archive guard's closing `}` (line 270) and the `batch.send()` comment block (line 369). 97 lines total including JSDoc:

```typescript
if (task.schedule_mode === 'cycle' && !freqOoft) {
  try {
    const homeTasks = (await pb.collection('tasks').getFullList({
      filter: pb.filter('home_id = {:hid} && archived = false', { hid: homeId }),
      fields: [
        'id', 'created', 'archived',
        'frequency_days', 'schedule_mode', 'anchor_date',
        'preferred_days', 'active_from_month', 'active_to_month',
        'due_date', 'next_due_smoothed',
      ].join(','),
    })) as unknown as Task[];

    const homeTaskIds = homeTasks.map((t) => t.id);
    const homeCompletions = await getCompletionsForHome(pb, homeTaskIds, now);
    const homeLatestByTask = reduceLatestByTask(homeCompletions);

    const householdLoad = computeHouseholdLoad(
      homeTasks, homeLatestByTask, overridesByTask,
      now, 120, home.timezone as string,
    );

    const placedDate = placeNextDue(
      task as unknown as Task,
      lastCompletion,
      householdLoad,
      now,
      {
        preferredDays: (task.preferred_days as
          | 'any' | 'weekend' | 'weekday' | null
          | undefined) ?? undefined,
        timezone: home.timezone as string,
      },
    );

    batch.collection('tasks').update(task.id, {
      next_due_smoothed: placedDate.toISOString(),
    });
  } catch (e) {
    console.warn(
      '[completeTask] placement failed (falling back to natural):',
      (e as Error).message,
    );
    // Swallow — leave next_due_smoothed null. computeNextDue
    // falls through to natural cycle branch per D-02.
  }
}
```

**Guard layers (defense in depth):**

1. **LOAD-06 anchored bypass** — `task.schedule_mode === 'cycle'` skips anchored tasks entirely. No batch op appended → next_due_smoothed untouched → byte-identical v1.0 anchored behavior preserved (critical per SPEC §8.5).
2. **LOAD-09 OOFT bypass** — `!freqOoft` (the already-computed predicate) skips both `frequency_days === null` AND `frequency_days === 0` per the isOoftTask centralization. OOFT tasks still archive atomically in the batch (Phase 11) — they just don't get a smoothed date.
3. **D-13 error handling (inner try/catch)** — wraps the entire placement block: PB fetch + computeHouseholdLoad + placeNextDue + batch.update op. Any throw logs to `console.warn` and swallows. The outer batch still sends atomically with the completion + (maybe override) + (maybe OOFT-archive) ops. next_due_smoothed stays null → read-time D-02 natural-fallback takes over.
4. **LOAD-11 forward-only write** — the batch op is `batch.collection('tasks').update(task.id, ...)` — targets the single task being completed. No sibling task records are mutated inside this plan's code path. Placement computation reads sibling tasks (for load map) but only writes to `task.id`.

**Preserved invariants (unchanged):**

- T-10-02 atomic override consumption (Phase 10 batch op at line 240-244).
- T-11-03 atomic OOFT archive (Phase 11 batch op at line 265-270).
- Celebration detection + partner-completed ntfys (lines 395-421 in new file).
- Success-toast `computeNextDue` call (lines 470-488 in new file) — still renders natural cadence; smoothed value is for the NEXT cycle's placement, not the immediate post-completion toast feedback.

**Type-check clean** on first try after the `as unknown as Task` TS-strict fix.

### Task 2 — 3 action-level bypass invariants in load-smoothing.test.ts

New `describe` block appended at the end of `tests/unit/load-smoothing.test.ts` (before the `void formatInTimeZone;` pragma). Three tests:

| # | Test | LOAD-# | Purpose |
|---|------|--------|---------|
| T28 | placeNextDue happy-path — cycle task + valid freq returns a Date | LOAD-03 | Signature regression gate. If completeTaskAction's call shape drifts from the helper's signature, this test fails before integration. |
| T29 | placeNextDue rejects anchored task | LOAD-06 | Defense-in-depth. The action's `schedule_mode === 'cycle'` guard is the primary protection; this test ensures the helper itself throws if the guard is ever bypassed (throw pattern `/LOAD-06\|anchored/`). |
| T30 | placeNextDue rejects OOFT task (null AND 0 variants) | LOAD-09 | Defense-in-depth. The action's `!freqOoft` guard (via centralized isOoftTask) is primary; this test ensures the helper throws for both OOFT shapes — catches the PB 0.37.1 `frequency_days: null → stored as 0` quirk (Plan 11-03 Scenario 2 discovery). Single test with 2 `toThrow` assertions. |

All 3 green on first run. File total: 23 tests (20 existing from Plan 12-01 + 3 new).

## Self-Check: PASSED

**Files verified exist:**
- `lib/actions/completions.ts` (modified, +102/-3 lines) — FOUND
- `tests/unit/load-smoothing.test.ts` (modified, +50/0 lines) — FOUND
- `.planning/phases/12-load-smoothing-engine/12-03-P01-SUMMARY.md` (this file) — FOUND

**Commits verified in git log:**
- `3db18a6` feat(12-03): extend completeTaskAction with Phase 12 smoothed placement (LOAD-10) — FOUND
- `d8b6d4d` test(12-03): add 3 action-level bypass invariants to load-smoothing.test.ts — FOUND

**Acceptance criteria (Task 1):**
- [x] Grep `import { computeHouseholdLoad, placeNextDue } from '@/lib/load-smoothing'` → line 20
- [x] Grep `import { computeNextDue, isOoftTask, type Task }` → line 9
- [x] Grep `Phase 12 step 7.5` → lines 272, 368
- [x] Grep `if (task.schedule_mode === 'cycle' && !freqOoft)` → line 311
- [x] Grep `batch.collection('tasks').update(task.id, { next_due_smoothed` → lines 356-357
- [x] Grep `placement failed (falling back to natural)` → line 361
- [x] Grep `const freqOoft = isOoftTask(task` → line 264 (rewired to centralized helper)
- [x] `npx tsc --noEmit` exits 0
- [x] `npm test -- tests/unit/task-scheduling.test.ts tests/unit/load-smoothing.test.ts --run` → 80 tests green

**Acceptance criteria (Task 2):**
- [x] Grep `describe('Phase 12 action-level bypass invariants` → line 602
- [x] New describe has 3 `test(` calls — total file test count = 23 (≥ 21 target)
- [x] `npm test -- tests/unit/load-smoothing.test.ts --run` → 23 tests green
- [x] Full regression `npm test --run` → 458 tests green (455 baseline + 3 new)

## Deviations from Plan

**1. [Rule 1 — TS strict cast]** `isOoftTask(task as Task)` → `isOoftTask(task as unknown as Task)`
- **Found during:** Task 1 type-check (`npx tsc --noEmit`)
- **Issue:** `task` is PB's `RecordModel` shape; direct cast to `Task` produces TS2352 ("neither type sufficiently overlaps"). Plan text specified the direct cast, but PB's type (missing `created`, `archived`, `frequency_days`, etc as required fields) doesn't structurally match Task's required fields.
- **Fix:** Added `as unknown as` — same pattern the plan itself uses for `placeNextDue(task as unknown as Task, ...)` at line 343. Runtime behavior identical.
- **Files modified:** `lib/actions/completions.ts` line 264.
- **Commit:** included in `3db18a6`.

No other deviations. All other Task 1 & Task 2 instructions executed verbatim.

## Handoff

### For Wave 4 (Plan 12-04 — integration)

**Scenario 2 pre-reqs now ready:**
- The completion write-path now atomically writes `next_due_smoothed` for cycle+!OOFT tasks.
- The read-side (Plan 12-02's smoothed branch in computeNextDue) will pick up the written value on the next render.
- End-to-end flow: `completeTaskAction` → batch includes `tasks.update({next_due_smoothed})` → PB commits atomically → next `computeNextDue(task, ...)` call reads the smoothed value via Plan 12-02's branch.

**Integration test boundaries:**
- Scenario 2 (Wave 4) should exercise: fresh cycle task → complete → verify `next_due_smoothed` is non-null in PB → call a downstream read (e.g. `getTaskList` or re-render home page) → verify the displayed next-due reflects the smoothed value.
- Anchored task completion: verify `next_due_smoothed` stays null in PB (byte-identical to v1.0).
- OOFT completion: verify the task archives atomically AND `next_due_smoothed` stays null.
- Placement error simulation: corrupt a task's `frequency_days` to a non-integer; complete → verify console.warn, no next_due_smoothed write, completion row still lands.

**Not yet integration-proven (deferred to 12-04):**
- The actual batch result ordering when all 4 ops fire (completion + override consume + OOFT archive + smoothed update) — Phase 10's A1 contract says results[0] is still the completion, but 4-op batch hasn't been disposable-PB tested.
- LOAD-13 <100ms budget for 100-task household — 12-04 Scenario 3 covers.

### For Phase 13 (TCSEM)

`createTaskAction` will mirror this exact pattern with zero variation:
- Import same 2 helpers (`computeHouseholdLoad`, `placeNextDue`) + `isOoftTask`.
- Guard on `cycle && !isOoftTask(newTask)` — same predicate.
- Fetch home-wide tasks + completions — same single-query pattern.
- Call `placeNextDue(newTask, null, load, now, { preferredDays, timezone })` — lastCompletion is null for a brand-new task (naturalIdeal = task.created + frequency_days).
- Append to the creation batch: `batch.collection('tasks').update(created.id, { next_due_smoothed })` OR set in the create body directly if Phase 13 prefers.

**Drift risk:** the `isOoftTask` JSDoc enumerates 3 callsites today; Phase 13 must update it to 5 (this plan made it 4; Phase 13 is the 5th). Add "DO NOT FORGET" note to Phase 13 pre-work.

### For Phase 16 (LVIZ) / Phase 17 (REBAL)

No direct dependency on this plan's code, but:
- LVIZ's horizon density visualization consumes `computeHouseholdLoad` which reads `next_due_smoothed` via computeNextDue. This plan's write-side is the source of truth for the non-null values.
- REBAL's preservation rules key on `next_due_smoothed !== null` to distinguish "smoothed" from "v1.0 holdover / anchored / OOFT" tasks. This plan's write-side establishes which tasks get smoothed dates written.

## Port Allocation Delta

None. This plan is server-action + unit-test only — no new PB collections, no new Docker services, no new network ports.

## Test Count Trajectory

| Plan | Delta | Cumulative |
|------|-------|------------|
| 12-01 (Wave 1) | +20 | 434 |
| 12-02 (Wave 2) | +21 | 455 |
| **12-03 (Wave 3)** | **+3** | **458** |
| 12-04 (Wave 4 — integration) | estimated +~6-10 | ~464-468 |

Phase 12 cumulative unit-test coverage trending toward the ~45-test mark by Wave 4 end, well above the 15-test LOAD-15 minimum.
