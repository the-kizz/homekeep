---
phase: 11
plan: 03
subsystem: task-model-extensions
tags:
  - integration-test
  - disposable-pb
  - port-18099
  - wave-3
  - ooft
  - seasonal
  - d-17
  - phase-11-wrap
dependency_graph:
  requires:
    - "Plan 11-01 migration 1745280001_task_extensions.js (4 new fields + frequency_days required:false flip)"
    - "Plan 11-02 computeNextDue seasonal-dormant / seasonal-wakeup / OOFT branches"
    - "Plan 11-02 completeTaskAction atomic OOFT archive batch op"
    - "Phase 10 pb.createBatch + vi.mock plumbing pattern (schedule-overrides-integration.test.ts)"
    - "PB binary at ./.pb/pocketbase"
  provides:
    - "4 disposable-PB lifecycle scenarios on port 18099"
    - "D-17 override-wins-over-dormancy live-fire regression gate"
    - "Scenario 2 atomic OOFT archive live-fire (T-11-03 mitigation asserted)"
    - "Scenario 3 cross-year-wrap wake-up year-selection live-fire (T-11-04 mitigation asserted)"
    - "Rule 1 fix: frequency_days=0 treated as OOFT marker (PB 0.37.1 storage reality)"
  affects:
    - "Phase 11 verification — all 13 REQ-IDs now have at least one passing test"
    - "Phase 12 LOAD smoother — can consume OOFT + seasonal helpers with confidence in the integration layer"
    - "Phase 14 Seasonal UI — live PB data shape confirmed round-trippable"
    - "Phase 15 OOFT Form UI — due_date read behavior + archive-on-complete UX locked end-to-end"
tech-stack:
  added: []
  patterns:
    - "Disposable PB boot with --migrationsDir + --hooksDir (picks up Plan 11-01 migration + homes_whole_home + bootstrap_batch)"
    - "vi.mock plumbing for createServerClient / createAdminClient / revalidatePath (Phase 10 Plan 10-03 pattern)"
    - "PB 0.37.1 storage-reality accommodation: frequency_days=0 treated as OOFT marker alongside null (lib/task-scheduling.ts isOoft helper + lib/actions/completions.ts freqOoft guard)"
    - "Scenario-local fixture seeding (no shared describe-level seed beyond admin+Alice+home+area) — each test creates its own task+completion fixtures to avoid order-coupling"
key-files:
  created:
    - "tests/unit/task-extensions-integration.test.ts (470 lines, 4 scenarios on port 18099)"
  modified:
    - "lib/task-scheduling.ts (423 → 434 lines; +11 lines; Rule 1 fix for frequency_days=0 OOFT semantic)"
    - "lib/actions/completions.ts (382 → 392 lines; +10 lines; freqOoft guard accepts null || 0)"
    - "tests/unit/task-scheduling.test.ts (664 → 684 lines; +20 lines; 'frequency 0 throws' test rewritten as 'frequency 0 treated as OOFT marker')"
decisions:
  - "Rule 1 auto-fix: accept frequency_days=0 as OOFT marker at runtime — PB 0.37.1 stores a cleared NumberField as 0 on the wire (not null), even after the D-02 required:false flip. Scenario 2 discovery: computeCoverage threw 'Invalid frequency_days: 0' when iterating sibling tasks in the area. App-layer zod still rejects 0 at form submission (defense in depth preserved)."
  - "Scenario count: 4 (per plan acceptance criterion, NOT the prompt's 6). Plan PLAN.md is authoritative; prompt's scenario 5 (seasonal full lifecycle) is covered by Plan-Scenario 3 cases A/B/C; prompt's scenario 6 (zod rejection cross-check) is covered by Plan 11-01's unit-level zod describe block (T-11-01 accept per threat model)."
  - "Fixture strategy: shared beforeAll seeds admin+Alice+home+area only; each test creates its own task+completion fixtures. Order-decoupled — any scenario can run alone."
  - "Port 18099 claimed for this file; 18100 is next free for future phases (18090..18099 all allocated now)."
  - "Use plan's task-creation round-trip approach for Scenario 1 (not /api/collections/tasks GET) — works with Alice's member auth token, no superuser dance needed. Plan acceptance criterion 'File has exactly 4 test( blocks' confirms this scope."
metrics:
  duration: ~12min
  tasks: 1
  files_created: 1
  files_modified: 3
  lines_added: 511
  tests_added: 4
  total_tests: 410
  baseline_tests: 406
  plan_11_01_tests: 31
  plan_11_02_tests: 20
  plan_11_03_tests: 4
  phase_11_total_delta: 55
  completed: 2026-04-22
---

# Phase 11 Plan 03: Task Model Extensions — Integration Suite Summary

Four disposable-PocketBase integration scenarios on port 18099 that prove the Plan 11-01 migration + Plan 11-02 scheduler/coverage/batch changes compose end-to-end against a real PB process. Full suite advanced from 406 to 410 tests (baseline + 4 new integration), all green. Rule 1 deviation fixed an integration-layer bug where PB 0.37.1's storage-reality returns `frequency_days: 0` (not null) for a cleared NumberField — the OOFT branch and archive op now treat `0` as an OOFT marker alongside `null`.

## What Was Built

### Integration test suite

| File | Lines | Scenarios | Port |
|------|-------|-----------|------|
| `tests/unit/task-extensions-integration.test.ts` | 470 | 4 | 18099 |

**Boot pattern** (copy-paste from Phase 10's `schedule-overrides-integration.test.ts`):
- Superuser CLI create BEFORE `serve` (Pitfall 9 — SQLite WAL race avoidance).
- Spawn `serve` with `--migrationsDir=./pocketbase/pb_migrations` (picks up Plan 11-01 migration `1745280001_task_extensions.js`) and `--hooksDir=./pocketbase/pb_hooks` (picks up `homes_whole_home.pb.js` — auto-seeds Whole Home area + owner home_members row on home create, and `bootstrap_batch.pb.js` — enables `settings.batch.enabled=true` for the atomic-batch transactions).
- Poll `/api/health` 30× at 200ms intervals (max 6s wait).

**vi.mock plumbing** (Scenario 2 requires this):
- `next/cache` → `revalidatePath: () => {}`
- `@/lib/pocketbase-server` → `createServerClient: async () => currentPb`
- `@/lib/pocketbase-admin` → `createAdminClient: async () => currentPb, resetAdminClientCache: () => {}`
- `currentPb` is a mutable module-scope ref; Scenario 2 sets it to `pbAlice` just before dynamically importing and invoking `completeTaskAction`.

### Scenarios

#### Scenario 1 — Migration shape end-to-end (OOFT-01, PREF-01, SEAS-01)

Creates three tasks via `pbAlice.collection('tasks').create()` with distinct Phase 11 field shapes:
- **v1.0 shape** (`frequency_days: 7`, no Phase 11 fields) — regression gate for D-26 (zero mechanical churn for existing call-sites).
- **OOFT shape** (`frequency_days: null`, `due_date: '2026-05-01 00:00:00.000Z'`) — confirms PB accepts the D-02 flipped-required NumberField alongside the new nullable DateField.
- **Full Phase 11 shape** (all 4 new fields + PREF 'weekend' + SEAS 4-9) — round-trips via `getOne(full.id)` to confirm PB persisted (not just echoed the create response).

All three creates succeeded on first run. The migration-correctness proof is implicit: if any of the 4 new fields hadn't landed on the schema, PB would have returned HTTP 4xx with `no such field: active_from_month`. None did.

#### Scenario 2 — OOFT lifecycle: create → complete → archived atomically (OOFT-02, OOFT-05, T-11-03)

Flow:
1. Seed OOFT (`frequency_days: null, due_date: '2026-05-01 00:00:00.000Z'`).
2. Set `currentPb = pbAlice`, dynamic-import `completeTaskAction`, call with `{ force: true }` (bypasses the early-completion guard).
3. Assert `result.ok === true`.
4. Re-fetch task via `pbAlice.collection('tasks').getOne(ooft.id)` — assert `archived === true` AND `archived_at` truthy.
5. Assert completion row exists linked to taskId + aliceId.
6. Call `computeNextDue(archivedTask, null, new Date('2026-05-10...'), undefined)` — assert `null` (branch 1 archived short-circuit wins).

**T-11-03 live-fire**: the `refetched.archived === true` assertion passes ONLY if Plan 11-02 Task 3's atomic batch op fired. If the archive had been non-atomic (separate call after completion), step 4 would see `false`. This is the end-to-end proof of D-04 atomicity extending to the OOFT archive op.

**Rule 1 fix required**: see Deviations §1 below — PB returns `frequency_days: 0` on read-back, not null, so the `=== null` guard in the action's batch op missed until the fix landed.

#### Scenario 3 — Seasonal lifecycle: dormant / wake-up / cross-year-wrap (SEAS-02, SEAS-03, SEAS-04)

Wrap-window seasonal task (`active_from_month: 10, active_to_month: 3` — Oct-Mar active, Apr-Sep dormant, 6-6 split). Three cases on the same task row:

- **Case A — wake-up from dormant month**: July (dormant), no completion → `computeNextDue(...)` returns `'2026-10-01T00:00:00.000Z'`. First-cycle wake-up: `lastInPriorSeason` is true (null completion = prior season by definition), so the wake-up branch fires and anchors to from-month start in UTC.
- **Case B — wake-up from in-window cross-year boundary**: Nov 2026 (in-window), no completion → returns `'2027-10-01T00:00:00.000Z'`. The year-selection rule `nowMonth < from ? nowYear : nowYear + 1` picks 2027 because Nov (11) >= Oct (10). **T-11-04 catch**: an off-by-one in this rule would return 2026-10-01, pre-dating now.
- **Case C — dormant with prior in-season completion**: seed completion at Jan 10, 2026 (in-window, within 365d). Now = Jul 15, 2026 (out-of-window). `wasInPriorSeason` returns false (in-window month + in-window elapsed). `inWindowNow` is false. Branch composition fires `!inWindowNow && !lastInPriorSeason` → seasonal-dormant → null. Same-season dormancy semantic locked.

All three cases passed first run. Scenario 3 is the liveness proof for Plan 11-02 Deviation 1 (merged dormant/wake-up branch composition).

#### Scenario 4 — Override × dormant composition wins per D-17 (T-11-05)

Seeds a wrap-window seasonal (Oct-Mar) task + prior in-season completion (Jan 10) + active override (`snooze_until: 2026-08-01 00:00:00.000Z`, dormant-window date). Calls `getActiveOverride(pbAlice, seasonal.id)` to fetch the override via the production read path. Calls `computeNextDue(task, { completed_at: '2026-01-10T00:00:00.000Z' }, new Date('2026-07-15T12:00:00.000Z'), override, 'UTC')`.

Expected: `'2026-08-01T00:00:00.000Z'` (override wins). Actual: `'2026-08-01T00:00:00.000Z'`. ✔

**D-17 live-fire**: without the override-BEFORE-dormant branch order, `computeNextDue` would return null (seasonal-dormant fires first on !inWindowNow && !lastInPriorSeason). The test locks this behavior so future refactors cannot silently break it — Phase 15 UI will surface a warning dialog but the data layer permits unconditionally.

## Decisions Made During Execution

1. **Scenario count: 4 (per PLAN.md acceptance criterion).** The PLAN.md is authoritative over the prompt's 6-scenario expansion. The prompt's "seasonal full lifecycle" is covered by Plan-Scenario 3 Cases A/B/C (wake-up → in-window → dormant-with-completion). The prompt's "Zod rejection cross-check" is T-11-01 accept per threat model — covered at unit level in Plan 11-01's zod describe block. PLAN.md `<success_criteria>` says "exactly 4 scenarios" and `<acceptance_criteria>` says "File has exactly 4 test( blocks". Honored.

2. **Fixture isolation strategy.** `beforeAll` seeds only admin + Alice + her home + Whole Home area (auto-created by the `homes_whole_home.pb.js` hook). Each scenario creates its own task + completion rows inline. Scenario 1 creates 3 tasks but doesn't complete any (so Scenarios 2/3/4 iterating tasksInArea via coverage in the action path see them as non-archived siblings — this is what triggered the Rule 1 discovery).

3. **Test-bypass of zod for Scenario 1b.** Scenario 1b creates an OOFT via PB SDK directly (`pbAlice.collection('tasks').create({ frequency_days: null, due_date: '...' })`) — bypassing the app-layer zod refinement that would enforce `due_date REQUIRED when frequency_days IS NULL`. This is documented T-11-01 accept: the test is proving PB storage accepts the shape; the zod enforcement path is a separate concern proven at the unit level in Plan 11-01 Task 3.

4. **PB DateField accepts space-separated "YYYY-MM-DD HH:MM:SS.sssZ" format.** Not strict ISO-8601 with 'T' separator. Tested shape `'2026-05-01 00:00:00.000Z'` — PB 0.37.1 accepts it and round-trips cleanly. Noted here for Phase 12+ integration authors. The `.toISOString()` output (which uses 'T' separator) also works; both shapes are accepted.

5. **Commit discipline: two commits for one plan.** Plan's commit-protocol specified one commit (`test(11-03): ...`), but the Rule 1 fix produced a separate logical unit (`fix(11-03): ...`) that belongs in its own commit per the executor's task-commit protocol (each logical unit gets its own commit, proper Conventional Commits type). Total: 2 commits for Plan 11-03.

## Deviations from Plan

### 1. [Rule 1 - Bug] frequency_days=0 treated as OOFT marker (PB 0.37.1 storage reality)

**Found during:** Scenario 2 (OOFT lifecycle) red phase.

**Issue:** `computeCoverage` threw `Error: Invalid frequency_days: 0` when `completeTaskAction` iterated sibling tasks in Alice's area. The OOFT task created in Scenario 1 (with `frequency_days: null`) was stored by PB 0.37.1 as the integer `0`, not null. PB's NumberField coerces null to 0 on writes to an existing field — the D-02 `required: false` flip changes validation acceptance but NOT the storage coercion. Both values (`null`, `0`) semantically represent "no natural cycle" / OOFT, but:

- `lib/task-scheduling.ts` `computeNextDue` line 148-155 (Plan 11-02) guarded only on `!== null` → threw for `0`.
- `lib/actions/completions.ts` line 249 (Plan 11-02) guarded only on `=== null` → archive op silently skipped for `0`.

Both code paths assumed a null that PB never delivered at read-back time.

**Fix:**
- `lib/task-scheduling.ts`: precompute `isOoft = task.frequency_days === null || task.frequency_days === 0` at the top of `computeNextDue`. Skip the positive-integer guard when `isOoft`. Route both null and 0 to the OOFT branch (where a no-completion task returns its `due_date` or null).
- `lib/actions/completions.ts`: rename the guard `freqOoft = task.frequency_days === null || task.frequency_days === 0`. Archive op fires on both.
- `tests/unit/task-scheduling.test.ts`: pre-existing v1.0 test "frequency 0 throws" now asserts the new semantic — "frequency 0 treated as OOFT marker (PB 0.37.1 cleared-NumberField storage reality)" → returns null (no completion + no due_date on fixture).

**Why this is a Rule 1 fix (not a plan deviation requiring approval):** The production OOFT feature was broken end-to-end without this fix — any home with a single OOFT task would throw from computeCoverage on every sibling-task iteration, rendering the coverage ring + batch-atomicity paths unusable. This is exactly what integration tests are meant to catch. Scope: three files, 53 insertions, 15 deletions; localized to the OOFT-marker semantic. Preserves the app-layer zod rejection at form submission time (T-11-01 accept stays intact).

**Files modified:**
- `lib/task-scheduling.ts` (427 → 434 lines, +7 net)
- `lib/actions/completions.ts` (384 → 392 lines, +8 net)
- `tests/unit/task-scheduling.test.ts` (664 → 684 lines, +20 net)

**Commits:**
- `5508c8a` — `fix(11-03): accept frequency_days=0 as OOFT marker (PB 0.37.1 storage reality)`

### 2. Scenario count delta from prompt (6 → 4)

**Plan text (authoritative):** 4 scenarios per D-25 + acceptance criterion "File has exactly 4 test( blocks".

**Prompt text:** 6 scenarios.

**Resolved:** Follow PLAN.md. Prompt's Scenarios 5 and 6 are covered:
- Prompt Scenario 5 ("seasonal full lifecycle") ≡ Plan Scenario 3 Cases A/B/C (wake-up → cross-year → dormant-with-completion).
- Prompt Scenario 6 ("Zod rejection cross-check") is deliberately out of scope — T-11-01 accept per plan's threat model; covered at the unit layer by Plan 11-01's zod describe block.

Plan authority preserved; all 13 Phase 11 REQ-IDs have at least one passing test end-to-end.

### 3. No repo-root CLAUDE.md

Consistent with Plans 11-01 and 11-02 SUMMARY notes. No project-layer directives to enforce beyond the standard GSD conventions.

## Verification Evidence

| Check | Command | Result |
|-------|---------|--------|
| Integration suite isolation | `npm test -- tests/unit/task-extensions-integration.test.ts --run` | 4/4 green (~2.1s including PB boot) |
| Full regression | `npm test --run` | **410/410 green** (406 → 410; +4) |
| Type-check | `npx tsc --noEmit` | clean exit, zero errors |
| Port uniqueness | Grep 18099 across tests/unit/ | 1 file (this test only) |
| Test-block count | Grep `test(` in new file | exactly 4 |
| Port claim comment | Grep `18099 (11-03 task extensions` in file | present |
| Migration applied (Scenario 1 proof) | `pbAlice.collection('tasks').create({ active_from_month: 4, active_to_month: 9, preferred_days: 'weekend', due_date: '...' })` | succeeded → all 4 Plan 11-01 fields present on schema |
| Atomic archive (Scenario 2 proof) | refetched.archived === true AFTER completeTaskAction, no separate archiveTask call | confirmed |
| Cross-year wrap math (Scenario 3 Case B proof) | Nov 2026 + no completion → Oct 1, **2027** | confirmed (nowMonth >= from → targetYear = nowYear + 1) |
| D-17 live-fire (Scenario 4 proof) | Override wins over seasonal-dormant, returns snooze_until | confirmed (branch order locked) |
| Rule 1 fix live | No throw from computeCoverage when iterating sibling OOFT tasks | confirmed (Scenario 2 ok:true, archived=true) |

## Port Allocation Register Snapshot

| Port | Claimant | Status |
|------|----------|--------|
| 18090 | 02-01 schema + hooks | claimed |
| 18091 | 03-01 completions append-only | claimed |
| 18092 | 04-01 hook isolation | claimed |
| 18093 | 04-01 rules isolation | claimed |
| 18094 | 04-02 invites roundtrip | claimed |
| 18095 | 05-01 onboarded | claimed |
| 18096 | 06-01 notifications idempotency | claimed |
| 18097 | 06-02 scheduler | claimed |
| 18098 | 10-01 schedule_overrides | claimed |
| **18099** | **11-03 task-extensions (this file)** | **CLAIMED** |
| 18100 | — | **next free** |

## Final Test Count Table

| Layer | Plan | Count | Cumulative |
|-------|------|-------|------------|
| Baseline (pre-Phase 11) | — | 355 | 355 |
| Phase 10 (retroactively counted) | 10-01 / 10-02 / 10-03 | 31 | 386 |
| Phase 11 Wave 1 (unit) | 11-01 (task-extensions.test.ts + 1 schema extension) | 20* | 406 |
| Phase 11 Wave 2 (unit) | 11-02 (task-scheduling +16, coverage +4) | 20 | 406 |
| Phase 11 Wave 3 (integration) | 11-03 (task-extensions-integration.test.ts) | 4 | **410** |

\* Plan 11-01 ran tests migrations net delta; Plan 11-02 SUMMARY recorded baseline as 386 → 406 (delta +20). This table aligns with 11-02's observed counts.

## Boot-Time Reference (Phase 12 budget)

Scenario 1 (includes cold PB boot + Whole Home hook + admin/Alice/home/area seed):
- `beforeAll` total: ~850ms (spawn + health-poll + seed)
- Per-scenario assert body: ~50-150ms (PB round-trip dominated)
- Full 4-scenario file: **~2.05s** end-to-end

Phase 12 LOAD integration can budget similarly for its own disposable-PB file. Port 18100 is next free.

## Handoff for Phase 12 (LOAD Smoother)

Forward contracts now live and integration-tested:

1. **`effectivePreferredDays(task)`** — exported from `lib/task-scheduling.ts`; projects null → 'any'. Phase 12 LOAD scorer calls this before `narrowToPreferredDays`.
2. **`narrowToPreferredDays(candidates, pref)`** — pure filter, returns empty array when no match (Phase 12 owns the PREF-03 widening retry loop).
3. **`isInActiveWindow(month, from?, to?)`** — wrap-aware month-integer check; UTC month fallback when tz omitted.
4. **`nextWindowOpenDate(now, from, to, timezone)`** — wake-up anchor helper.
5. **`tasks.due_date`** — OOFT density contract per D-06: OOFT contributes `1` to the household load map on its due_date, its own `next_due_smoothed` is NEVER set. Phase 11 ships the data shape; Phase 12 consumes it.
6. **`tasks.frequency_days === null || === 0`** — OOFT marker semantic (post-Rule 1 fix). Phase 12 smoother must use the same guard pattern when detecting OOFT tasks — recommend centralizing via an exported helper if a second callsite needs it.
7. **Dormant-task filter** in `computeCoverage` — Phase 12 LOAD must NOT double-filter; coverage handles it. Live-fire confirmed by Plan 11-02 Task 2 unit tests.
8. **D-17 override precedence** — Phase 15 UI will warn when a user snoozes a dormant task, but the data layer (Phase 10 override branch BEFORE Phase 11 seasonal-dormant) permits unconditionally. Locked by Scenario 4.

Phase 12 will insert the `next_due_smoothed` branch BETWEEN the Phase 10 override branch and the Phase 11 seasonal/OOFT/cycle branches. The 5th `timezone?` param slot is live; the 6th `smoothed?` slot is reserved — no further `computeNextDue` signature churn expected in v1.1.

## Phase 11 Wrap Notes for Verifier

**All 13 Phase 11 REQ-IDs behaviorally covered:**

| REQ-ID | Layer | Proof |
|--------|-------|-------|
| OOFT-01 | unit + integration | Plan 11-01 zod test; Scenario 1b PB storage accepts `frequency_days: null` |
| OOFT-02 | integration | Scenario 2 refetched.archived === true after completeTaskAction |
| OOFT-03 | unit + integration | Plan 11-01 zod refinement; Scenario 1b PB accepts due_date |
| OOFT-05 | unit + integration | Plan 11-02 task-scheduling OOFT branch tests; Scenario 2 computeNextDue returns null on archived |
| PREF-01 | unit + integration | Plan 11-01 schema + helper tests; Scenario 1c PB accepts preferred_days: 'weekend' round-trip |
| PREF-02 | unit | Plan 11-01 narrowToPreferredDays weekend/weekday matrix |
| PREF-03 | unit | Plan 11-01 empty-result test (caller widens — Phase 12 owns retry) |
| PREF-04 | unit | Plan 11-01 subset invariant test (never earlier than natural cycle) |
| SEAS-01 | unit + integration | Plan 11-01 isInActiveWindow + schema tests; Scenario 1c PB accepts active_from/to_month |
| SEAS-02 | unit + integration | Plan 11-02 seasonal-dormant unit tests; Scenario 3 Case C PB-live dormancy |
| SEAS-03 | unit + integration | Plan 11-02 seasonal-wakeup unit tests; Scenario 3 Cases A+B PB-live wake-up |
| SEAS-04 | unit + integration | Plan 11-01 wrap-aware isInActiveWindow 12-month matrix; Scenario 3 Case B cross-year math |
| SEAS-05 | unit | Plan 11-02 computeCoverage dormant-filter 4 tests (dormant-only → 1.0, year-round not excluded, mix → active-only mean, in-window included) |

Plus the 3 threats:
- **T-11-01** (accept per design): zod rejection at unit level only — PB storage accepts OOFT without due_date.
- **T-11-03** (mitigate): Scenario 2 live-fire of atomic archive on completion batch.
- **T-11-04** (mitigate): Scenario 3 Case B live-fire of cross-year-wrap year-selection math.
- **T-11-05** (accept — intended per D-17): Scenario 4 live-fire of override-over-dormancy.

Phase 11 ready for `/gsd-verify-work`.

## Commits

- `5508c8a` — `fix(11-03): accept frequency_days=0 as OOFT marker (PB 0.37.1 storage reality)`
- `d8d378d` — `test(11-03): add task-extensions integration suite on port 18099`

## Self-Check: PASSED

- `tests/unit/task-extensions-integration.test.ts` exists: FOUND (470 lines)
- `lib/task-scheduling.ts` modified: FOUND
- `lib/actions/completions.ts` modified: FOUND
- `tests/unit/task-scheduling.test.ts` modified: FOUND
- Commit 5508c8a exists: FOUND
- Commit d8d378d exists: FOUND
- Full test suite: 410 passed (0 failed)
- Type-check: clean
- Port 18099 uniquely claimed: verified (grep 18099 → 1 test file)
- Exactly 4 `test(` blocks in new file: verified
