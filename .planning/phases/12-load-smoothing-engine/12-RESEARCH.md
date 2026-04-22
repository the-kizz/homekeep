# Phase 12: Load-Smoothing Engine — Research

**Researched:** 2026-04-22
**Domain:** Algorithmic task-placement over a per-day household load map; extension of an existing pure scheduler (`computeNextDue`) with a new short-circuit branch plus two pure helpers; integration point inside an existing atomic PB batch.
**Confidence:** HIGH across the stack (all primitives pre-shipped in Phases 10+11 and verified end-to-end on port 18099; zero external dependencies introduced).

## Summary

Phase 12 is **mechanical assembly** over two well-understood primitive surfaces:
1. **Phase 10's atomic batch** in `completeTaskAction` (one more `tasks.update()` op — same error semantics, same rollback).
2. **Phase 11's pure helpers** (`narrowToPreferredDays`, `isInActiveWindow`, `nextWindowOpenDate`, `effectivePreferredDays`) — Phase 12 composes these as steps 2–3 of the placement pipeline, no rewrites.

The one genuinely new code surface is `placeNextDue(task, householdLoad, now, options): Date` — a pure function that (a) generates a tolerance window of candidate dates around natural ideal, (b) narrows by PREF, (c) widens forward by up to +6 days if PREF empties the window (per PREF-03), (d) scores remaining candidates by Map lookup against `householdLoad`, (e) picks via the three-tier tiebreaker chain (lowest-load → closest-to-ideal → earliest). It's O(11) candidate scoring — trivial relative to the <100ms budget.

`computeHouseholdLoad(tasks, now, windowDays=120): Map<string, number>` is a single-pass iterator over tasks that accumulates each task's effective next-due (via the same `computeNextDue` we're extending) into a home-tz-keyed ISO-date Map.

The two helpers live in a new file `lib/load-smoothing.ts` so the existing `lib/task-scheduling.ts` stays focused on `computeNextDue` branch composition and the 4 Phase 11 pure helpers.

**Hard gate (LOAD-15):** 21+ branch-composition tests are the heart of phase completion. Every CONTEXT D-16 case is enumerated below with the branch-order state needed to trigger it. The test matrix is a single file `tests/unit/task-scheduling.test.ts` append (keeping it as "single-file test-of-truth" per Phase 11 precedent) with a new `describe('branch composition matrix — LOAD-15 hard gate')` block.

**Primary recommendation:** Plan 4 waves — **(W1)** migration + pure helpers + unit tests → **(W2)** `computeNextDue` smoothed branch + call-site threading + branch-matrix tests (LOAD-15 gate) → **(W3)** `completeTaskAction` batch extension + OOFT/anchored bypass live-fire → **(W4)** disposable-PB integration suite on port 18100 (5 scenarios) + rider 1 validation harness + perf benchmark.

## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01..D-21 — all pre-locked via autonomous smart-discuss; no remaining grey areas)

**Data model**
- **D-01 (LOAD-01):** `tasks.next_due_smoothed DATE NULL` single additive field. Migration `1745280002_next_due_smoothed.js` (timestamp +1 from Phase 11's 1745280001). Post-construction `.fields.add()` pattern. No index. v1.0 rows get null → read-time falls through to natural via D-02.
- **D-02 (LOAD-02):** Branch order in `computeNextDue` after Phase 12: override → **smoothed (NEW)** → seasonal-dormant → seasonal-wakeup → OOFT → anchored/cycle-natural.
- **D-03 (LOAD-06 anchored bypass):** Anchored-mode tasks do NOT consult `next_due_smoothed` — guard `if (task.schedule_mode === 'anchored') skip smoothed branch` is authoritative. Anchored tasks STILL contribute to `computeHouseholdLoad`.

**Placement algorithm**
- **D-04 (LOAD-03 signature):** `placeNextDue(task, householdLoad, now, { preferredDays?, tolerance? }): Date`. Returns home-tz midnight. Pure — no I/O, no side effects.
- **D-05 (LOAD-04 tolerance default):** `tolerance = min(0.15 * frequency_days, 5)` days each side of natural ideal. Rider 1 validation may widen to 14.
- **D-06 (LOAD-05 PREF first, load second):** Narrowing order: (1) generate candidates = natural_ideal ± tolerance, (2) `narrowToPreferredDays(candidates, task.preferred_days)`, (3) if empty widen forward +1..+6, (4) score via `householdLoad.get(iso(date)) ?? 0`, (5) pick lowest → closest-to-ideal → earliest.
- **D-07 (LOAD-11 forward-only):** `placeNextDue` returns a date ONLY for the argument task. No other task's record is ever mutated inside placeNextDue.
- **D-08 (LOAD-12 tiebreakers — exact order):** Lowest score → closest-to-ideal → earliest. Fully ordered.

**Household load map**
- **D-09 (LOAD-14 signature):** `computeHouseholdLoad(tasks, now, windowDays): Map<string, number>`. Key = ISO `YYYY-MM-DD` in home tz. Value = task count. Default windowDays = 120.
- **D-10 (LOAD-08+09 load contributions):** Archived → SKIP. Dormant seasonal → SKIP. OOFT → `due_date`. Snoozed → `override.snooze_until`. Anchored → natural anchored date (LOAD-06). Cycle + smoothed → smoothed date. Cycle + null smoothed (v1.0 holdover) → natural next_due.
- **D-11 (LOAD-14 single query):** Single `pb.collection('tasks').getFullList({ filter: 'home_id = {:hid} && archived = false', fields: 'id,frequency_days,anchor_date,schedule_mode,preferred_days,active_from_month,active_to_month,due_date,next_due_smoothed' })`. Override Map passed in separately.
- **D-12 (LOAD-13 perf budget):** <100ms measured in `tests/unit/load-smoothing-perf.test.ts` via `performance.now()` delta for 100-task fixture.

**Integration points**
- **D-13 (LOAD-10 completion trigger):** Extend Phase 10+11 batch in `completeTaskAction`. Conditions: `schedule_mode === 'cycle' && !isOoft`. Append `batch.collection('tasks').update(task.id, { next_due_smoothed: iso(placedDate) })`. If placement throws → swallow, leave null (natural fallback).
- **D-14 (Phase 13 forward contract):** Task creation also triggers placement — Phase 12 ships ONLY completion trigger; creation is Phase 13.
- **D-15 (LOAD-07 seasonal wake-up handshake):** Seasonal wake-up branch fires BEFORE smoothed branch would consult `next_due_smoothed`. Written to `next_due_smoothed` only from second placement onward.

**Validation**
- **D-16 (Branch matrix — LOAD-15 hard gate):** 6 branches + 15+ meaningful interactions = 21+ tests total. See "Branch Composition Matrix" below.
- **D-17 (Rider 1 tolerance validation):** 30-task household seed; count clusters (3+ tasks same date); if total clusters > 7 widen default to `min(0.15 * freq, 14)`.

**Test scope**
- **D-18 (~25 unit + 5 integration):** 8 computeHouseholdLoad + 10 placeNextDue + 21+ branch matrix + 5 integration on port 18100.

**Migration + port**
- **D-19:** Migration timestamp 1745280002.
- **D-20:** Port 18100 claimed. Allocation log 18090..18100.

**Phase 13 forward-compat**
- **D-21 (TCSEM-01 contract):** `placeNextDue` is reused by `createTaskAction` in Phase 13 — Phase 12 ships the helper, Phase 13 wires creation.

### Claude's Discretion
- Raw-tasks vs pre-computed next-due Map for `computeHouseholdLoad` — **recommend raw tasks + internal loop** (Phase 13 TCSEM wants same signature).
- Benchmark harness choice — **recommend `performance.now()`** (cross-runtime).
- Window day count — **recommend 120** (covers annual tolerance=5; 365 is 3× slower with no benefit).
- Whether to emit telemetry on tolerance widening — **no** (no telemetry stack in v1.1).

### Deferred Ideas (OUT OF SCOPE)
- Task creation placement wiring — Phase 13 TCSEM.
- Horizon density visualization — Phase 16 LVIZ.
- Manual rebalance — Phase 17 REBAL.
- ⚖️ shifted-date badge UI — Phase 16.
- Effort/capacity weighting — v1.2+ (LOAD-V2-01..05).
- Telemetry on tolerance widening — no telemetry stack in v1.1.
- `placeNextDue` signature including `lastCompletion` directly vs deriving from `task.updated` — recommend explicit param for purity (documented in discretion above).
- Return type `{date, score, trace}` — Phase 16 debug territory; v1.1 returns `Date` only.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LOAD-01 | `tasks.next_due_smoothed DATE` nullable additive | §Standard Stack (PB 0.37.1 DateField required:false pattern verified in Phase 11 migration `1745280001`) |
| LOAD-02 | `computeNextDue` consults `next_due_smoothed` | §Architecture Patterns → "computeNextDue smoothed branch insertion" |
| LOAD-03 | Pure helper `placeNextDue` | §Architecture Patterns → "Placement algorithm pseudocode" |
| LOAD-04 | Tolerance `min(0.15*freq, 5)` initial | §Don't Hand-Roll (Math.min formula); §Rider 1 Validation Harness |
| LOAD-05 | PREF narrows BEFORE load scoring | §Architecture Patterns step 2 of pipeline; Phase 11 `narrowToPreferredDays` helper reused |
| LOAD-06 | Anchored bypasses smoothing | §Code Examples → "Anchored bypass guard"; D-03 read-time check |
| LOAD-07 | Seasonal wake-up anchors to window start | §Architecture Patterns → branch order D-02 (seasonal-wakeup short-circuits BEFORE smoothed for first cycle) |
| LOAD-08 | Snoozed tasks contribute snooze_until to load map | §Architecture Patterns → D-10 load contributions table |
| LOAD-09 | OOFT contributes to load map; own smoothed never set | §Architecture Patterns → D-10; §Completion batch extension (OOFT skips smoothed op) |
| LOAD-10 | Smoother runs on completion (creation is Phase 13) | §completeTaskAction batch extension |
| LOAD-11 | Forward-only — placement never mutates other tasks | §Architecture Patterns → D-07 contract; §Pitfalls → forward-only invariant preservation |
| LOAD-12 | Tiebreakers closest-to-ideal → earliest | §Code Examples → "tiebreaker chain"; D-08 |
| LOAD-13 | <100ms for 100 tasks | §Perf Benchmark Approach |
| LOAD-14 | `computeHouseholdLoad(tasks, now, windowDays)` single-query helper | §Architecture Patterns → "computeHouseholdLoad implementation strategy" |
| LOAD-15 | Branch composition test matrix — HARD GATE | §Branch Composition Matrix (21 cases enumerated) |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `tasks.next_due_smoothed` storage | Database / PocketBase | — | Same tier as the existing 4 Phase 11 task fields; additive DateField NULL. |
| `placeNextDue` / `computeHouseholdLoad` pure helpers | Shared lib (`lib/load-smoothing.ts`) | — | Pure — no I/O, no Date.now reads; same pattern as Phase 11's `isInActiveWindow` / `narrowToPreferredDays`. Callable from both server actions AND Phase 13 create flow AND Phase 17 rebalance without duplicating logic. |
| `computeNextDue` smoothed branch insertion | Shared lib (`lib/task-scheduling.ts`) | — | The branch lives with all other branches so `computeNextDue` stays the single source of truth for read-time next-due resolution. No change in callers. |
| Smoothed-date write on completion | API / Server action (`lib/actions/completions.ts`) | Database (atomic PB batch) | The atomic batch is the rollback guarantee; the server action is where the "fetch household state → place → append batch op" orchestration lives (needs PB client + home_id context from auth). |
| PB single-query household load fetch | Database / PocketBase | API / Server action | Single `getFullList` with field projection; the server action builds a `Task[]` array and hands it to the pure `computeHouseholdLoad`. |
| Perf benchmark | Test harness only | — | Pure in-memory; no PB roundtrip measured (that's a separate D-11 concern). |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `date-fns` | 4.1.0 (installed) | `addDays`, `differenceInDays`, date arithmetic for candidate generation | [VERIFIED: package.json] Already the project's canonical date math library. DST-safe over UTC epoch per Phase 2's established posture (see `lib/task-scheduling.ts:17-30`). |
| `date-fns-tz` | 3.2.0 (installed) | `formatInTimeZone`, `toZonedTime`, `fromZonedTime` for home-tz-keyed Map | [VERIFIED: package.json] Already imported by `lib/task-scheduling.ts` for Phase 11 seasonal branches. `formatInTimeZone(date, tz, 'yyyy-MM-dd')` is the idiom for ISO-date Map keys (see `lib/task-scheduling.ts:389` + audit addendum §Q3.1 example). |
| `pocketbase` | 0.26.8 (installed) | PB SDK for `getFullList` fetch of home tasks | [VERIFIED: package.json] Batch API + filter-binding already used throughout. |
| `zod` | 4.1.0 (installed) | Schema validation for new `next_due_smoothed` field | [VERIFIED: package.json] Phase 11 pattern — add `.date().nullable()` to the task schema in `lib/schemas/task.ts`. |

### Supporting (already in tree, no new installs)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | 4.1.4 (installed) | Unit + integration test runner | [VERIFIED: CLI output] Branch matrix + perf harness + integration on port 18100. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| date-fns `addDays` / `differenceInDays` | Native `Date.setUTCDate` + epoch math | Native is faster but the Phase 2 posture is explicit: "date-fns is DST-safe by construction over the UTC epoch — never do date math in a non-UTC zone." Cross-tier consistency wins. [CITED: lib/task-scheduling.ts:17-30] |
| `performance.now()` | `process.hrtime.bigint()` | `performance.now()` is cross-runtime (node + browser); `process.hrtime` is node-only. Phase 13 tests will run similarly — pick `performance.now()` for forward-compat. [CITED: CONTEXT.md §Claude's Discretion] |
| Storing smoothed date as `DATE` (midnight instant) | Storing as `DATETIME` | PB 0.37.1 DateField stores full ISO-8601 instant regardless of "date-only" intent; convention is midnight in home tz. Matches Phase 11's `due_date` exactly. [VERIFIED: `pocketbase/pb_migrations/1745280001_task_extensions.js` uses DateField for `due_date`] |

**Installation:**
```bash
# No new dependencies. All primitives already in package.json.
```

**Version verification:** (performed 2026-04-22 via `npm view`)
- `date-fns@4.1.0` — [VERIFIED: npm registry, confirmed current in package.json]
- `date-fns-tz@3.2.0` — [VERIFIED: npm registry, confirmed current in package.json]
- `pocketbase@0.26.8` — [VERIFIED: npm registry, confirmed current in package.json]
- `zod@4.1.0` — [VERIFIED: npm registry, confirmed current in package.json]
- `vitest@4.1.4` — [VERIFIED: `npx vitest --version` output]

## Architecture Patterns

### System Architecture Diagram

```
User taps "Complete" on task X
        │
        ▼
┌──────────────────────────────────┐
│ completeTaskAction(taskId)       │ lib/actions/completions.ts
│   1. ownership preflight         │
│   2. assertMembership            │
│   3. fetch lastCompletion        │
│   4. early-completion guard      │
│   5. snapshot area coverage      │
│   6. fetch activeOverride        │ Phase 10
│   7. fetch overridesByTask Map   │ Phase 10
│   ─── NEW Phase 12 step 7.5 ───  │
│   7.5a. IF task is cycle &&      │
│        frequency_days != null/0: │
│     - fetch ALL home tasks (1Q)  │ ← lib/load-smoothing.ts
│     - computeHouseholdLoad(...)  │   computeHouseholdLoad
│     - placeNextDue(task, load,…) │   placeNextDue
│     - append batch op:           │
│       tasks.update(id,           │
│         {next_due_smoothed:iso}) │
│   7.5b. ELSE (OOFT / anchored):  │
│     - skip placement (LOAD-06/09)│
│   ─────────────────────────────  │
│   8. batch.send() — atomic       │ Phase 10 pb.createBatch()
│   9. detectAreaCelebration       │
│   10. partner-completed ntfy     │
│   11. compute success-toast      │
│       next-due (computeNextDue)  │ ← now consults next_due_smoothed
└──────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────┐
│ PocketBase atomic transaction    │
│  - completions.create            │
│  - schedule_overrides.update     │ if active override
│  - tasks.update (archived=true)  │ if OOFT
│  - tasks.update (next_due_       │ ← NEW Phase 12
│       smoothed=iso)              │ if cycle && !OOFT
└──────────────────────────────────┘
        │
        ▼
Subsequent read via computeNextDue:
  archived → null
  override (Phase 10)? → snooze_until
  ─── Phase 12 smoothed branch ───
  schedule_mode === 'anchored'? → skip (D-03)
  next_due_smoothed set? → return that
  ─────────────────────────────────
  seasonal dormant (Phase 11)? → null
  seasonal wake-up? → nextWindowOpenDate
  OOFT (Phase 11)? → due_date / null
  cycle → base + frequency_days
  anchored → anchor_date + cycles
```

### Component Responsibilities

| File | Responsibility | Change Scope |
|------|----------------|--------------|
| `pocketbase/pb_migrations/1745280002_next_due_smoothed.js` | NEW — add `next_due_smoothed DATE NULL` field to `tasks`; idempotent down migration | Create |
| `lib/schemas/task.ts` | Extend zod schema with `.date().nullable()` for `next_due_smoothed` | Edit |
| `lib/load-smoothing.ts` | NEW — `computeHouseholdLoad` + `placeNextDue` pure helpers | Create |
| `lib/task-scheduling.ts` | Insert smoothed branch in `computeNextDue` between override and seasonal-dormant; widen `Task` type with `next_due_smoothed?: string \| null` | Edit |
| `lib/actions/completions.ts` | Add step 7.5 — fetch home tasks + placement + append batch op (conditional on cycle && !OOFT) | Edit |
| `lib/coverage.ts` | Zero change — `computeCoverage` already calls `computeNextDue` which now honors smoothed; reads are transparent | No change |
| `tests/unit/task-scheduling.test.ts` | Append 21+ branch-matrix cases (LOAD-15 hard gate) — single-file test-of-truth preserved | Edit |
| `tests/unit/load-smoothing.test.ts` | NEW — 8 `computeHouseholdLoad` cases + 10 `placeNextDue` cases | Create |
| `tests/unit/load-smoothing-perf.test.ts` | NEW — 100-task seed + `performance.now()` delta < 100ms assertion | Create |
| `tests/unit/load-smoothing-integration.test.ts` | NEW — 5 disposable-PB scenarios on port 18100 | Create |

### Recommended Project Structure
```
lib/
├── load-smoothing.ts          # NEW — computeHouseholdLoad + placeNextDue
├── task-scheduling.ts         # EDIT — insert smoothed branch
├── actions/
│   └── completions.ts         # EDIT — batch extension (step 7.5)
└── schemas/
    └── task.ts                # EDIT — add next_due_smoothed field

pocketbase/pb_migrations/
└── 1745280002_next_due_smoothed.js   # NEW

tests/unit/
├── task-scheduling.test.ts              # EDIT — 21+ branch matrix cases (LOAD-15)
├── load-smoothing.test.ts               # NEW — 18 unit cases
├── load-smoothing-perf.test.ts          # NEW — <100ms budget
└── load-smoothing-integration.test.ts   # NEW — 5 scenarios on port 18100
```

### Pattern 1: Placement algorithm pseudocode (D-06 pipeline)

**Source:** CONTEXT.md D-06 + audit-addendum-load.md §Q4.3 (PREF algorithm)

```typescript
// lib/load-smoothing.ts
import { addDays, differenceInDays } from 'date-fns';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';
import {
  narrowToPreferredDays,
  effectivePreferredDays,
  type Task,
  type Completion,
} from '@/lib/task-scheduling';

export type PlaceOptions = {
  preferredDays?: 'any' | 'weekend' | 'weekday';
  tolerance?: number;         // override default min(0.15*freq, 5)
  timezone?: string;          // home IANA tz for load Map key alignment
};

/**
 * Place the next due date for `task` given the current household load map.
 *
 * Pure. Returns a UTC-equivalent Date representing home-tz midnight on the
 * chosen ISO date. Caller writes the returned value as task.next_due_smoothed
 * (via atomic batch in completeTaskAction).
 *
 * Contract (LOAD-11 forward-only): returns the chosen date ONLY. Does not
 * mutate `task`, does not mutate `householdLoad`, does not read any other
 * task's record. Siblings don't re-smooth until their own completion event.
 *
 * Algorithm (CONTEXT.md D-06):
 *   1. naturalIdeal = lastCompletion.completed_at + frequency_days
 *                     (OR task.created + frequency_days if no completion)
 *   2. tolerance   = options.tolerance ?? min(0.15 * frequency_days, 5)
 *   3. candidates  = [naturalIdeal - tolerance .. naturalIdeal + tolerance]
 *                    step 1 day, inclusive, total = 2*tolerance + 1 dates
 *   4. filtered    = narrowToPreferredDays(candidates, effectivePref)
 *   5. if filtered.empty:
 *        widen forward +1..+6 from naturalIdeal until a matching weekday found
 *        (PREF-03 — caller-owned widening per Phase 11 D-09)
 *   6. scored      = filtered.map(d => ({d, score: load.get(iso(d, tz)) ?? 0}))
 *   7. pick via tiebreakers (D-08):
 *        a. lowest score wins
 *        b. among ties, smallest |d - naturalIdeal| wins (closest-to-ideal)
 *        c. among ties, earliest date wins (guarantees determinism)
 *
 * LOAD-06 anchored bypass: if task.schedule_mode === 'anchored', this
 * helper MUST NOT be called (guard at caller in completeTaskAction).
 * LOAD-09 OOFT bypass: if task.frequency_days is null or 0, this helper
 * MUST NOT be called (guard at caller). Unit tests include a throw if
 * invariants are violated — defense in depth.
 */
export function placeNextDue(
  task: Task,
  lastCompletion: Completion | null,
  householdLoad: Map<string, number>,
  now: Date,
  options: PlaceOptions = {},
): Date {
  // Invariant guards (defense in depth — callers already filter).
  if (task.schedule_mode === 'anchored') {
    throw new Error('placeNextDue: anchored tasks bypass smoothing (LOAD-06)');
  }
  if (task.frequency_days == null || task.frequency_days === 0) {
    throw new Error('placeNextDue: OOFT tasks bypass smoothing (LOAD-09)');
  }

  const freq = task.frequency_days;
  const baseIso = lastCompletion?.completed_at ?? task.created;
  const naturalIdeal = addDays(new Date(baseIso), freq);

  // Step 2: tolerance = min(0.15 * freq, 5) rounded down. Rider 1 may
  // widen the cap to 14 post-validation (see §Rider 1 Validation Harness).
  const tolerance = options.tolerance
    ?? Math.min(Math.floor(0.15 * freq), 5);

  // Step 3: generate candidate set (2*tolerance + 1 dates).
  const candidates: Date[] = [];
  for (let offset = -tolerance; offset <= tolerance; offset++) {
    candidates.push(addDays(naturalIdeal, offset));
  }

  // Step 4: PREF narrow (Phase 11 helper reused).
  const pref = options.preferredDays ?? effectivePreferredDays(task);
  let filtered = narrowToPreferredDays(candidates, pref);

  // Step 5: widen forward if PREF emptied the window (PREF-03).
  if (filtered.length === 0 && pref !== 'any') {
    for (let widen = 1; widen <= 6 && filtered.length === 0; widen++) {
      filtered = narrowToPreferredDays(
        [addDays(naturalIdeal, tolerance + widen)],
        pref,
      );
    }
    // Defensive: if after +6 still empty (shouldn't happen — at most 6
    // forward days always hits a weekend AND a weekday), fall back to
    // naturalIdeal itself.
    if (filtered.length === 0) filtered = [naturalIdeal];
  }

  // Step 6: score each candidate via Map lookup.
  const tz = options.timezone ?? 'UTC';
  const scored = filtered.map((d) => ({
    date: d,
    score: householdLoad.get(isoDateKey(d, tz)) ?? 0,
    distanceFromIdeal: Math.abs(differenceInDays(d, naturalIdeal)),
    time: d.getTime(),
  }));

  // Step 7: tiebreakers (D-08 — fully ordered).
  scored.sort((a, b) =>
    a.score - b.score
    || a.distanceFromIdeal - b.distanceFromIdeal
    || a.time - b.time,
  );

  return scored[0].date;
}

// Shared helper — also used by computeHouseholdLoad to ensure same
// ISO-date format on both write (Map build) and read (Map lookup).
export function isoDateKey(d: Date, timezone: string): string {
  return formatInTimeZone(d, timezone, 'yyyy-MM-dd');
}
```

**When to use:** Called once per completion (Phase 12) or once per task creation (Phase 13). Never in render path.

**Code provenance:** [VERIFIED: composes only Phase 11 exported helpers (`narrowToPreferredDays`, `effectivePreferredDays`) + date-fns primitives. No external API.]

### Pattern 2: computeHouseholdLoad implementation strategy

**Source:** CONTEXT.md D-09 + D-10 + D-11 + audit-addendum-load.md §Q3.1 pseudocode

```typescript
// lib/load-smoothing.ts (continued)
import {
  computeNextDue,
  isInActiveWindow,
  type Task,
} from '@/lib/task-scheduling';
import type { Override } from '@/lib/schedule-overrides';
import type { CompletionRecord } from '@/lib/completions';

/**
 * Build a per-day household load map (LOAD-14, D-09).
 *
 * Input: array of tasks already fetched via single PB query (D-11) plus
 * per-task override + completion lookups.
 *
 * Output: Map<ISODate-in-home-tz, count> where count is the number of
 * tasks whose effective next-due falls on that date.
 *
 * "Effective next-due" per D-10 contribution rules:
 *   - archived         → SKIP (excluded from map)
 *   - dormant seasonal → SKIP (null next_due; `isInActiveWindow` check)
 *   - OOFT             → due_date (if set)
 *   - snoozed          → override.snooze_until (via computeNextDue's
 *                        override branch — already returns this)
 *   - anchored         → natural anchored next_due (still LOAD-visible)
 *   - cycle + smoothed → next_due_smoothed
 *   - cycle + no smooth→ natural next_due (v1.0 holdover fallback)
 *
 * All of the above reduce cleanly to: `computeNextDue(task, last, now,
 * override, tz)`. We just call it and accumulate. The one exception is
 * dormant seasonal tasks — their `computeNextDue` returns null, so the
 * `if (!due) continue` guard naturally excludes them.
 *
 * windowDays: bound iteration — we DON'T include tasks whose effective
 * next-due is >windowDays out (they don't interact with placements in
 * the current tolerance window). Default 120 covers annual tasks with
 * ±5 tolerance (365+5=370 > 120; but a 365-day task's placement window
 * is local to its natural ideal ±5d, so tasks due >120d out can't be in
 * *this* placement's scoring window). Phase 17 REBAL may want 365; v1.1
 * default 120 per D-12 Claude's Discretion.
 *
 * Perf: O(T * W) where T = task count, W = 1 (one computeNextDue call
 * per task). 100 tasks × ~2μs per computeNextDue = <1ms. Dominated by
 * the upstream PB getFullList roundtrip (~30-50ms warm).
 */
export function computeHouseholdLoad(
  tasks: Task[],
  latestByTask: Map<string, CompletionRecord>,
  overridesByTask: Map<string, Override>,
  now: Date,
  windowDays: number = 120,
  timezone: string = 'UTC',
): Map<string, number> {
  const load = new Map<string, number>();
  const windowEnd = addDays(now, windowDays);

  for (const task of tasks) {
    if (task.archived) continue;

    // Dormant-seasonal check — cheap pre-filter avoids computeNextDue
    // call for tasks that definitionally don't contribute. This mirrors
    // computeCoverage's isDormant check in lib/coverage.ts:71-80.
    if (
      task.active_from_month != null
      && task.active_to_month != null
    ) {
      const nowMonth = timezone
        ? toZonedTime(now, timezone).getMonth() + 1
        : now.getUTCMonth() + 1;
      if (!isInActiveWindow(
        nowMonth,
        task.active_from_month,
        task.active_to_month,
      )) {
        // Seasonal-dormant with prior in-season completion — same as
        // computeNextDue would return null; skip.
        const last = latestByTask.get(task.id) ?? null;
        if (last) continue;
        // No completion → seasonal-wakeup branch fires; computeNextDue
        // returns nextWindowOpenDate which may be outside the window.
        // Fall through to computeNextDue call below.
      }
    }

    const last = latestByTask.get(task.id) ?? null;
    const override = overridesByTask.get(task.id);
    const due = computeNextDue(task, last, now, override, timezone);
    if (!due) continue;
    if (due > windowEnd) continue;  // bound iteration per windowDays

    const key = isoDateKey(due, timezone);
    load.set(key, (load.get(key) ?? 0) + 1);
  }
  return load;
}
```

**Why this strategy wins:** `computeNextDue` already encodes every LOAD-08..10 contribution rule (override branch → snooze_until; OOFT branch → due_date; seasonal-wakeup → window start; cycle → natural or smoothed). Re-using it is the DRY path; re-implementing the rules here would duplicate branch logic that's about to get a 6th branch inserted. The one thing we DO want fast-path is the dormant-seasonal skip, because `computeNextDue`'s seasonal-wakeup branch returns a non-null (far-future) date that would uselessly consume a Map slot.

### Pattern 3: computeNextDue smoothed branch insertion (exact code position)

**Source:** `lib/task-scheduling.ts:165-253` (current Phase 11 branch layout) + CONTEXT.md D-02

```typescript
// lib/task-scheduling.ts — INSERT BETWEEN override branch (line 196
// ending with `// else: stale override; fall through...`) AND the
// Phase 11 seasonal branches (line 198 `// ─── Phase 11 seasonal ...`)

// ─── Phase 12 smoothed branch (D-02, LOAD-02, LOAD-06) ───────────────
// The LOAD smoother picked this date on the last completion's batch
// commit. It already composes PREF + tolerance + tiebreakers per
// placeNextDue; we just return it.
//
// LOAD-06 anchored bypass (D-03): anchored tasks NEVER consult
// next_due_smoothed — even if one was mistakenly written (e.g. a task
// flipped from cycle → anchored mid-v1.1 before the caller re-fetched).
// The read-time guard is authoritative.
//
// LOAD-07 seasonal wake-up precedence (D-15): the seasonal-wakeup
// branch below fires BEFORE reading next_due_smoothed when the task
// has a window AND lastInPriorSeason is true — that way the first
// post-wake-up cycle anchors to window start. From the second cycle
// onward (same season, lastInPriorSeason = false), we fall through to
// the smoothed branch normally.
//
// v1.0 backcompat (T-12-03): NULL next_due_smoothed falls through to
// the natural cycle branch — byte-identical v1.0 behavior preserved.
if (
  task.schedule_mode !== 'anchored'
  && task.next_due_smoothed
) {
  // Wake-up precedence: if this task has a seasonal window and is
  // waking up (lastInPriorSeason), DON'T short-circuit here — let the
  // seasonal-wakeup branch below return nextWindowOpenDate. The
  // hasWindow + lastInPriorSeason computation lives in the seasonal
  // block; we inline the cheap check here to preserve D-15 handshake.
  const hasWindow =
    task.active_from_month != null && task.active_to_month != null;
  const treatAsWakeup = hasWindow && (
    !lastCompletion
    || wasInPriorSeason(
         new Date(lastCompletion.completed_at),
         task.active_from_month!,
         task.active_to_month!,
         now,
         timezone,
       )
  );
  if (!treatAsWakeup) {
    return new Date(task.next_due_smoothed);
  }
  // else: fall through to seasonal block — wake-up anchors to window.
}

// ─── Phase 11 seasonal branches (existing, unchanged) ────────────────
// ... existing code continues
```

**Why this position (override → smoothed → seasonal):** CONTEXT.md D-02 spells it out. Override (user intent) always wins. Smoothed (system placement) beats seasonal/OOFT/natural for normal cycle tasks. Seasonal wake-up is the ONE exception — it must beat smoothed because the wake-up date is a calendar landmark (start of active season), not a load-smoothing target (LOAD-07).

**Alternative considered:** Putting smoothed AFTER seasonal would require seasonal-wakeup to write `next_due_smoothed = null` on wake-up (to prevent a stale smoothed value from winning). That's a state-mutation coupling; the inline `treatAsWakeup` check keeps the branches independent and read-only. [VERIFIED: CONTEXT.md D-15 "From the second cycle onward, smoothing runs normally" — which implies second-cycle reads SHOULD return the smoothed value.]

### Pattern 4: completeTaskAction batch extension (where placement op goes)

**Source:** `lib/actions/completions.ts:200-281` (current Phase 10+11 batch layout) + CONTEXT.md D-13

**Insertion point:** Between the existing `const freqOoft = ...` guard (line 263-264) and `const results = await batch.send()` (line 281). The new code is conditional: only fires when the task is a cycle task with a valid frequency (not OOFT, not anchored).

```typescript
// lib/actions/completions.ts — INSERT BEFORE `const results = await batch.send()`

// ─── Phase 12 smoothed-date placement (D-13, LOAD-10) ────────────────
// Trigger conditions:
//   - task.schedule_mode === 'cycle' (LOAD-06: anchored bypassed)
//   - !freqOoft (LOAD-09: OOFT contributes to load map but never smoothed)
//
// Flow:
//   1. Fetch all non-archived home tasks (single PB query per D-11 —
//      7 fields projected to minimize payload).
//   2. Build latestByTask Map over the home (reuse getCompletionsForHome
//      pattern already loaded for area snapshot — but broaden scope to
//      home, not just area). Cheap: home tasks ≤ few hundred.
//   3. computeHouseholdLoad(homeTasks, latestByTask, overridesByTask,
//      now, 120, home.timezone)
//   4. placeNextDue(task, lastCompletion, householdLoad, now,
//      { preferredDays: task.preferred_days, timezone: home.timezone })
//   5. Append batch.collection('tasks').update(task.id,
//      { next_due_smoothed: placedDate.toISOString() })
//
// Error handling (D-13 rollback semantics): if placement throws (e.g.
// NaN date from corrupt freq_days or Map builder failure), swallow and
// LEAVE next_due_smoothed null (D-02 natural fallback is then live).
// NEVER fail the completion on a placement error — placement is
// best-effort; the completion itself must succeed.
//
// T-12-01 clock-skew: lastCompletion passed into placeNextDue is the
// one we JUST read (pre-completion); naturalIdeal = lastCompletion +
// freq is stable. Concurrent completer for the SAME task would race on
// the completions.create row (PB createRule + @request.auth.id gates)
// — one wins, one 4xx's. For DIFFERENT tasks, both placements compute
// independently (forward-only contract, D-07), which is the explicit
// design; convergence is eventual (next completion picks up the new
// load state).
if (
  task.schedule_mode === 'cycle'
  && !freqOoft
) {
  try {
    const homeTasks = (await pb.collection('tasks').getFullList({
      filter: pb.filter('home_id = {:hid} && archived = false', {
        hid: homeId,
      }),
      fields: [
        'id', 'created', 'archived',
        'frequency_days', 'schedule_mode', 'anchor_date',
        'preferred_days', 'active_from_month', 'active_to_month',
        'due_date', 'next_due_smoothed',
      ].join(','),
    })) as unknown as Task[];

    // Broad home-level completion + override Maps (reusing helpers
    // from Phase 10+11). The overridesByTask Map is already loaded
    // above for detectAreaCelebration — reuse it.
    const homeTaskIds = homeTasks.map((t) => t.id);
    const homeCompletions = await getCompletionsForHome(
      pb, homeTaskIds, now,
    );
    const homeLatestByTask = reduceLatestByTask(homeCompletions);

    const householdLoad = computeHouseholdLoad(
      homeTasks,
      homeLatestByTask,
      overridesByTask,  // Phase 10 Map — already in scope
      now,
      120,
      home.timezone as string,
    );

    // lastCompletion for the task-being-completed: the one we JUST
    // read at line 149-166 — reuse. placeNextDue computes naturalIdeal
    // = lastCompletion + freq.
    const placedDate = placeNextDue(
      task as Task,
      lastCompletion,
      householdLoad,
      now,
      {
        preferredDays: task.preferred_days as
          | 'any' | 'weekend' | 'weekday' | undefined,
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
    // Swallow — leave next_due_smoothed null, computeNextDue falls
    // through to natural cycle branch (D-02).
  }
}
// ─── end Phase 12 insertion ──────────────────────────────────────────

const results = await batch.send();
```

**Key design points:**
1. The home-tasks fetch happens INSIDE the try block — a failed fetch (PB down) doesn't poison the batch. Worst case we skip smoothing this cycle.
2. The batch.update op is appended BEFORE batch.send — it's part of the atomic transaction, so rollback extends to the smoothed-date write.
3. `overridesByTask` is already loaded at line 222 for detectAreaCelebration — reuse, no extra roundtrip.
4. `homeCompletions` IS a new fetch (Phase 10 only loaded area completions). Cost: one more `getFullList` over completions filtered by home task IDs. For a 100-task household this is <30ms warm — fits the <100ms budget comfortably.

### Anti-Patterns to Avoid

- **Caching householdLoad across placements:** Load state changes every completion. Staleness is a bug (placement picks a "sparse" day that was just filled by a concurrent completer). Build fresh per placement.
- **Retroactive re-smoothing of siblings:** Explicitly rejected by LOAD-11 / D-07. See §Pitfalls → "forward-only invariant preservation".
- **Storing the load Map:** It's ephemeral by design — `computeNextDue` reads only `next_due_smoothed` at read time, not the Map. Phase 16 LVIZ rebuilds the Map per render.
- **Swallowing placement errors silently:** `console.warn` is the minimum observability — CONTEXT.md §Claude's Discretion declines telemetry for v1.1, but operators still need grep-able failure evidence.
- **Using native `Date` arithmetic instead of date-fns:** Phase 2's posture is explicit (`lib/task-scheduling.ts:17-30`). DST-correct addDays/differenceInDays over UTC epoch.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Home-timezone date key extraction | Hand-rolled `year + '-' + month + '-' + day` with padding | `formatInTimeZone(d, tz, 'yyyy-MM-dd')` | DST-correct, matches coverage-ring + audit-addendum §Q3.1 pattern. date-fns-tz 3.2.0 already installed. |
| Weekend/weekday filtering | Hand-rolled `if (d.getDay() === 0 \|\| ...)` | `narrowToPreferredDays(candidates, pref)` | Phase 11 pure helper; unit-tested (31 cases per 11-01 SUMMARY); consistent with PREF semantic elsewhere. |
| Active-window check | `if (month >= from && month <= to)` | `isInActiveWindow(month, from, to)` | Handles cross-year wrap (Oct-Mar) correctly; Phase 11 unit-tested (12-month matrix per 11-03 SUMMARY Scenario 3 Case B). |
| Atomic multi-write semantics | Sequential writes with try/rollback | `pb.createBatch()` | PB 0.37 atomic batch — single transaction; Phase 10 pattern. |
| Tolerance formula | Ad-hoc `5` everywhere | `Math.min(Math.floor(0.15 * freq), 5)` | LOAD-04 spec. Also surfaces rider 1 validation point: widen cap to 14 if needed. |
| Cluster detection (rider 1) | Complex stats package | `Map.values().filter(v => v >= 3).length` | A "cluster" is just "3+ tasks on same date". Map already built. |
| Perf measurement | `Date.now()` with precision warning | `performance.now()` | Cross-runtime (node + browser for future tests); sub-ms resolution. |
| ISO date formatting for DateField writes | Hand-rolled ISO stripping | `date.toISOString()` | PB DateField accepts both `'YYYY-MM-DDTHH:MM:SS.sssZ'` (standard) and `'YYYY-MM-DD HH:MM:SS.sssZ'` (space-separated) per 11-03 SUMMARY §Decisions #4. Prefer toISOString for determinism. |

**Key insight:** Phase 12 is a composition phase. Every "hand-roll risk" is already solved upstream — the diligence is in *consuming* the right primitive at the right branch position, not inventing anything.

## Runtime State Inventory

**Not applicable — Phase 12 is a greenfield additive phase (new field + new helper + branch insertion). No rename, refactor, or migration of existing data.** The one state concern is the v1.0-holdover case (existing cycle tasks with `next_due_smoothed = NULL`) which is handled by D-02's natural-branch fallback — no backfill needed per T-12-03 mitigation.

## Branch Composition Matrix — LOAD-15 HARD GATE

**Test location:** Append to `tests/unit/task-scheduling.test.ts` under a new `describe('branch composition matrix — LOAD-15')` block. Each case is a single `test()` that fixes branch-state variables and asserts `computeNextDue` returns the expected value.

**Branches under test (6 total, per D-16 revision):**
1. Override (Phase 10)
2. Smoothed (Phase 12 NEW)
3. Seasonal-dormant (Phase 11)
4. Seasonal-wakeup (Phase 11)
5. OOFT (Phase 11)
6. Cycle-natural OR Anchored (same structural branch — split by `schedule_mode`)

**Branch precedence axis (6 tests):**

| # | Test Name | Fixture | Expected | REQ/D |
|---|-----------|---------|----------|-------|
| 1 | archived wins | `archived: true` + all other branch states set | `null` | existing |
| 2 | override wins over smoothed | active unconsumed override + next_due_smoothed set | `override.snooze_until` | D-02 |
| 3 | smoothed wins over seasonal-dormant (same-season) | next_due_smoothed set + in-window now + completion in-window | `next_due_smoothed` | D-02 |
| 4 | seasonal-wakeup wins over smoothed (first cycle or prior-season) | next_due_smoothed set + no completion (prior-season) + has window | `nextWindowOpenDate(...)` | D-15 |
| 5 | seasonal-dormant wins over OOFT | frequency_days=null + out-of-window + in-season completion | `null` (dormant) | existing + D-10 |
| 6 | OOFT wins over cycle-natural | frequency_days=null + due_date set + no completion | `due_date` | D-05 |

**Interaction axis (15+ tests — minimum for hard-gate green):**

| # | Test Name | Fixture | Expected | REQ/D |
|---|-----------|---------|----------|-------|
| 7 | override × smoothed × seasonal-dormant | active override + smoothed + out-of-window + in-season completion | `override.snooze_until` | D-17 + D-02 |
| 8 | override × OOFT | active override + freq=null + due_date | `override.snooze_until` | D-10 |
| 9 | smoothed × anchored (LOAD-06 bypass) | schedule_mode='anchored' + next_due_smoothed set (stale) + anchor_date in past | natural anchored date — ignores smoothed | D-03 |
| 10 | smoothed × PREF respect | smoothed written by placeNextDue honors preferred_days='weekend' | date falls on Sat/Sun | D-06 (indirect — placement test validates, this verifies read-side transparency) |
| 11 | smoothed × seasonal-wakeup first cycle | no completion + has window + next_due_smoothed set (stale from v1.0 holdover shouldn't occur but defensive) | `nextWindowOpenDate(...)` | D-15 |
| 12 | smoothed × cycle-natural (v1.0 holdover NULL) | next_due_smoothed=null + cycle mode + completion | `lastCompletion + freq` (natural) | D-02 + T-12-03 |
| 13 | OOFT × archived (post-completion) | freq=null + completion exists | `null` (completed OOFT archived by batch) | D-05 |
| 14 | OOFT contributes to load map, own smoothed stays null | computeHouseholdLoad includes OOFT's due_date; placeNextDue never called on OOFT | Map has entry on due_date; task.next_due_smoothed remains null | D-10 + LOAD-09 |
| 15 | snoozed task contributes snooze_until to load map (for OTHER tasks' placement) | computeHouseholdLoad inputs include snoozed task; output Map has entry on snooze_until | Map.get(iso(snooze_until)) === 1 | D-10 + LOAD-08 |
| 16 | anchored task contributes natural anchored date to load map (not smoothed) | anchored task w/ stale next_due_smoothed; computeHouseholdLoad skips smoothed, uses anchored date | Map.get(iso(anchored_next)) === 1; Map.get(iso(smoothed)) === 0 | D-10 + D-03 |
| 17 | post-completion: NULL smoothed before → non-null after | simulate completeTaskAction batch; assert pre-state = null, post-state = iso(placedDate) | tasks.update(next_due_smoothed) op exists in batch | D-13 |
| 18 | anchored bypasses smoothing but contributes to load | complete an anchored task; batch contains NO next_due_smoothed update; Map built from siblings includes this anchored's natural date | no tasks.update op; Map reflects date | D-03 + D-10 |
| 19 | seasonal-wakeup × anchored × PREF | anchored + has window + preferred_days='weekend' | natural anchored (no smoothing, no PREF narrowing — anchored always byte-identical v1.0) | D-03 |
| 20 | seasonal in-window past wake-up × smoothed | has window + lastInPriorSeason=false + in-window now + next_due_smoothed set | `next_due_smoothed` (second+ cycle reads smoothed per D-15) | D-15 |
| 21 | empty-PREF-window widen forward | placeNextDue called with preferred_days='weekend' but tolerance window contains only Tue-Thu | result date is next Sat or Sun (widen +1..+6) | D-06 step 5 + PREF-03 |

**Bonus edge cases encouraged (beyond 21):**
- 22: smoothed × override consumed (consumed_at set) → falls through to smoothed
- 23: tolerance=0 override via options (test param passthrough)
- 24: cycle task with freq=1 (daily) → tolerance floor(0.15) = 0 → single candidate → deterministic
- 25: 365-day task → tolerance min(54.75, 5) = 5 → 11 candidates

**Hard-gate acceptance:** All 21 mandatory cases green. Cases 22-25 are strongly encouraged but not phase-blocking.

## Rider 1 Tolerance Validation Harness

**Trigger:** Phase close, BEFORE `/gsd-verify-work`. If validation shows clustering > threshold, widen LOAD-04 default to 14 and update REQUIREMENTS.md + CONTEXT.md D-05.

**Test location:** `tests/unit/load-smoothing-integration.test.ts` Scenario 4 (per D-18). Runs on port 18100.

### 30-task seed composition (per D-17)

| Frequency (days) | Count | Purpose |
|------------------|-------|---------|
| 1 | 5 | Daily tasks — tolerance floor(0.15)=0 → effectively no smoothing available |
| 7 | 5 | Weekly — tolerance min(1.05, 5)=1 → 3 candidates |
| 14 | 5 | Biweekly — tolerance min(2.1, 5)=2 → 5 candidates |
| 30 | 5 | Monthly — tolerance min(4.5, 5)=4 → 9 candidates |
| 90 | 5 | Quarterly — tolerance min(13.5, 5)=5 → 11 candidates |
| 365 | 5 | Annual — tolerance min(54.75, 5)=5 → 11 candidates |

All tasks in a single home, all cycle-mode, no PREF restriction (preferred_days='any'), no seasonal window, no overrides. Clean smoothed-only scenario.

### Cluster-count logic

```typescript
// After 30 placements, build the final load map:
const finalLoad = computeHouseholdLoad(tasks, latestByTask, empty, now, 365, tz);

// A "cluster" is a date with 3+ tasks per D-17.
const clusters = [...finalLoad.values()].filter((count) => count >= 3).length;

// Threshold: 7 clusters for a 30-task household (D-17 says "> 7" triggers
// widening). Formula intuition: 30 tasks / 4 = 7.5 → clusters larger than
// this indicate the smoother didn't spread enough.
const needsWiden = clusters > 7;

if (needsWiden) {
  // A: fail the test with a clear message so phase can't ship stale
  //    tolerance cap.
  // B: log the cluster map so the decision has data.
  // C: emit a task for the planner: widen LOAD-04 to min(0.15*freq, 14).
  throw new Error(
    `Rider 1 validation FAILED: ${clusters} clusters found (threshold: 7). `
    + `Widen LOAD-04 default tolerance cap from 5 to 14. `
    + `Update lib/load-smoothing.ts:placeNextDue default + REQUIREMENTS.md `
    + `LOAD-04 text + CONTEXT.md D-05.`
  );
}
```

### Decision workflow

1. **Green (clusters ≤ 7):** Default ship as `min(0.15 * freq, 5)`. Document in 12-SUMMARY.md "Rider 1 validation: green, N clusters, default preserved."
2. **Red (clusters > 7):** Task executor updates:
   - `lib/load-smoothing.ts` default computation
   - `lib/load-smoothing.ts` JSDoc
   - `.planning/REQUIREMENTS.md` LOAD-04 text (change "5" → "14")
   - `.planning/phases/12-load-smoothing-engine/12-CONTEXT.md` D-05 text
   - Re-run the validation harness to confirm cluster count drops
   - Document in 12-SUMMARY.md "Rider 1 validation: widened to 14, N → M clusters"

### Seeded fixture determinism

For cluster count to be deterministic across test runs, the seed generator MUST:
- Use a fixed `now` (e.g. `new Date('2026-05-01T00:00:00.000Z')`)
- Use deterministic `task.created` offsets (e.g. all created at now - 1 hour, staggered by 1 minute)
- Use no completions for initial placement (first-cycle smoothing)
- Call `placeNextDue` sequentially, updating the in-memory load Map between placements (Phase 13 TCSEM pattern previewed here)

## Perf Benchmark Approach

**Test location:** `tests/unit/load-smoothing-perf.test.ts` (new file per D-18).

**Budget (LOAD-13):** <100ms for 100-task household, single `placeNextDue` call.

### Seed composition

100 tasks with mixed frequencies (reuse the 30-task D-17 distribution scaled ~3×):
- 15 tasks freq=1
- 17 tasks freq=7
- 17 tasks freq=14
- 17 tasks freq=30
- 17 tasks freq=90
- 17 tasks freq=365

All cycle mode, no PREF, no seasonal. Goal: exercise computeHouseholdLoad + placeNextDue under realistic 100-task load without noise from PB roundtrip (pure in-memory).

### Harness

```typescript
// tests/unit/load-smoothing-perf.test.ts
import { test, expect } from 'vitest';
import {
  computeHouseholdLoad,
  placeNextDue,
} from '@/lib/load-smoothing';
import type { Task } from '@/lib/task-scheduling';
import type { CompletionRecord } from '@/lib/completions';

test('LOAD-13 perf: 100-task placement completes in <100ms', () => {
  const now = new Date('2026-05-01T00:00:00.000Z');
  const tasks: Task[] = seedPerfTasks(100, now);
  // Half completed ~freq/2 ago, half fresh-new (no completion yet)
  const latestByTask = new Map<string, CompletionRecord>();
  // (seed builder fills both sets — see fixtures.ts)

  // Measure: build load map + single placement.
  const start = performance.now();
  const load = computeHouseholdLoad(
    tasks, latestByTask, new Map(), now, 120, 'UTC',
  );
  const target = tasks[0];
  const placed = placeNextDue(
    target,
    latestByTask.get(target.id) ?? null,
    load,
    now,
    { timezone: 'UTC' },
  );
  const elapsed = performance.now() - start;

  expect(placed).toBeInstanceOf(Date);
  expect(elapsed).toBeLessThan(100);

  // Expected observed range: 2-8ms on CI. 100ms is 12-50× headroom.
  // If this assertion fails, the algorithm has a quadratic blowup —
  // check computeHouseholdLoad's windowDays bound or placeNextDue's
  // candidate scoring loop.
});
```

**Why `performance.now()`:** sub-ms resolution, cross-runtime (node + browser for future Phase 16 LVIZ client-side benchmarks), already used in modern testing literature. `process.hrtime.bigint()` is node-only.

**What the benchmark does NOT measure:** PB roundtrip time (`getFullList` for 100 tasks). That's a separate concern addressed by D-11's "single query" rule. Production end-to-end time = ~3-5ms placement + ~30-50ms PB roundtrip = well under 100ms.

**Flakiness protection:** CI runners vary. The 100ms budget is 12-50× the expected observed time (~3-5ms per CONTEXT §code_context Performance realities). No retries needed; if it ever fails, that's signal.

## Integration Scenarios (Port 18100)

**Test location:** `tests/unit/load-smoothing-integration.test.ts` (new file per D-18). Follow Phase 11 Plan 11-03 exemplar — vi.mock plumbing, superuser-before-serve CLI dance, `--migrationsDir` + `--hooksDir` flags.

| # | Scenario | REQs | D-# |
|---|----------|------|-----|
| 1 | Migration shape: `next_due_smoothed` DateField present, required:false, accepts null + ISO write | LOAD-01 | D-01, D-19 |
| 2 | Completion flow E2E: cycle task complete → batch writes next_due_smoothed atomically; subsequent getOne shows the date | LOAD-10, LOAD-13 (partial — real PB) | D-13 |
| 3 | 100-task in-memory perf benchmark (shares file but pure in-memory, no disposable PB needed for this scenario) | LOAD-13 | D-12 |
| 4 | 30-task Rider 1 tolerance validation — cluster count ≤ 7 OR widen to 14 | LOAD-04, rider 1 | D-17 |
| 5 | v1.0 upgrade: existing cycle task with null smoothed completes → smoothed written; second completion reads smoothed branch | LOAD-02 + T-12-03 | D-02 |

**Boot pattern (verbatim reuse from 11-03 Plan):**
- Port 18100 (D-20 claimed)
- Superuser create BEFORE `serve` (Pitfall 9 WAL race)
- `--migrationsDir=./pocketbase/pb_migrations` picks up `1745280002_next_due_smoothed.js`
- `--hooksDir=./pocketbase/pb_hooks` picks up Whole Home hook (for area auto-seed)
- vi.mock for `next/cache`, `@/lib/pocketbase-server`, `@/lib/pocketbase-admin`

**Integration boot budget (from 11-03):** ~850ms beforeAll + ~100-150ms per scenario = 5 scenarios in ~2.5s. Fits Phase 12 duration expectations.

## Common Pitfalls

### Pitfall 1: Forward-only invariant preservation (LOAD-11 / D-07)

**What goes wrong:** Adding the smoothed branch makes it tempting to "also fix the load map" when a concurrent completion shifts the landscape. If `placeNextDue` ever mutated a sibling's `next_due_smoothed`, the forward-only contract breaks and the 100ms budget explodes (100-task cascade).

**Why it happens:** Seems "helpful" — the algorithm has fresh load info, why not update everyone? Because (a) cascading ripples, (b) user trust loss (silent date shifts), (c) SNZE inconsistency, (d) performance cliff. Per audit-addendum §Q3.5.

**How to avoid:**
- `placeNextDue` returns `Date` — NEVER a list of `{taskId, date}` pairs.
- `computeHouseholdLoad` returns `Map<string, number>` — NEVER modifies input tasks.
- Unit test: "placing task A does not read task B's next_due_smoothed" — verify via fixture with watchers.
- Contract test: snapshot all other tasks' `next_due_smoothed` values before + after `placeNextDue` — assert equal.

**Warning signs:** Any code in `placeNextDue` that iterates over *other* tasks (not just the target task). Any mutation of the input `householdLoad` Map (it's read-only).

### Pitfall 2: PB DateField null semantics for next_due_smoothed

**What goes wrong:** PB 0.37.1 DateField semantics for "unset" are inconsistent. On create with the field omitted, PB returns `null`. On update setting to empty string `''`, PB returns `''`. On update setting to null, PB returns `null`. On create with `'0001-01-01 00:00:00.000Z'` (PB zero-value), PB returns that string. Reading code that checks `!= null` may return true for all of these.

**Why it happens:** Go's time.Time zero value is not Go's nil, and PB's JSON marshaling reflects this. Phase 10's `consumed_at` A2 resolution covered this for schedule_overrides (line 46 of `lib/schedule-overrides.ts`: "PB 0.37.1 may return null, '', or undefined"). Same issue here.

**How to avoid:**
- Read-side: use truthy check `if (task.next_due_smoothed) return new Date(...)`. This treats `null`, `''`, `undefined`, and `'0001-01-01T00:00:00.000Z'`... wait, the PB-zero string is truthy. Defense: check `new Date(s).getTime() > 0` if strict. For v1.1, accept `new Date('0001-...')` resolves to year 1 AD, which never wins against a real computeNextDue date — safe fall-through.
- Write-side: always use `placedDate.toISOString()` — never `''`, never `null` (null would clear intentionally in Phase 17 REBAL; Phase 12 always writes a real date).
- Document in `lib/load-smoothing.ts` JSDoc: "placeNextDue never returns null — if invariants violated, it throws."
- Related: 11-03 SUMMARY §Decisions #4 documents PB accepting both `'YYYY-MM-DDTHH:MM:SS.sssZ'` and `'YYYY-MM-DD HH:MM:SS.sssZ'`. Prefer toISOString().

**Warning signs:** Tests that compare `task.next_due_smoothed === null` instead of `!task.next_due_smoothed`. Empty-string creeping in from admin UI clears.

### Pitfall 3: Clock skew between placements (T-12-01)

**What goes wrong:** Two concurrent completions (different tasks, same user) read the load map at slightly different instants. Task A's placement sees a Map that doesn't include task B's yet-to-land smoothed date. Task A picks a date that task B then also picks.

**Why it happens:** computeHouseholdLoad is a snapshot; two concurrent requests get two snapshots. Forward-only contract (D-07) says this is FINE — the next completion picks up the merged state and converges.

**How to avoid:**
- DON'T try to prevent — accept it as design.
- Unit test: two parallel placements on overlapping data yield valid (possibly-converging) dates.
- Document in `placeNextDue` JSDoc: "Convergence is eventual; concurrent placements may temporarily co-locate on the same date. The next completion cycle re-smooths them apart."
- Stress-test via integration scenario 5 if time permits (not blocking).

**Warning signs:** Production code attempting to lock or serialize completion writes. That's over-engineering; PB row-level uniqueness already handles the narrow case of same-task double-completion.

### Pitfall 4: Seasonal wake-up vs smoothed precedence confusion

**What goes wrong:** Inserting the smoothed branch BEFORE seasonal branches (per D-02) is correct for the common case but WRONG for seasonal wake-up — per D-15, wake-up must beat smoothed. Omitting the `treatAsWakeup` inline check inside the smoothed branch returns the stale smoothed value for a waking-up task.

**Why it happens:** It feels weird to have a branch that conditionally short-circuits based on downstream state. But it's the minimum-coupling solution — alternative is writing `next_due_smoothed = null` on wake-up, which is a state mutation.

**How to avoid:**
- Follow the exact code in §Pattern 3 — the `treatAsWakeup` check lives INSIDE the smoothed branch, not outside.
- Branch-matrix case #11 covers this ("smoothed × seasonal-wakeup first cycle").
- Unit test: seasonal task with stale smoothed + no completion + has window → returns nextWindowOpenDate, NOT the stale smoothed.

**Warning signs:** Any code path that writes `next_due_smoothed = null` in the seasonal-wakeup path. Keep it pure read-side.

### Pitfall 5: Anchored tasks with stale next_due_smoothed

**What goes wrong:** A task flipped from cycle → anchored mid-v1.1 may still carry an old `next_due_smoothed` from its cycle days. If the smoothed branch fires for anchored tasks, the result differs from v1.0 byte-identical behavior.

**Why it happens:** CONTEXT.md D-03 anticipates this: "`next_due_smoothed` may contain a stale value; read-time guard `if (mode === 'anchored') skip smoothed` is authoritative." But it's an easy bug to introduce — the conditional in §Pattern 3 must include `task.schedule_mode !== 'anchored'`.

**How to avoid:**
- Smoothed branch condition: `if (task.schedule_mode !== 'anchored' && task.next_due_smoothed) { ... }` — schedule_mode check FIRST.
- Branch-matrix case #9 covers this exactly ("smoothed × anchored LOAD-06 bypass").
- Unit test: anchored task + next_due_smoothed set to "2026-05-15" + anchor_date in past → computeNextDue returns natural anchored-cycle date, NOT "2026-05-15".
- Defense in depth: `placeNextDue` throws if called with `schedule_mode === 'anchored'` (catches the write-side bug).

**Warning signs:** Smoothed-branch conditional that checks only `task.next_due_smoothed` without the schedule_mode guard.

### Pitfall 6: OOFT `frequency_days = 0` storage quirk (inherited from Phase 11)

**What goes wrong:** PB 0.37.1 stores a cleared NumberField as `0` on the wire, not null (11-03 Deviation #1). Phase 12 code that checks `task.frequency_days === null` misses OOFT tasks with the 0 value.

**Why it happens:** PB coerces null writes to 0 for existing NumberField rows. Already handled in `lib/task-scheduling.ts` and `lib/actions/completions.ts` (Phase 11 Rule 1 fix).

**How to avoid:**
- Reuse Phase 11's `isOoft = task.frequency_days === null || task.frequency_days === 0` pattern exactly.
- Planner should call out: `placeNextDue` and `computeHouseholdLoad` MUST use this pattern when deciding to skip OOFT placement.
- Consider exporting a helper `isOoftTask(task)` from `lib/task-scheduling.ts` to centralize — 11-03 Handoff §6 recommends this.

**Warning signs:** `task.frequency_days === null` check anywhere in Phase 12 code. Fail in code review.

### Pitfall 7: Timezone-drift between load Map keys and placement output

**What goes wrong:** `computeHouseholdLoad` builds keys in home tz (`yyyy-MM-dd` formatted in home tz). `placeNextDue` must query with the SAME tz-aligned key. If one uses UTC and the other home tz, lookups silently miss.

**Why it happens:** Optional `timezone` param; easy to forget to pass through. Phase 11's seasonal branches already hit this — fixed via default 'UTC' fallback with acknowledged imprecision.

**How to avoid:**
- Shared helper `isoDateKey(d, tz)` used by BOTH functions.
- `placeNextDue` and `computeHouseholdLoad` take the SAME `timezone` option; caller passes `home.timezone` consistently.
- Branch-matrix case 10 indirectly catches (smoothed × PREF test fixture uses home tz explicitly).
- Integration scenario 2 uses a non-UTC home timezone (e.g. 'Australia/Perth') to catch drift.

**Warning signs:** Placement test where `tolerance=0` but result date is 1 day off from natural_ideal → tz mismatch between Map key and candidate lookup.

### Pitfall 8: windowDays bound omission

**What goes wrong:** Forgetting the `if (due > windowEnd) continue` check in `computeHouseholdLoad` means a 365-day task's far-future next-due populates a Map entry that will never be scored (no candidate in the current placement's tolerance window reaches it). Harmless but wasteful, and breaks O(T) → O(T × contributing_density).

**Why it happens:** Felt like a premature optimization.

**How to avoid:**
- Explicitly bound per D-11/D-12. Default 120 days covers the annual ±5 case AND leaves headroom for rider 1's potential ±14.
- Unit test: task with next_due 200 days out → NOT in the output Map.

**Warning signs:** Placement scoring that includes dates >windowDays out; or perf benchmark exceeds <100ms budget by >5× the expected value.

## Code Examples

### Anchored bypass guard (read-side)

```typescript
// lib/task-scheduling.ts — inside computeNextDue, between override
// branch and seasonal branches.

if (
  task.schedule_mode !== 'anchored'   // LOAD-06: anchored bypasses
  && task.next_due_smoothed             // LOAD-02: smoothed when set
) {
  // ... treatAsWakeup check per D-15 (see Pattern 3) ...
  return new Date(task.next_due_smoothed);
}
```

**Source:** Composition of CONTEXT.md D-02 + D-03 + D-15.

### Tiebreaker chain (sort-based)

```typescript
// lib/load-smoothing.ts — inside placeNextDue step 7.

const scored = filtered.map((d) => ({
  date: d,
  score: householdLoad.get(isoDateKey(d, tz)) ?? 0,
  distanceFromIdeal: Math.abs(differenceInDays(d, naturalIdeal)),
  time: d.getTime(),
}));

scored.sort((a, b) =>
     a.score - b.score                                   // D-08a
  || a.distanceFromIdeal - b.distanceFromIdeal           // D-08b
  || a.time - b.time,                                    // D-08c
);

return scored[0].date;
```

**Source:** CONTEXT.md D-08. [VERIFIED: fully deterministic — three-key sort, no Math.random, no external time reads.]

### Completion batch extension (write-side)

```typescript
// lib/actions/completions.ts — see §Pattern 4 for full code.
// Key shape: conditional batch.collection('tasks').update() appended
// BEFORE batch.send() per D-13.

if (task.schedule_mode === 'cycle' && !freqOoft) {
  try {
    const homeTasks = await pb.collection('tasks').getFullList({
      filter: pb.filter('home_id = {:hid} && archived = false',
        { hid: homeId }),
      fields: /* 10 fields per D-11 */,
    });
    const load = computeHouseholdLoad(
      homeTasks, homeLatestByTask, overridesByTask,
      now, 120, home.timezone,
    );
    const placedDate = placeNextDue(
      task, lastCompletion, load, now,
      { preferredDays: task.preferred_days, timezone: home.timezone },
    );
    batch.collection('tasks').update(task.id, {
      next_due_smoothed: placedDate.toISOString(),
    });
  } catch (e) {
    console.warn('[completeTask] placement failed:', (e as Error).message);
  }
}
const results = await batch.send();
```

**Source:** CONTEXT.md D-13 + existing `lib/actions/completions.ts:260-281` pattern.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| computeNextDue on demand without stored smoothed | Store `next_due_smoothed` on the task row (read-cheap) | v1.1 Phase 12 (this phase) | Read-time stays O(1); write-time adds single batch op per completion; v1.0 upgrade is zero-risk (NULL → natural fallback). |
| Retroactive re-smoothing of all tasks on any event | Forward-only smoothing (one task per event) | v1.1 audit addendum §Q3.5 (locked 2026-04-22) | Predictability > optimality; trust loss from silent date shifts rejected; Phase 17 REBAL is the manual escape hatch. |
| No tolerance window (all placements land on natural ideal) | Tolerance `min(0.15 * freq, 5)` — rider 1 validation may widen to 14 | v1.1 audit addendum §Q3.2 | Enables load spreading within "feels same as ideal" error bars. |
| Naive load = pure count per day | Same — no weighting for v1.1 | v1.1 (per addendum §Q3.1) | Effort weighting is deferred to LOAD-V2-01 in v1.2+. |
| SDST synthetic seed-stagger completions | Removed — TCSEM (Phase 13) smooths at creation via placeNextDue | v1.1 addendum | SDST was a special-case hack; TCSEM solves the general case (same helper reused). |

**Deprecated/outdated (in this phase's context):**
- Any notion of "re-smooth all tasks on a trigger event" — explicitly deferred to Phase 17 REBAL's manual button with preservation rules.
- Effort-aware weighting ideas (LOAD-V2-01..05) — deferred to v1.2+.
- Auto-trigger rebalance (REBAL-V2-03) — deferred to v1.2+.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | PB 0.37.1 accepts `DateField required:false` with explicit null writes and returns null on read | §Pitfall 2 | Medium — if PB returns `''` or Go-zero string, the `if (task.next_due_smoothed)` truthy guard still works correctly (both are falsy... wait, empty string is falsy but Go-zero `'0001-01-01T...'` is truthy). Mitigated by integration Scenario 1 which asserts null round-trip on unset field. [ASSUMED based on Phase 11 `due_date` DateField behavior in 11-03 integration — same field type; near-certain this holds.] |
| A2 | `pb.createBatch().send()` transaction rollback extends to the new `tasks.update(next_due_smoothed)` op identically to Phase 10+11's existing batch ops | §Architecture Patterns → batch extension | Low — Phase 10+11 proved batch atomicity end-to-end (Scenarios 9/10 of 10-03, Scenario 2 of 11-03). Adding one more op of the same shape is a well-understood extension. [VERIFIED: Phase 10+11 live-fire in 11-03 SUMMARY §Scenario 2 shows atomic multi-op batch rollback.] |
| A3 | Rider 1 cluster threshold of "> 7 for 30 tasks" is the correct validation tripwire | §Rider 1 Validation | Medium — this is a heuristic from CONTEXT D-17 ("household-of-30 fairness threshold"). If cluster count comes in at 6 (green) the decision is easy; at 8-10 the decision is also clear (widen). Edge case: exactly 7. Document observed distribution in 12-SUMMARY.md either way so future v1.2 effort-weighting has data. [ASSUMED based on CONTEXT D-17 formula intuition "30/4 = 7.5"; not an empirical threshold.] |
| A4 | `home.timezone` is always populated and valid on PB home records | §Pattern 2 + §Pitfall 7 | Low — Phase 5 migration set `homes.timezone` as required:true. Integration tests should use a non-'UTC' tz (e.g. 'Australia/Perth') to catch regressions. [VERIFIED: `pocketbase/pb_migrations/1714780800_init_homekeep.js` sets timezone required + default 'UTC'.] |
| A5 | `performance.now()` resolution is sub-millisecond on CI runners (GitHub Actions Linux/arm64/amd64) | §Perf Benchmark | Low — `performance.now()` on node 22 uses monotonic clock; resolution is typically 5μs on modern Linux kernels. 100ms budget with observed ~3-5ms = ample headroom for noisy runners. [VERIFIED: Node 22 docs — `performance.now()` uses `CLOCK_MONOTONIC`.] |
| A6 | Phase 16 LVIZ will rebuild the load Map per render (consuming `computeHouseholdLoad` read-side) — Phase 12 doesn't need to expose a cached Map | §Anti-Patterns | Low — Phase 16 consumes `next_due_smoothed` directly per LVIZ-03 description. Load Map is ephemeral by design. [ASSUMED based on LVIZ-01..05 REQ semantics in REQUIREMENTS.md.] |

**Follow-up:** A3 is the only Assumed claim with meaningful ambiguity. If Rider 1 validation lands in the borderline zone (5-9 clusters), discuss-phase resumption may want to revisit the threshold empirically after Phase 12 ships.

## Open Questions

1. **Should the `placeNextDue` helper be centralized as `isOoftTask(task)` helper exported from `lib/task-scheduling.ts`?**
   - What we know: Phase 11 Rule 1 fix encoded `frequency_days === null || === 0`. Phase 12 will need the same check in BOTH `placeNextDue` (throw on OOFT) AND the completion batch guard. Phase 13 will need it AGAIN in createTaskAction. That's 3 callsites.
   - What's unclear: Whether to export as a helper or keep the inline check.
   - Recommendation: **Export `isOoftTask(task)` from `lib/task-scheduling.ts`**. The 11-03 Handoff §6 already recommended this ("recommend centralizing via an exported helper if a second callsite needs it" — Phase 12 IS the second callsite). Low-risk, one-line helper, prevents drift.

2. **Should `computeHouseholdLoad` accept a pre-computed `Task[]` or fetch internally from PB?**
   - What we know: CONTEXT.md §Claude's Discretion recommends raw tasks + internal loop.
   - What's unclear: Slight ergonomic cost at every callsite — `completeTaskAction` is the only consumer in Phase 12, but Phase 13 + 17 will reuse.
   - Recommendation: **Raw Task[] + internal loop.** Keeps pure-helper contract; caller handles PB query. Matches recommendation in CONTEXT §Claude's Discretion + audit-addendum §Q3.1 pseudocode example.

3. **Integration Scenario 5 "v1.0 upgrade fidelity" — how to simulate a v1.0 task in disposable PB?**
   - What we know: Post-migration, a newly-created task has `next_due_smoothed = null` by default. That IS the v1.0 shape.
   - What's unclear: Do we need to explicitly reproduce a v1.0 migration path, or is "create with no next_due_smoothed" sufficient?
   - Recommendation: **"Create with no next_due_smoothed" is sufficient.** The migration is additive, field defaults to null. Scenario 5 just asserts: create cycle task, complete, see smoothed written; complete AGAIN, see smoothed read.

4. **Should placement errors emit structured telemetry or stay at `console.warn`?**
   - What we know: CONTEXT §Claude's Discretion says no telemetry in v1.1.
   - What's unclear: Nothing — this is locked.
   - Recommendation: `console.warn` only. Operators have `docker logs` for grep; that's sufficient for v1.1.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Test runner + build | ✓ | 22.22.0 | — |
| Vitest | Unit + integration tests | ✓ | 4.1.4 | — |
| date-fns | Date arithmetic (placement + load Map) | ✓ | 4.1.0 | — |
| date-fns-tz | Home-tz date key formatting | ✓ | 3.2.0 | — |
| PocketBase (dev binary) | Disposable-PB integration Scenario 1/2/4/5 | ✓ | 0.26.8 SDK + 0.37.1 binary at `./.pb/pocketbase` | — |
| zod | Schema extension for next_due_smoothed | ✓ | 4.1.0 | — |
| Port 18100 | Disposable-PB integration suite | ✓ | Next free (18090..18099 all claimed) | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

All stack primitives are already installed and proven through Phases 10+11 integration suites. No new installations, no new binaries. Zero blocking environment concerns.

## Validation Architecture (Nyquist Dimension 8)

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.4 |
| Config file | `vitest.config.ts` (Phase 1) |
| Quick run command | `npm test -- tests/unit/load-smoothing.test.ts tests/unit/task-scheduling.test.ts --run` |
| Full suite command | `npm test --run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LOAD-01 | Migration adds next_due_smoothed field | integration | `npm test -- tests/unit/load-smoothing-integration.test.ts --run` (Scenario 1) | ❌ Wave 0 |
| LOAD-02 | computeNextDue consults next_due_smoothed | unit | `npm test -- tests/unit/task-scheduling.test.ts --run` (branch-matrix cases 3, 12, 20) | EXISTS — append |
| LOAD-03 | placeNextDue helper behavior | unit | `npm test -- tests/unit/load-smoothing.test.ts --run` (10 placeNextDue cases) | ❌ Wave 0 |
| LOAD-04 | Tolerance formula min(0.15*freq, 5) | unit | `npm test -- tests/unit/load-smoothing.test.ts --run` (tolerance edge cases) | ❌ Wave 0 |
| LOAD-05 | PREF narrows before load scoring | unit | `npm test -- tests/unit/load-smoothing.test.ts --run` (PREF-narrow + empty-widen cases) | ❌ Wave 0 |
| LOAD-06 | Anchored bypasses smoothing | unit | `npm test -- tests/unit/task-scheduling.test.ts --run` (branch-matrix case 9) | EXISTS — append |
| LOAD-07 | Seasonal wake-up anchors to window start | unit | `npm test -- tests/unit/task-scheduling.test.ts --run` (branch-matrix cases 4, 11, 20) | EXISTS — append |
| LOAD-08 | Snoozed task contributes to load map | unit | `npm test -- tests/unit/load-smoothing.test.ts --run` (computeHouseholdLoad snoozed case) | ❌ Wave 0 |
| LOAD-09 | OOFT contributes, own smoothed never set | unit | `npm test -- tests/unit/load-smoothing.test.ts --run` + branch-matrix case 14 | ❌ Wave 0 + EXISTS append |
| LOAD-10 | Smoother runs on completion | integration | `npm test -- tests/unit/load-smoothing-integration.test.ts --run` (Scenario 2) | ❌ Wave 0 |
| LOAD-11 | Forward-only — no sibling mutation | unit | `npm test -- tests/unit/load-smoothing.test.ts --run` (forward-only contract test) | ❌ Wave 0 |
| LOAD-12 | Tiebreakers closest-to-ideal → earliest | unit | `npm test -- tests/unit/load-smoothing.test.ts --run` (tiebreaker chain cases) | ❌ Wave 0 |
| LOAD-13 | <100ms for 100 tasks | perf | `npm test -- tests/unit/load-smoothing-perf.test.ts --run` | ❌ Wave 0 |
| LOAD-14 | computeHouseholdLoad signature + contribution rules | unit | `npm test -- tests/unit/load-smoothing.test.ts --run` (8 computeHouseholdLoad cases) | ❌ Wave 0 |
| LOAD-15 | Branch composition matrix HARD GATE | unit | `npm test -- tests/unit/task-scheduling.test.ts --run` (21+ matrix cases) | EXISTS — append |

### Sampling Rate
- **Per task commit:** `npm test -- tests/unit/load-smoothing.test.ts tests/unit/task-scheduling.test.ts --run` (target test files — <5s typical)
- **Per wave merge:** `npm test --run` (full suite — 410 baseline + ~40 new = ~450 tests; ~30s)
- **Phase gate:** Full suite green + rider 1 validation explicit decision + perf budget green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/load-smoothing.test.ts` — 18 unit cases (8 computeHouseholdLoad + 10 placeNextDue)
- [ ] `tests/unit/load-smoothing-perf.test.ts` — perf benchmark harness (LOAD-13)
- [ ] `tests/unit/load-smoothing-integration.test.ts` — 5 disposable-PB scenarios on port 18100 (LOAD-01/-10/-13 integration, Rider 1, v1.0 upgrade)
- [x] `tests/unit/task-scheduling.test.ts` — already exists; append 21+ branch matrix cases (LOAD-15)
- No framework install needed — vitest 4.1.4 present.
- No fixture file centralization needed — each test file seeds inline per 11-03 pattern; shared fixtures live in `tests/fixtures/` if/when a second file needs the same 100-task seed (not required for v1.1).

**Verification gate:** LOAD-15 is the phase's explicit hard gate per ROADMAP §Phase 12 + CONTEXT §domain. The verifier cannot pass the phase until all 21 mandatory branch-matrix cases are green. The planner's PLAN.md MUST include an explicit acceptance criterion matching this.

## Security Domain

> Required per `security_enforcement` default-enabled (not explicitly disabled in config.json). Phase 12 is low-surface: pure helpers + one additive field + one branch insertion in an already-authenticated server action. No new external input, no new auth paths, no new user-controlled vectors.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No new auth surface — reuses Phase 2's PocketBase auth. |
| V3 Session Management | no | No new session state. |
| V4 Access Control | yes | Reuse Phase 10's tasks collection rules (member-gated). The new `tasks.update({next_due_smoothed})` op inherits the existing `updateRule` — no new rule needed, defense in depth. |
| V5 Input Validation | yes | `placeNextDue` input comes from a tasks.getFullList — not user-controlled. But `tolerance` option param (Phase 13 may allow user override via form) should be clamped. zod schema for new field = `z.string().datetime().nullable()`. |
| V6 Cryptography | no | No new crypto — no new secrets, no new tokens. |
| V7 Error Handling | yes | Placement errors swallowed to console.warn (D-13) — no sensitive info leaked. Batch failures fall through to the existing Phase 10 `formError: 'Could not record completion'`. |
| V12 Files + Resources | no | No file uploads, no resource exhaustion (perf budget bounded by LOAD-13). |
| V13 Business Logic | yes | Forward-only invariant is a business-logic contract (D-07); test via branch-matrix + unit. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| T-12-01 — Placement non-determinism from clock skew | Tampering / Repudiation | Forward-only contract (D-07) — each placement self-contained; convergence eventual. Integration scenario assertion. |
| T-12-02 — DoS via malicious task creation (10k tasks → OOM) | Denial of Service | Existing PB rate-limit on `*:tasks.create`; LOAD-13 budget asserted under 100-task realistic ceiling; households >100 is v2+ concern. |
| T-12-03 — v1.0 upgrade migration leaves next_due_smoothed NULL | Information Disclosure (of regression) | D-02 natural fallback — v1.0 read behavior byte-identical until first post-upgrade completion. Zero migration, zero risk. |
| T-12-04 — Placement picks past date | Tampering of schedule | naturalIdeal = `lastCompletion + frequency_days` is always in the future relative to lastCompletion; tolerance symmetric but result `>= now` by construction. Unit test: freq=1 task completed yesterday + high load → result is today or later, never yesterday-again. |
| T-12-05 (new) — Stale smoothed date on anchored task mid-v1.1 | Tampering (silent behavior change) | D-03 read-time guard `if (mode === 'anchored') skip smoothed`. Branch-matrix case #9 live-fires. |
| T-12-06 (new) — Placement writes use server-side `home.timezone` not user-controlled tz | Tampering | `timezone` param in `completeTaskAction` comes from `pb.collection('homes').getOne(home_id, {fields:'timezone'})` — server-side read via member-gated viewRule. User cannot inject an arbitrary tz to poison placement. |
| T-12-07 (new) — Malformed `next_due_smoothed` value poisons reads | Tampering (via direct PB admin access) | zod schema validation on write (`lib/schemas/task.ts` extended); PB DateField validates at storage layer (ISO parse). Admin-UI direct writes still validated. Defense in depth: `computeNextDue` truthy-checks and `new Date()` on read — invalid strings yield `Invalid Date` which falls through to natural branch (not a crash). |

**Explicitly deferred to Phase 17 REBAL:** any threat involving bulk re-smoothing. Phase 12 is single-task-per-event; surface is narrow.

## Sources

### Primary (HIGH confidence)
- `.planning/phases/12-load-smoothing-engine/12-CONTEXT.md` — all D-01..D-21 locked decisions + threat model T-12-01..04 + code insights
- `.planning/phases/11-task-model-extensions/11-CONTEXT.md` — branch order D-16 (Phase 12 inserts between override and seasonal)
- `.planning/phases/11-task-model-extensions/11-03-P01-SUMMARY.md` — 11-03 integration exemplar (port 18100 is next free; vi.mock plumbing pattern; OOFT freq=0 quirk documented §Rule 1)
- `.planning/v1.1/audit-addendum-load.md` — full LOAD spec; Q3.1 computeHouseholdLoad pseudocode; Q3.5 forward-only rationale; Q3.6 perf estimates; Q4.3 PREF algorithm
- `.planning/REQUIREMENTS.md` LOAD-01..15 + v1.1 phase distribution table
- `.planning/ROADMAP.md` §Phase 12 — success criteria + LOAD-15 hard gate + rider 1 validation methodology
- `.planning/STATE.md` — LOAD decisions log (forward-only, tolerance default, anchored bypass)
- `lib/task-scheduling.ts` (434 lines, Phase 11-extended) — current `computeNextDue` branch structure; §Pattern 3 shows exact insertion point
- `lib/actions/completions.ts` (392 lines, Phase 11-extended) — current batch structure; §Pattern 4 shows exact insertion point
- `lib/schedule-overrides.ts` (130 lines, Phase 10) — override helpers consumed by computeHouseholdLoad
- `lib/coverage.ts:62-100` — dormant-task filter precedent (reused in computeHouseholdLoad dormancy skip)
- `pocketbase/pb_migrations/1745280001_task_extensions.js` — Phase 11 additive-migration exemplar (Phase 12 migration follows identically)
- `pocketbase/pb_migrations/1745280000_schedule_overrides.js` — original Phase 10 pattern for timestamp and post-construction fields.add()
- `tests/unit/task-extensions-integration.test.ts` (470 lines, Phase 11) — port 18099 boot pattern + vi.mock plumbing to copy for port 18100

### Secondary (MEDIUM confidence — verified against multiple project sources)
- `package.json` — stack version verification (date-fns 4.1.0, date-fns-tz 3.2.0, pocketbase 0.26.8, zod 4.1.0, vitest 4.1.4)
- `.planning/config.json` — workflow flags confirming nyquist_validation enabled (absent key treated as enabled)
- 11-03 SUMMARY §Handoff for Phase 12 — forward-contract list (helpers exported, D-17 precedence, OOFT marker semantic)

### Tertiary (LOW confidence — flagged for verification during implementation)
- None — the entire research rests on in-repo sources and Phase 11 live-fire verified behavior. No external WebSearch, no Context7 lookups needed.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all primitives installed, proven across Phases 10+11.
- Architecture: HIGH — branch order + batch insertion point are in CONTEXT D-02/D-13 + explicit code locations pre-documented in `lib/task-scheduling.ts` comments ("Phase 12 will insert the `next_due_smoothed` LOAD branch here").
- Branch composition matrix: HIGH — 21 cases enumerated with specific fixture shape per D-16; every case ties to an existing REQ or locked decision.
- Placement algorithm: HIGH — pseudocode in CONTEXT D-06 + audit-addendum §Q4.3 matches; all steps use pre-shipped helpers.
- Perf budget: HIGH — CONTEXT §code_context cites similar-codebase observations of 3-5ms per placement; 100ms budget is 20-33× headroom.
- Rider 1 validation: MEDIUM — cluster threshold "> 7 for 30 tasks" is heuristic (A3 in assumptions log); decision methodology is clear but the exact threshold may want empirical tuning after observed distribution.
- Pitfalls: HIGH — all 8 pitfalls trace to concrete Phase 10+11 live-fire discoveries (especially Pitfall 6 OOFT=0 from 11-03 Rule 1 fix, Pitfall 2 PB null semantics from 10-02 A2 resolution).
- Security: HIGH — 7 threat patterns documented (4 from CONTEXT + 3 new Phase 12-specific); all are composition-level threats with existing mitigations.

**Research date:** 2026-04-22
**Valid until:** Phase 12 ships (target: within 1 week of research). Dependencies (PB 0.37.1, date-fns 4.1.0, Phase 10+11 contracts) are all stable for the next milestone; no invalidation risk from dependency churn.
