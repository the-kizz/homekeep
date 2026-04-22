---
phase: 10
plan: 03
subsystem: schedule-override-foundation
tags:
  - snooze
  - atomic-consumption
  - createBatch
  - completeTaskAction
  - wave-3
  - snze-06
dependency_graph:
  requires:
    - "Override type + getActiveOverride (Plan 10-01)"
    - "getActiveOverridesForHome (Plan 10-01)"
    - "computeNextDue override branch (Plan 10-02)"
    - "detectAreaCelebration Map-threaded signature (Plan 10-02)"
  provides:
    - "Atomic completion + override consumption path in completeTaskAction"
    - "SNZE-06 verified end-to-end via disposable-PB integration scenarios"
  affects:
    - "Phase 15 (snooze UI) — can rely on D-10 write-half being live"
    - "Phase 12 LOAD — scheduler + action state is consistent after completion"
tech-stack:
  added: []
  patterns:
    - "pb.createBatch() atomic multi-collection write (seed.ts / invites.ts family)"
    - "Conditional batch op: if (activeOverride) batch.update(...)"
    - "BatchRequestResult destructure: results[0].body as <full-record>"
    - "Single home-wide override fetch serves both consumption + celebration predicate"
    - "Discriminated-union narrow: 'ok' in result && result.ok === true"
key-files:
  created: []
  modified:
    - "lib/actions/completions.ts (+50 lines: imports, JSDoc threat note, batch refactor, celebration Map inject, computeNextDue undefined 4th arg)"
    - "tests/unit/schedule-overrides-integration.test.ts (+122 lines: vi.mock plumbing + Scenarios 9 & 10 for SNZE-06)"
decisions:
  - "A1 resolved: PB SDK 0.26.8 pb.createBatch().send() returns Array<{status, body: any}> — BatchRequestResult shape per pocketbase.es.d.ts:1168; body is the full created record. No follow-up getOne needed."
  - "Home-wide override Map fetched once (getActiveOverridesForHome) serves both the consumption write AND the detectAreaCelebration call — Wave 2 handoff option 2, amortises the roundtrip."
  - "computeNextDue post-completion call passes `undefined` as 4th arg (plan Step 5) — the override was just consumed in the batch, natural next-due is the correct toast answer; D-10 read-time filter is the defense-in-depth half if any race occurred."
  - "Scenario 11 (batch rollback / TOCTOU race) deferred — plan marked OPTIONAL, flagged as flaky to induce reliably in vitest. PB batch atomicity is documented in the SDK + exercised in production via seed.ts/invites.ts."
  - "Test narrowing fix: discriminated union required `'ok' in result && result.ok !== true` so TypeScript eliminates both the `requiresConfirm:true` arm (lacks `ok`) AND the `ok:false` arm (no `completion`) — simpler `result.ok !== true` alone fails narrowing."
metrics:
  duration: ~15min
  completed: 2026-04-22
---

# Phase 10 Plan 03: Atomic Consumption in completeTaskAction (SNZE-06)

Wave 3 — the final wave of Phase 10. One server action refactor plus two integration scenarios closed the atomic-consumption loop: completeTaskAction now batches the completion write with `schedule_overrides.update({ consumed_at: now })` in a single `pb.createBatch().send()` transaction whenever an active override exists. No "completion landed but override still active" race state possible.

## What Was Built

### `lib/actions/completions.ts` refactor

**Before → After (the only write-path change):**

```typescript
// BEFORE (single .create — the D-10 write half was NOT present):
const created = await pb.collection('completions').create({ ... });

// AFTER (atomic batch with conditional consumption):
const activeOverride = await getActiveOverride(pb, taskId);
const overridesByTask = await getActiveOverridesForHome(pb, homeId);

const batch = pb.createBatch();
batch.collection('completions').create({ ... });
if (activeOverride) {
  batch.collection('schedule_overrides').update(activeOverride.id, {
    consumed_at: now.toISOString(),
  });
}
const results = await batch.send();
const created = results[0].body as { id: string; completed_at: string; task_id: string };
```

**Invariants preserved end-to-end** (B1-B8 from the plan):
- External signature + return type (`CompleteResult` discriminated union) unchanged.
- Error-shape contract intact: input errors → `{ok:false,formError}`; guard → `{requiresConfirm:true,...}`; success → `{ok:true, completion, nextDueFormatted, celebration?}`; outer try/catch wraps PB/network as `{ok:false, formError:'Could not record completion'}`.
- Archived / non-member / early-completion guards all run BEFORE the batch.
- sendPartnerCompletedNotifications still fires with the new `created.id`.
- Celebration detection (detectAreaCelebration) now receives the real `overridesByTask` Map instead of the Wave 2 empty-Map stub.

**Line-level diff summary:**

| Span | Change |
|------|--------|
| Lines 16–19 | Added `getActiveOverride` / `getActiveOverridesForHome` imports |
| Lines 22–70 | JSDoc: add T-10-02 threat entry + Phase 10 D-10 atomic-consumption block |
| Lines 192–201 | NEW: fetch `activeOverride` (single) and `overridesByTask` (home-wide) |
| Lines 203–235 | REPLACED: single `pb.collection('completions').create` → `pb.createBatch()` with conditional override update, `await batch.send()`, destructure `results[0].body` |
| Lines 254–272 | Swap `new Map()` → `overridesByTask` in `detectAreaCelebration` call (Wave 2 handoff follow-through) |
| Lines 314–326 | `computeNextDue(..., undefined)` — explicit 4th arg per D-10 / plan Step 5 |

### New integration scenarios in `tests/unit/schedule-overrides-integration.test.ts`

**Added infrastructure (top of file):**
- `vi.mock('next/cache', ...)` — revalidatePath noop.
- `vi.mock('@/lib/pocketbase-server', ...)` — returns a mutable `currentPb` closure.
- `vi.mock('@/lib/pocketbase-admin', ...)` — same closure.

**Scenario 9 — SNZE-06 happy path (atomic consumption):**
- Create fresh active override on `t1` (snooze_until = now+30d).
- Assert `getActiveOverride(pbAlice, t1Id)` returns the override.
- Call `completeTaskAction(t1Id, { force: true })`.
- Assert result is `{ ok: true, completion, nextDueFormatted }` with truthy `completion.id` + `completion.completed_at`.
- Assert override row's `consumed_at` is now truthy ISO.
- Assert `getActiveOverride(pbAlice, t1Id)` returns `null` — the override is consumed.
- Defense-in-depth: re-fetch the completion row, assert `task_id === t1Id` and `completed_by_id === aliceId`. This proves the batch wrote BOTH ops — a partial write would surface as either a missing completion row or a still-active override.

**Scenario 10 — No-override regression (v1.0 behavior preserved):**
- `t3` has no override.
- Call `completeTaskAction(t3Id, { force: true })`.
- Assert `ok:true` and `completion.id` truthy.
- Assert `schedule_overrides.getFullList({ filter: task_id = t3 })` returns `[]` — no orphaned override row was created as a side-effect.
- Re-fetch the completion, assert `task_id === t3Id`.

**Scenario 11 (batch rollback / TOCTOU race) — deferred.** Plan marked it OPTIONAL with "SKIP if tricky". The race between `getActiveOverride` and `batch.send` is unreliable to induce in vitest. PB batch atomicity is SDK-level (documented + used in production via `lib/actions/seed.ts:93` / `lib/actions/invites.ts:192`), so the contract is verified upstream; in-file coverage would be flaky rather than additive.

## A1 Resolution — pb.createBatch().send() Result Shape

Plan 10-01 flagged A1 as unresolved: the observed shape of `pb.createBatch().send()` in PB SDK 0.26.8 wasn't empirically confirmed. Plan 10-03 Scenario 9 closed it:

**Observation:** `pb.createBatch().send()` resolves to `Array<BatchRequestResult>` where `BatchRequestResult = { status: number; body: any }` (per `node_modules/pocketbase/dist/pocketbase.es.d.ts:1168-1171`). The `body` field is the **full created record** — `results[0].body.id`, `results[0].body.completed_at`, and `results[0].body.task_id` all round-trip cleanly.

**Consequence:** no follow-up `pb.collection('completions').getOne(...)` is needed. The original fallback plan ("if body is NOT the full record, swap to getOne") is dead code and does not apply. The code comment in `completions.ts` documents this for future maintainers.

**Code reference (post-refactor):**
```typescript
const results = await batch.send();
const created = results[0].body as {
  id: string;
  completed_at: string;
  task_id: string;
};
```

## Test Results

```
npm test   (full suite)
  Test Files  46 passed (46)
       Tests  355 passed (355)
    Duration  56.15s

npm test -- tests/unit/schedule-overrides-integration.test.ts
  Tests  10 passed (10)
    Duration  2.58s

npm run build   (Next.js production build)
  22 routes compiled, zero errors.

npx tsc --noEmit
  Clean (zero errors).
```

**355 = 353 baseline (post-Wave 2) + 2 new SNZE-06 scenarios (9 + 10)**.

Per-file delta:

| File | Prior | Added | New | Requirement |
|------|------:|------:|----:|-------------|
| `tests/unit/schedule-overrides-integration.test.ts` | 8 | 2 | 10 | SNZE-06 |

Other 45 test files untouched — the refactor preserves every existing invariant (B1-B7) so regression tests remain green. This is the D-14 contract held intact across all three waves.

## Decisions Made During Execution

1. **Home-wide override Map is fetched alongside the single-task override (Wave 2 handoff option 2).** Instead of fetching only `getActiveOverride(pb, taskId)` for the consumption write and leaving `detectAreaCelebration` with `new Map()`, I fetch `getActiveOverridesForHome(pb, homeId)` too. The extra roundtrip serves three consumers: (a) the celebration predicate gets accurate coverage for sibling tasks in the area; (b) future code (Phase 12 LOAD, Phase 15 UI action sheets wiring off this action) can thread it further at near-zero marginal cost; (c) in the common "no override on this task" case the single-task helper 404s fast while the batch helper returns empty — net still one-or-two lightweight queries.

2. **A1 shape confirmed observationally (not via console.log spike).** Plan 10-01's handoff suggested a `console.log(results[0])` in the integration test. Given the SDK declaration file is explicit (`BatchRequestResult = { status, body }`), I skipped the explicit log and instead wrote Scenario 9 to read `result.completion.id` + `result.completion.completed_at` off the action's return value — a behavioral assertion stronger than a logged shape. If the shape were wrong, the toast would render `undefined` or the partner-notify path would throw, and Scenario 9 would fail with a distinctive error.

3. **Scenario 11 deferred (not implemented, not skipped).** The plan marked it OPTIONAL with "SKIP if tricky". Reliably inducing a TOCTOU race between `getActiveOverride` and `batch.send` in vitest requires either a separate thread mutating PB state between those two SDK calls (flaky) or direct SQLite write (bypasses PB rules — not representative). The SDK's atomicity guarantee is upstream; `lib/actions/seed.ts` and `lib/actions/invites.ts` exercise the same primitive in production and have been battle-tested since Phase 4-5.

4. **Test discriminated-union narrowing: `'ok' in result && result.ok !== true`.** The simpler `result.ok !== true` fails to narrow because the `requiresConfirm:true` arm doesn't have an `ok` property at all, so TS can't eliminate it from the union. Using `'ok' in result` is the canonical way to narrow off a discriminator that doesn't exist on every arm (mirrors the `'requiresConfirm' in result` idiom used in `TaskRow.tsx` from Phase 3-03).

5. **computeNextDue post-completion call uses `undefined`, not the home-wide Map.** Per plan Step 5 + D-10 + plan anti-pattern explicitly: the override was just consumed in the batch; the natural next-due is the correct toast answer; and D-10's read-time filter would stale any still-active row since `lastCompletion.completed_at === now`. Keeps the toast byte-identical to v1.0 semantics.

## Deviations from Plan

None. Plan 10-03 executed as written:
- Task 1: refactor completeTaskAction → atomic batch. Done with the expected 6 steps (imports, pre-batch fetch, batch construction, results destructure, celebration Map inject, computeNextDue undefined).
- Task 2: append Scenarios 9 + 10. Done. Scenario 11 deferred per plan's explicit "SKIP if tricky" clause.

No auto-fixes applied — no bugs / missing functionality / blocking issues surfaced during the refactor or test runs. TypeScript narrowing required a minor test-assertion tightening (`'ok' in result`), which is a test-code cleanup not a production deviation.

## Commits

| Hash | Subject |
|------|---------|
| 31dea3d | test(10-03): add failing SNZE-06 atomic-consumption scenarios (RED) |
| e685088 | feat(10-03): atomic consumption in completeTaskAction (SNZE-06, GREEN) |

## Phase 10 Wrap — All 5 REQ-IDs Covered

| REQ-ID | Description | Verification |
|--------|-------------|--------------|
| SNZE-04 | `schedule_overrides` PB collection + member-gated rules | Plan 10-01 Scenarios 1-8 on port 18098 |
| SNZE-05 | `computeNextDue` consults active override before natural fallback (D-06 + D-10 read-time filter) | Plan 10-02 task-scheduling tests O1-O9 |
| SNZE-06 | Overrides consumed atomically when next completion lands | **This plan — Scenario 9 (active → consumed), Scenario 10 (no-override regression)** |
| SNZE-09 | Coverage ring uses snoozed next_due (snoozed tasks don't drag coverage down) | Plan 10-02 coverage tests C-OV-1/2/3, band tests B-OV-1/2/3, area A-OV-1/2, weekly W-OV-1 |
| SNZE-10 | Scheduler ntfy `ref_cycle` keys on effective next_due | Plan 10-02 scheduler Scenario E (port 18097) |

All 5 requirements are now behaviorally covered by integration + unit tests on disposable PB. No manual verification steps required — the `/gsd-verify` agent can confirm each REQ-ID by running the named test files.

## Handoff to Verifier

### Key Artifacts

1. **`lib/actions/completions.ts`** — the atomic-batch write path (lines 200–235).
2. **`tests/unit/schedule-overrides-integration.test.ts`** — 10 scenarios total, 2 new (9+10) for SNZE-06.

### Verification Commands

```bash
# Full regression: must be 355/355
npm test

# SNZE-06 scenarios in isolation
npm test -- tests/unit/schedule-overrides-integration.test.ts

# Type + build gates
npx tsc --noEmit
npm run build
```

### Pattern Invariant for Future Phases

Any new writer of the `completions` collection MUST use `pb.createBatch()` and include the `schedule_overrides.update({consumed_at: now})` op when an active override exists — direct `pb.collection('completions').create(...)` outside a batch would violate D-10 atomicity. A grep guard in future verifier runs (`grep -c "pb.collection('completions').create" lib/actions/completions.ts` should equal 0) enforces this.

### Phase 10 Test Port Allocation (Final)

No new port claimed by Plan 10-03. The integration file retained port 18098 from Plan 10-01 — Scenarios 9 and 10 share the same disposable PB instance with Scenarios 1-8. Next available for Phase 11+ planning: 18099.

## Self-Check: PASSED

- [x] `lib/actions/completions.ts` contains `import.*getActiveOverride` — FOUND (lines 16-19, multiline)
- [x] `lib/actions/completions.ts` contains `const activeOverride = await getActiveOverride` — FOUND (line 200)
- [x] `lib/actions/completions.ts` contains `pb.createBatch()` — FOUND (line 211)
- [x] `lib/actions/completions.ts` contains `batch.collection('completions').create` — FOUND (line 212)
- [x] `lib/actions/completions.ts` contains `batch.collection('schedule_overrides').update` — FOUND (line 220)
- [x] `lib/actions/completions.ts` contains `consumed_at: now.toISOString()` — FOUND (line 221)
- [x] `lib/actions/completions.ts` contains `await batch.send()` — FOUND (line 230)
- [x] `lib/actions/completions.ts` contains `if (activeOverride)` — FOUND (line 219)
- [x] `grep -c "pb.collection('completions').create" lib/actions/completions.ts` == 0 — VERIFIED (write path is batch-only)
- [x] `lib/actions/completions.ts` contains `computeNextDue(...undefined...)` pattern — FOUND (line 325)
- [x] `tests/unit/schedule-overrides-integration.test.ts` contains "Scenario 9" — FOUND
- [x] `tests/unit/schedule-overrides-integration.test.ts` contains "Scenario 10" — FOUND
- [x] `tests/unit/schedule-overrides-integration.test.ts` contains `completeTaskAction` — FOUND
- [x] `vi.mock` count in integration test >= 2 — 5 FOUND
- [x] `test(` count in integration test >= 10 — 11 FOUND (describe + 10 tests)
- [x] `npx tsc --noEmit` clean — VERIFIED
- [x] `npm run build` exit 0 — VERIFIED (22 routes)
- [x] Full-suite `npm test` 355/355 — VERIFIED
- [x] `npm test -- schedule-overrides-integration` 10/10 — VERIFIED
- [x] Commit 31dea3d in git log (RED) — VERIFIED
- [x] Commit e685088 in git log (GREEN) — VERIFIED
