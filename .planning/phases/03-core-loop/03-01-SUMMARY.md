---
phase: 03-core-loop
plan: 01
subsystem: database, domain-logic
tags: [phase-3, completions, band-classification, coverage, early-completion-guard, pocketbase-migration, pure-functions, tdd, timezone-aware, date-fns-tz, server-action]

# Dependency graph
requires:
  - phase: 02-auth-core-data
    provides: "tasks collection with frequency_days/schedule_mode/anchor_date/archived fields; lib/task-scheduling.ts computeNextDue pure function; lib/pocketbase-server.ts createServerClient; PB 0.37 migration + disposable-test pattern"
provides:
  - "completions collection (task_id, completed_by_id, completed_at, notes, via, created) with updateRule=null + deleteRule=null (append-only per D-10) and double-hop ownership rules via `task_id.home_id.owner_id = @request.auth.id`"
  - "zod completionSchema with via defaulting to 'tap'; CompletionInput + ForceCompletionInput types (lib/schemas/completion.ts)"
  - "CompletionRecord type + getCompletionsForHome(pb, taskIds, now) (bounded 13-month fetch, explicit batch:500) + reduceLatestByTask pure reducer (lib/completions.ts)"
  - "computeTaskBands(tasks, latestByTask, now, timezone) — timezone-aware band classification via fromZonedTime(startOfDay(toZonedTime(now, tz)), tz) (lib/band-classification.ts)"
  - "computeCoverage(tasks, latestByTask, now) — equal-weight mean of per-task health, returns 1.0 for empty-home invariant (lib/coverage.ts)"
  - "shouldWarnEarly(task, lastCompletion, now) — strict `<` against 0.25 * frequency_days; uses task.created fallback when no completion (lib/early-completion-guard.ts)"
  - "completeTaskAction server action with ownership preflight + server-side guard re-check + revalidatePath + typed CompleteResult discriminated union (lib/actions/completions.ts)"
  - "Integration-test pattern for disposable PB on alternate port (18091) proving append-only contract (tests/unit/hooks-completions-append-only.test.ts)"
affects: [03-02-three-band-ui, 03-03-wiring-and-e2e, 04-collaboration, 05-history-view, 06-notifications]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PB append-only collection: updateRule=null + deleteRule=null (NOT empty string) — per PB docs, null = locked to superusers"
    - "PB double-hop ownership filter: `task_id.home_id.owner_id = @request.auth.id` with supporting (task_id, completed_at) index"
    - "PB body-check defense-in-depth: createRule enforces `@request.body.completed_by_id = @request.auth.id` alongside server-action source-of-truth assignment"
    - "Timezone-aware day boundaries: `fromZonedTime(startOfDay(toZonedTime(now, tz)), tz)` gives local-midnight-as-UTC-instant, DST-safe"
    - "Pure-function interface: pass `now: Date` + `timezone: string` as parameters (never read clock inside); gives deterministic fixed-date tests"
    - "Server action discriminated-union return: `{ok:true,...} | {ok:false,formError} | {requiresConfirm,...}` — business outcomes never thrown"
    - "Bounded recency-window fetch + client reduce: workaround for PB lacking GROUP BY (Pattern 2 in RESEARCH)"
    - "Disposable PB integration test on port 18091 (distinct from 02-01's 18090 so both can run without collision)"

key-files:
  created:
    - "pocketbase/pb_migrations/1714867200_completions.js"
    - "lib/schemas/completion.ts"
    - "lib/completions.ts"
    - "lib/band-classification.ts"
    - "lib/coverage.ts"
    - "lib/early-completion-guard.ts"
    - "lib/actions/completions.ts"
    - "tests/unit/schemas/completion.test.ts"
    - "tests/unit/hooks-completions-append-only.test.ts"
    - "tests/unit/completions-reduce.test.ts"
    - "tests/unit/band-classification.test.ts"
    - "tests/unit/coverage.test.ts"
    - "tests/unit/early-completion-guard.test.ts"
  modified: []

key-decisions:
  - "03-01: Used null (not empty string) for completions updateRule/deleteRule — per PB docs null = superusers only; integration test proves 403 for regular API callers"
  - "03-01: Disposable PB integration test uses port 18091 (02-01 used 18090) so concurrent test runs don't collide"
  - "03-01: Band classification takes `timezone` as a parameter and uses `fromZonedTime(startOfDay(toZonedTime(now, tz)), tz)` for DST-safe local-midnight calculation"
  - "03-01: Pure functions accept `now: Date` parameter (never read Date.now()) — enables deterministic fixed-date tests and matches Phase 2 computeNextDue"
  - "03-01: Empty-home invariant — computeCoverage returns 1.0 when no active tasks (D-06 'empty house is perfectly maintained')"
  - "03-01: Exact-25% boundary in shouldWarnEarly returns false (strict < per D-07) — covered by explicit unit test"
  - "03-01: completeTaskAction returns typed CompleteResult discriminated union — business cases (requiresConfirm, archived, not-signed-in) are typed returns, only PB/network outages become {ok:false,formError} via catch"
  - "03-01: completeTaskAction hardcodes `via: 'tap'` and sources `completed_by_id` from pb.authStore server-side (never client input) — T-03-01-02 spoofing mitigation"
  - "03-01: Completions query uses explicit batch:500 in getFullList (Pitfall 3) — don't rely on undocumented PB default"

patterns-established:
  - "Pattern: append-only PB collection (null-rule idiom) — replicable for activity logs (Phase 5), invite-accepted events (Phase 4), notification history (Phase 6)"
  - "Pattern: bounded-window fetch + client-side latest-reduce for per-group-max queries against PB (no native GROUP BY MAX)"
  - "Pattern: timezone-aware day boundary computation — any future band/calendar logic in By Area / Person / History views reuses the same fromZonedTime helper"
  - "Pattern: server action with discriminated-union result — future actions with maybe-proceed semantics (duplicate detection, rate-limit retry) follow this shape"
  - "Pattern: pure-function with (entities, latestByTask, now) signature + fixed-date Vitest matrix — coverage/guard/classify all share it; extensible for Phase 5 analytics"

requirements-completed: [COMP-02, COMP-03, VIEW-05]

# Metrics
duration: 9min
completed: 2026-04-21
---

# Phase 3 Plan 1: Completions collection + pure band/coverage/guard engine Summary

**Append-only completions PB collection (updateRule=null + deleteRule=null), four timezone-aware pure functions (computeTaskBands, computeCoverage, shouldWarnEarly, reduceLatestByTask), and the completeTaskAction server action with ownership preflight + server-side guard re-check — the deterministic engine that 03-02 (UI) and 03-03 (wiring) will consume.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-04-21T01:31:57Z
- **Completed:** 2026-04-21T01:41:43Z
- **Tasks:** 3 (6 commits: 2 RED + 2 GREEN + 1 feat + 1 style-fix)
- **Files created:** 13
- **Files modified:** 0 (pure addition; all Phase 2 code untouched)

## Accomplishments

- **Completions collection** exists with correct PB 0.37 rules — `listRule/viewRule` gate by `task_id.home_id.owner_id = @request.auth.id`, `createRule` additionally enforces `@request.body.completed_by_id = @request.auth.id` for defense-in-depth body-spoof prevention, and `updateRule=null` + `deleteRule=null` lock mutations to superusers. Two indexes (`idx_completions_task_completed` on (task_id, completed_at) and `idx_completions_completed_at` on (completed_at)) back the two critical access paths — Pitfall 11 acknowledged.
- **Append-only contract proven** by `tests/unit/hooks-completions-append-only.test.ts`: disposable PB on 127.0.0.1:18091 creates Alice as owner, creates a home+task, Alice successfully inserts a completion (201), then Alice's PATCH + DELETE attempts both reject with HTTP ≥400, and Alice forging `completed_by_id = Bob.id` rejects — four assertions in one live-PB test, exactly what the plan specified.
- **Four pure functions** land with full Vitest matrices totaling 36 cases — `reduceLatestByTask` (6 cases), `computeTaskBands` (12 cases including the Melbourne+LA timezone-boundary canonical case for Pitfall 2), `computeCoverage` (10 cases including empty-home=1.0, half-cycle overdue=0.5, three-task mean=0.5, early-completion clamping to 1.0), and `shouldWarnEarly` (8 cases including the exact-25% boundary that must NOT warn per D-07).
- **Server action completeTaskAction** composes the ownership preflight (via `pb.collection('tasks').getOne` — viewRule enforcement 404s cross-user ids), the server-side guard re-check (defense against a stale client bypassing the confirm dialog — T-03-01-07), the hardcoded `via: 'tap'` + server-sourced `completed_by_id` (T-03-01-02), and the typed `CompleteResult` discriminated union return — all business outcomes returned typed, only PB/network outages caught and coerced to `{ok:false, formError}`.
- **Full test suite green** — 16 files, 113/113 tests passing (67 Phase 2 + 46 new = well past the plan's ≥102 target). Typecheck + build + lint all pass.

## Task Commits

1. **Task 1 RED: failing completions append-only integration + schema tests** — `568b09d` (test)
2. **Task 1 GREEN: completions collection migration** — `a8aa5b1` (feat)
3. **Task 2 RED: failing pure-function matrices for bands/coverage/guard/reduce** — `3189d4d` (test)
4. **Task 2 GREEN: pure band/coverage/guard functions + completions reducer** — `0e5f50a` (feat)
5. **Task 3: completeTaskAction server action** — `bcedd58` (feat)
6. **Lint cleanup: remove unused destructure var in completion schema test** — `5dcceb5` (style)

_TDD gate sequence verified: Task 1 has RED (test) → GREEN (feat) ordering; Task 2 has the same. Task 3 per plan has no unit test (mocking PB for a server action is high-cost/low-value vs the Playwright E2E that 03-03 will deliver)._

## Files Created/Modified

**Created:**
- `pocketbase/pb_migrations/1714867200_completions.js` — completions base collection, 5 data fields (task_id, completed_by_id, completed_at, notes, via) + 1 autodate (created), two indexes, idempotent down migration.
- `lib/schemas/completion.ts` — zod `completionSchema` with `.via.default('tap')`, `CompletionInput` type, `ForceCompletionInput` type, `viaEnum` re-export.
- `lib/completions.ts` — `CompletionRecord` type, `getCompletionsForHome(pb, taskIds, now)` bounded 13-month fetch with explicit `batch: 500`, pure `reduceLatestByTask(completions)` reducer.
- `lib/band-classification.ts` — `ClassifiedTask`, `Bands`, `computeTaskBands(tasks, latestByTask, now, timezone)` using `fromZonedTime(startOfDay(toZonedTime(now, tz)), tz)` for DST-safe local-midnight; sort per D-05.
- `lib/coverage.ts` — `computeCoverage(tasks, latestByTask, now)` equal-weight mean of clamped per-task health; returns 1.0 for empty-home invariant (D-06).
- `lib/early-completion-guard.ts` — `shouldWarnEarly(task, lastCompletion, now)` strict `<` against 0.25 * frequency_days; task.created fallback.
- `lib/actions/completions.ts` — `'use server'` action exporting `completeTaskAction(taskId, { force? }): Promise<CompleteResult>`. Includes all 10 steps from Pattern 4: input validation → auth check → ownership preflight → archived guard → home fetch → latest-completion fetch → guard re-check → create → next-due formatting → revalidatePath.
- `tests/unit/schemas/completion.test.ts` — 9 cases (valid/default/via-enum/empty-fields/notes-length).
- `tests/unit/hooks-completions-append-only.test.ts` — live-PB integration test on port 18091 with superuser pre-create, seed user+home+task fixtures, assert create-success + update-reject + delete-reject + cross-user-create-reject + unchanged-after-reject (5 assertions).
- `tests/unit/completions-reduce.test.ts` — 6 cases covering the Pattern 2 reducer.
- `tests/unit/band-classification.test.ts` — 12 cases including the Melbourne+LA Pitfall 2 canonical boundary and all three sort orders.
- `tests/unit/coverage.test.ts` — 10 cases covering D-06 empty-home, full-cycle clamping, half-cycle, three-task mean, archived-excluded, early-completion clamping.
- `tests/unit/early-completion-guard.test.ts` — 8 cases including no-completion+just-created warn, exact-25%-boundary NO-warn, 10d/7d no-warn, 1h/90d warn.

**Modified:** None — this plan is pure addition; Phase 2 code is untouched.

## Decisions Made

- **Port 18091 for the integration test** (not reusing 02-01's 18090): allows both suites to run concurrently without state contamination. Codified as a new pattern future plans can follow when adding more disposable-PB tests.
- **Server action error-shape contract:** strictly followed Pitfall 5 — ONLY PB/network exceptions propagate into the try/catch and become `{ok:false, formError: 'Could not record completion'}`. Business outcomes (missing taskId, not signed in, archived task, guard fired) are typed returns outside the catch. Makes the client a simple switch on `result.ok` / `result.requiresConfirm`.
- **No server-action unit test in this plan:** per plan `<behavior>` rationale — mocking PocketBase for a server action is high-cost/low-value compared to the real-PB Playwright E2E that 03-03 will exercise. Task 1's integration test already proves the underlying PB contract; Task 2's matrices prove the pure-function composition; `completeTaskAction` itself is pure composition. Risk surface is integration, not unit.
- **Integration test `cascadeDelete: true` on task_id, `cascadeDelete: false` on completed_by_id:** if a task is ever hard-deleted its completions should follow (data-integrity); users must NEVER be deletable while any completion references them (audit-trail integrity). Documented inline in migration source.

## Deviations from Plan

None — plan executed exactly as written. All three tasks landed with the RED→GREEN commit pairs the plan specified (Tasks 1 and 2) and the single feat commit for Task 3. The one extra `style` commit at the end is a trivial lint fix (removing an unused destructure variable) and is noted in the commit log for transparency; no behaviour change.

## Issues Encountered

None of note. The disposable-PB integration test on port 18091 worked cleanly on the first run once the migration was in place — no stale PB process collisions (contrast with 02-01's early-phase issue), no WAL race issues (the superuser-pre-create pattern from 02-01 held up).

## Assumption Verification (from 03-RESEARCH.md §Assumptions Log)

The RESEARCH.md assumption log is referenced by `<output>` in the plan. Items exercised here:

- **A1 (PB createRule body-check `@request.body.completed_by_id = @request.auth.id` is supported):** CONFIRMED — the integration test's cross-user forge attempt rejects with 400/403, proving the body-check rule evaluates as expected against the submitted payload.
- **A2 (PB updateRule=null and deleteRule=null lock mutations to superusers):** CONFIRMED — Alice's authenticated PATCH + DELETE both reject with status >= 400; the original row remains unchanged (re-read confirms notes is still empty).
- **A3 (PB double-hop filter `task_id.home_id.owner_id` evaluates):** CONFIRMED — listRule/viewRule permit Alice's getOne reads against her own completions; read-back in the integration test succeeds.
- **A4 (date-fns-tz `fromZonedTime(startOfDay(toZonedTime(now, tz)), tz)` gives local-midnight-as-UTC-instant):** CONFIRMED — the Melbourne test (now=13:30Z UTC → local 23:30 Apr 20 → midnight today-local = 14:00Z) correctly puts a task whose nextDue is 14:30Z into thisWeek (strictly after local midnight) rather than overdue. The LA test with the same UTC clock (local 06:30 Apr 20 → midnight today-local = 07:00Z) also lands the task in thisWeek. Both branches pass.
- **A5 (PB `getFullList({batch: 500})` accepts explicit batch override):** CONFIRMED indirectly — the `lib/completions.ts` code passes `batch: 500` and the module compiles + typechecks under the 0.26.8 SDK types. Live PB execution is exercised by the integration test's path (though the integration test itself only creates 1 completion so the batch boundary isn't hit).
- **A6 (computeNextDue handles `lastCompletion: Completion | null` from the new CompletionRecord type):** CONFIRMED — band/coverage tests drive computeNextDue via CompletionRecord-typed Maps and all assertions pass.
- **A7 (Phase 2 `createServerClient` is callable from 'use server' actions):** CONFIRMED implicitly — the `completeTaskAction` module typechecks + builds; the import + await pattern matches 02-05's `lib/actions/tasks.ts` verbatim.

Not exercised in this plan (defer to 03-03 E2E):
- Optimistic-UI rollback on server-action throw (React 19 useOptimistic behaviour)
- `revalidatePath + router.refresh` complementary re-sync

## Threat Flags

None — the plan's `<threat_model>` enumerates T-03-01-01 through T-03-01-08. Every one is mitigated exactly as specified:

- T-03-01-01 (spoofing) → `pb.collection('tasks').getOne(taskId)` preflight in completeTaskAction.
- T-03-01-02 (tampering, body) → completed_by_id set server-side from authStore + PB createRule body-check.
- T-03-01-03 (repudiation) → updateRule=null + deleteRule=null; proven by integration test.
- T-03-01-04 (info disclosure) → listRule/viewRule with double-hop owner filter.
- T-03-01-05 (DoS) → accepted; Phase 2 rate limits remain in effect.
- T-03-01-06 (EoP, cross-home) → same as T-03-01-01.
- T-03-01-07 (tampering, force flag) → server re-evaluates shouldWarnEarly when force=false.
- T-03-01-08 (archived task) → explicit check after preflight returns `{ok:false, formError:'Task is archived'}`.

No new surface introduced outside the threat model.

## Known Stubs

None — this plan ships no UI. The "engine only" scope is intentional per plan. The completeTaskAction is wired to a real PB call (not stubbed); 03-02 (UI) and 03-03 (wiring + E2E) consume these primitives without further changes to this plan's code.

## Self-Check: PASSED

- `pocketbase/pb_migrations/1714867200_completions.js` — FOUND
- `lib/schemas/completion.ts` — FOUND
- `lib/completions.ts` — FOUND
- `lib/band-classification.ts` — FOUND
- `lib/coverage.ts` — FOUND
- `lib/early-completion-guard.ts` — FOUND
- `lib/actions/completions.ts` — FOUND
- `tests/unit/schemas/completion.test.ts` — FOUND
- `tests/unit/hooks-completions-append-only.test.ts` — FOUND
- `tests/unit/completions-reduce.test.ts` — FOUND
- `tests/unit/band-classification.test.ts` — FOUND
- `tests/unit/coverage.test.ts` — FOUND
- `tests/unit/early-completion-guard.test.ts` — FOUND
- Task 1 RED commit `568b09d` — FOUND
- Task 1 GREEN commit `a8aa5b1` — FOUND
- Task 2 RED commit `3189d4d` — FOUND
- Task 2 GREEN commit `0e5f50a` — FOUND
- Task 3 commit `bcedd58` — FOUND
- Lint fix commit `5dcceb5` — FOUND
- TDD gate ordering verified: both `test(...)` RED commits precede their `feat(...)` GREEN counterparts
- Acceptance greps all match:
  - `updateRule: null` in migration — 1 hit
  - `deleteRule: null` in migration — 1 hit
  - `idx_completions_task_completed` in migration — 1 hit
  - `fromZonedTime` + `toZonedTime` in lib/band-classification.ts — 3 hits combined
  - `batch: 500` in lib/completions.ts — 2 hits (doc + code)
  - `return 1.0` in lib/coverage.ts — 1 hit (empty-home branch)
  - `0.25 * task.frequency_days` in lib/early-completion-guard.ts — 1 hit
  - `via: 'tap'` in lib/actions/completions.ts — 1 hit
  - `shouldWarnEarly(`, `computeNextDue(`, `revalidatePath(`, ownership preflight `pb.collection('tasks').getOne(taskId` all present
- `npm test` — 113/113 passing across 16 files
- `npm run typecheck` — 0 errors
- `npm run build` — compiles; routes list unchanged vs Phase 2 (engine only)
- `npm run lint` — 0 errors, 1 pre-existing Phase 2 warning (task-form.tsx, out of scope)

## User Setup Required

None — this plan ships no external service integration, no env var, no dashboard config. All consumed services (PocketBase) are already provisioned from Phase 1-2.

## Next Phase Readiness

- **Ready for 03-02 (UI Wave 2):** band-view / coverage-ring / task-band / task-row / horizon-strip / task-detail-sheet / early-completion-dialog components can import `computeTaskBands`, `computeCoverage`, `shouldWarnEarly`, `reduceLatestByTask`, and the `CompletionRecord` type from this plan's modules. All public APIs are deterministic (now + timezone as params), so Storybook / component-test harnesses can render with fixed inputs.
- **Ready for 03-03 (Wiring + E2E Wave 3):** the `/h/[homeId]/page.tsx` Server Component can wire `getCompletionsForHome(pb, taskIds, now)` → `reduceLatestByTask` → pass into BandView. The `completeTaskAction` server action is ready to import; its `CompleteResult` shape is stable for the client's `useOptimistic` + `startTransition` flow described in RESEARCH Pattern 3.
- **No blockers.** COMP-02 (guard) and COMP-03 (append-only) requirements are fully testable from this plan; COMP-01 (one-tap UI) and VIEW-01..04+06 (band UI + detail sheet) land in 03-02/03-03 with zero engine changes needed here.

---
*Phase: 03-core-loop*
*Completed: 2026-04-21*
