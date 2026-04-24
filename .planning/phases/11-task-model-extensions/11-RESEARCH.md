# Phase 11: Task Model Extensions — Research

**Researched:** 2026-04-22
**Domain:** PocketBase schema migrations + pure scheduler composition + zod cross-field refinement
**Confidence:** HIGH (stack/patterns verified against Phase 10 exemplar + PB 0.37.1 codebase conventions; zero new dependencies)

## Summary

Phase 11 is a **pure additive extension** of four existing concerns: (1) the `tasks` collection gains four nullable fields via the PB 0.37.1 post-construction `.fields.add()` pattern proven in Phase 10 and used by every migration in this repo; (2) `computeNextDue` absorbs three new branches (seasonal-dormant, seasonal-wakeup, OOFT) composed with Phase 10's override branch following the locked order in D-16; (3) `lib/schemas/task.ts` gains three cross-field refinements via zod `.refine()` with explicit `path:` per Pitfall 12; (4) `completeTaskAction` appends one conditional batch op, reusing Phase 10's `pb.createBatch()` transaction exactly. No new dependencies, no new external services, no UI. Every runtime surface the phase touches is already in the repo and instrumented with tests.

The high-risk surface is **cross-year wrap arithmetic in `isInActiveWindow`** (off-by-one bugs are easy to write and mask for months before anyone notices) and **zod cross-field refinement path routing** (a `.refine()` that forgets `path:` lands errors under the top-level `''` key and breaks RHF form-error wiring). Both are explicitly mitigated by the decisions in CONTEXT.md: D-20 makes the helper take a pre-extracted 1..12 month integer (no clock mocking, no timezone math inside the helper); D-21 routes every refinement through `path:`. The migration itself is byte-identical in shape to the Phase 10 `schedule_overrides` exemplar — the only new idiom introduced is calling `findCollectionByNameOrId('tasks')` + `collection.fields.add(...)` + `app.save(collection)`, which is already exercised five times in this repo's migration history (see `1714953603_users_view_rule_shared_home.js`, `1714953604_homes_onboarded.js`, `1714953605_users_notification_prefs.js`).

**Primary recommendation:** Ship Phase 11 as three waves — (1) migration + zod schema + helper scaffolding, (2) `computeNextDue` branch insertion + caller thread-through (coverage, completions), (3) integration tests on port 18099. Let the unit matrix in Wave 2 (~30 cases) be the forcing function for branch-order correctness; the integration test in Wave 3 is a thin sanity check that migration + helpers + scheduler compose end-to-end.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**OOFT first-due semantics (USER-LOCKED 2026-04-22):**
- **D-01 (OOFT-03 LOCKED):** Explicit "do by" date required at creation. Field: `tasks.due_date DATE NULL`. Validation: `due_date REQUIRED when frequency_days IS NULL` (app-layer via zod + migration rule). No separate "To-do list" surface. Option (b) `creation + 7 days` rejected. Option (c) separate list rejected.

**OOFT schema shape:**
- **D-02 (OOFT-01):** `tasks.frequency_days` becomes nullable. Migration: `allowEmpty: true` on existing NumberField. No backfill.
- **D-03 (OOFT-01+03):** `tasks.due_date DATE NULL` added. PB DateField, `required: false`, no default, no index. ISO-8601 UTC storage; render in home timezone at UI boundary (Phase 14/15).
- **D-04 (OOFT-02):** Atomic archive in `completeTaskAction` batch. When `task.frequency_days IS NULL`, append `batch.collection('tasks').update(task.id, { archived: true })` to Phase 10's existing `pb.createBatch()`.
- **D-05 (OOFT-03 read):** `computeNextDue` for OOFT returns `due_date` if `lastCompletion` is null, else null. No cycles.
- **D-06 (OOFT-05 LOAD contract):** OOFT contributes `1` to household load map on `due_date`; its own `next_due_smoothed` is NEVER set. Phase 12 consumes.

**PREF narrowing constraint:**
- **D-07 (PREF-01 data):** `tasks.preferred_days TEXT NULL`, enum `'any' | 'weekend' | 'weekday'`. PB SelectField, `required: false` (null = 'any' at read time). Helper `effectivePreferredDays(task)` abstracts the projection.
- **D-08 (PREF-02+04):** Hard narrowing constraint applied BEFORE LOAD scoring, never shifts earlier. Helper `narrowToPreferredDays(candidates, pref) → Date[]` filters the list; empty array = caller widens.
- **D-09 (PREF-03):** If narrowed candidates is empty, caller (Phase 12 LOAD) re-invokes with tolerance+1, +2, ... up to +6 days. Phase 11 ships narrow helper only.
- **D-10 (PREF × computeNextDue in Phase 11):** `preferred_days` does NOT affect `computeNextDue`'s natural-cycle branch in Phase 11. Narrowing happens in Phase 12's `placeLoadSmoothed`. Phase 11 ships data + helper only.

**SEAS seasonal-window dormancy:**
- **D-11 (SEAS-01):** Two integer fields `active_from_month` + `active_to_month`, both `1..12`, both null = year-round. PB NumberField `min: 1, max: 12, onlyInt: true, required: false`.
- **D-12 (SEAS-02+03):** New branches in computeNextDue. Branch order: override → (Phase 12 smoothed) → seasonal-dormant → seasonal-wakeup → OOFT → anchored/cycle-natural. Dormant: out-of-window AND has window AND lastCompletion exists → null. Wakeup: has window AND (no lastCompletion OR last completion in prior season) → next_due = start-of-window-date in home timezone at midnight.
- **D-13 (SEAS-04):** Window `active_from=10, active_to=3` = Oct-Mar (6 months active). Helper `isInActiveWindow(nowMonth, from, to): boolean` — if `from <= to` non-wrap; if `from > to` wrap: `month >= from || month <= to`.
- **D-14 (SEAS-05):** `computeCoverage` filters dormant tasks from mean — identical to archived treatment.
- **D-15 (SEAS × Phase 12 contract):** Seasonal wake-up anchors to start-of-window (skip smoothing for wake-up cycle only). Phase 12 consumes.

**Phase 10 composition:**
- **D-16 (Branch order after Phase 11):** Override (Phase 10) → Seasonal-dormant → Seasonal-wakeup → OOFT → Anchored/cycle-natural. Phase 12's smoothed branch lands BETWEEN override and seasonal.
- **D-17:** Override branch runs FIRST — overrides on dormant seasonal tasks win. Integration test covers.

**Helper API:**
- **D-18:** Pure helpers in `lib/task-scheduling.ts` (extending, not new file): `narrowToPreferredDays`, `isInActiveWindow`, `nextWindowOpenDate`.
- **D-19:** No new helper file for OOFT — it's a branch inside `computeNextDue`.
- **D-20:** `isInActiveWindow(monthOneIndexed, from?, to?)` signature — explicit month integer, no Date (testable without clock mocking).

**Validation:**
- **D-21:** Zod schema in `lib/schemas/task.ts` EXTENDED (not split). Refinements: `due_date REQUIRED when frequency_days IS NULL`; paired `active_from_month`/`active_to_month` (both set or both null); range check `1..12`.
- **D-22:** No past-date check on OOFT `due_date` at creation — legitimate for "I forgot this, do it ASAP".

**Migration:**
- **D-23:** Additive migration `1745280001_task_extensions.js` — single file, all Phase 11 fields. Timestamp +1 from Phase 10's `1745280000_schedule_overrides.js`. Post-construction `.fields.add()` per PB 0.37.1 workaround. Down migration removes the four new fields.
- **D-24:** No data backfill needed. Existing rows default to frequency_days preserved, due_date/preferred_days/active_from_month/active_to_month = null — byte-identical v1.0 path.

**Test scope:**
- **D-25:** ~30 new unit tests (8 OOFT + 8 PREF + 10 SEAS + 4 integration on port 18099).
- **D-26:** All 355 existing tests (311 baseline + 44 Phase 10) pass without assertion changes. Mechanical churn: zero.
- **D-27:** Port 18099 claimed. Allocation log now 18090..18099.

### Claude's Discretion
- Exact zod refinement message strings (plan-time detail).
- Whether to split test file (PREF tests vs SEAS tests) — recommend single `tests/unit/task-extensions.test.ts` + integration file on 18099.
- Field ordering inside migration file (recommend alphabetical for diff clarity).
- Whether to export `effectivePreferredDays` from `lib/task-scheduling.ts` — recommend export (Phase 12 needs it).
- Whether `isInActiveWindow` takes `month: number (1..12)` or `(0..11)` — recommend 1..12 to match PB stored shape.

### Deferred Ideas (OUT OF SCOPE)
- OOFT-04 (Form distinguishes recurring vs one-off) — Phase 15.
- SEAS-06 (Dormant tasks dimmed + "Sleeps until" badge) — Phase 14.
- SEAS-07 (Task form "Active months" section) — Phase 14.
- SEAS-08 (Form warns when anchored falls outside window) — Phase 14.
- SEAS-09 (Seed library seasonal pairs) — Phase 14.
- SEAS-10 (History always shows completions regardless of season) — Phase 14.
- PREF-* UI (preferred_days dropdown on task form) — Phase 14 or 15.
- LOAD consumption of PREF + OOFT + SEAS contracts — Phase 12.
- SPEC.md documentation of the 4 new fields — Phase 18 (DOCS-05).
- v1.2+: OOFT "To-do" separate surface; per-day-of-week PREF; multiple active windows per task.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OOFT-01 | User can create task without recurring frequency; `tasks.frequency_days` nullable | Migration §Migration Shape (allowEmpty on frequency_days); zod extension §Zod Schema Extension |
| OOFT-02 | One-off task auto-archives after first completion (atomic with completion write) | §Caller Updates (completeTaskAction batch append); §computeNextDue Branch Order (OOFT branch returns null post-completion) |
| OOFT-03 | One-off tasks have explicit due date at creation (per D-01 user lock) | Migration §Migration Shape (due_date DateField nullable); zod cross-field refine §Zod Schema Extension |
| OOFT-05 | One-off contributes 1 to LOAD density on due_date but is non-smoothable | §computeNextDue Branch Order (OOFT returns due_date, no smoothing); Phase 12 consumes via stored `due_date` field |
| PREF-01 | User can set per-task preferred_days (any / weekend / weekday) | Migration §Migration Shape (SelectField with 3 values); zod extension (optional enum) |
| PREF-02 | LOAD narrows candidate dates to preferred_days BEFORE load scoring | §Helper Signatures (narrowToPreferredDays); Phase 12 consumes this helper |
| PREF-03 | When tolerance window has no matching weekday, search widens forward 1-day increments up to +6 days | §Helper Signatures (narrow returns empty → caller widens); Phase 12 owns the retry loop |
| PREF-04 | Constraint never produces earlier date than natural cycle | §Helper Signatures (narrow filters input list — cannot produce earlier date than what caller passes in) |
| SEAS-01 | User can set active_from_month and active_to_month (both nullable; both null = year-round) | Migration §Migration Shape (two NumberFields min:1 max:12 onlyInt:true); zod paired refinement |
| SEAS-02 | Out-of-window tasks return null from computeNextDue (invisible everywhere) | §computeNextDue Branch Order (seasonal-dormant branch returns null) |
| SEAS-03 | Active window opens → computeNextDue returns start-of-window date in home timezone (smoothing skipped for wake-up, LOAD resumes from second cycle) | §computeNextDue Branch Order (seasonal-wakeup branch); §Helper Signatures (nextWindowOpenDate) |
| SEAS-04 | Cross-year wrap: window Oct→Mar correctly includes Dec, Jan, Feb | §Helper Signatures (isInActiveWindow wrap branch); §Common Pitfalls (off-by-one wrap) |
| SEAS-05 | Coverage ring excludes dormant tasks from its mean (treats like archived) | §Caller Updates (computeCoverage dormant filter) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

No `CLAUDE.md` file exists at the repository root. Project conventions are instead established by:
- **AGPL-3.0-or-later license headers** on every source file — preserve in all new files (see any file in `lib/` for the canonical `// SPDX-License-Identifier: AGPL-3.0-or-later` + `// HomeKeep (c) 2026 — github.com/the-kizz/homekeep` preamble).
- **Exact-pin dependencies** (no carets). Phase 11 adds zero dependencies so this is only relevant if something unexpected surfaces.
- **Pure-module discipline** for `lib/` scheduling/coverage/classification code: no I/O, no wall-clock Date construction, no Date.now inside the function — every call deterministic given its arguments. Phase 11 extensions must follow this.
- **Timezone discipline:** all date math on UTC-equivalent instants; rendering via `date-fns-tz.formatInTimeZone` at the UI boundary only. Phase 11's seasonal-wakeup branch needs a home timezone string to compute "first day of `active_from_month` in home timezone" — plan must pass timezone into `computeNextDue` OR extract the month comparison boundary at the caller level.
- **Port allocation register** for disposable-PB integration tests — next free is **18099** (claimed by D-27).
- **Agent skills:** `ui-ux-pro-max` skill is installed. NOT relevant to Phase 11 (no UI work); skill stays idle.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Task schema extension (4 new fields) | Database (PB) | — | New fields stored in PB SQLite; additive migration only. |
| Field validation (cross-field rules) | Frontend Server (server actions via zod) | Database (PB type constraints) | Zod refinements enforce cross-field rules (OOFT+due_date; paired SEAS months); PB NumberField `min:1 max:12` provides defense-in-depth on seasonal range. |
| `computeNextDue` branch extensions (OOFT/SEAS) | Pure lib (runs both client + server) | — | `lib/task-scheduling.ts` is a pure module; consumed by RSC pages + Client Components alike. No tier change. |
| `narrowToPreferredDays` / `isInActiveWindow` / `nextWindowOpenDate` helpers | Pure lib | — | New pure helpers alongside `computeNextDue`. Phase 12 LOAD and Phase 14 UI both consume. |
| `computeCoverage` dormant filter | Pure lib | — | `lib/coverage.ts` extension — filter step added before per-task health loop. |
| OOFT auto-archive on completion | Frontend Server (server action) | Database (PB batch) | `completeTaskAction` appends one conditional op to Phase 10's existing `pb.createBatch()`. Atomic at DB layer. |
| Test execution | Pure test (vitest) | Disposable PB process (port 18099) | Unit tests pure; integration test on port 18099 spawns disposable PB per Phase 10's pattern. |

## Standard Stack

### Core (already installed — no new packages)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pocketbase (JSVM migrations) | 0.37.1 | Additive field migrations on `tasks` | Repo baseline; Phase 10 exemplar verified this exact version's constructor quirks |
| pocketbase (JS SDK) | 0.26.8 | Batch API for atomic completion+archive | Phase 10 proved `pb.createBatch()` returns `Array<{status, body}>` (BatchRequestResult) — same contract reused |
| zod | 4.1.0 | Cross-field refinement on task schema | Already in use for task schema (`lib/schemas/task.ts`) — refinements extend existing `.refine()` pattern |
| date-fns | 4.1.0 | Date arithmetic (no new imports for Phase 11) | `addDays`, `differenceInDays` already used by `computeNextDue`; may add `startOfMonth` for wake-up |
| date-fns-tz | 3.2.0 | Home-timezone extraction for seasonal month boundary | Already used by `lib/band-classification.ts` and `completeTaskAction`; `toZonedTime` extracts month |
| vitest | 4.1.4 | Unit + integration test framework | 355 tests already passing on this version; Phase 11 adds ~30 |

### Supporting (referenced, not new)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@/lib/task-scheduling` | — | Existing `computeNextDue` | Extended in-place with new branches |
| `@/lib/coverage` | — | Existing `computeCoverage` | Extended with dormant filter |
| `@/lib/schemas/task` | — | Existing zod schema | Extended with 3 cross-field refinements |
| `@/lib/actions/completions` | — | Phase 10 batch pattern | Appended with conditional OOFT archive op |
| `@/lib/schedule-overrides` | — | Phase 10 `Override` type | Already consumed by `computeNextDue(override?)` — unchanged |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Post-construction `.fields.add()` | Pass fields to `new Collection({ fields: [...] })` constructor | **REJECTED** — PB 0.37.1 silently drops `fields`/`indexes` in the init object (02-01 deviation; 10-01 deviation). This is a forced choice, not a preference. |
| Single migration file for all 4 fields | One migration per field | **CHOSEN** (D-23) — keeps timestamp space dense, reduces boilerplate, down-migration atomic. |
| `preferred_days` as bool + weekday mask | SelectField with 3 string values | **CHOSEN** (D-07) — v1.1 keeps it simple; per-day granularity is explicit v1.2+ deferred idea. |
| `tasks.due_date` with index | No index | **CHOSEN** (D-03) — low cardinality per household; OOFT reads are never hot; saving index cost. |
| Separate OOFT helper file | Branch in `computeNextDue` | **CHOSEN** (D-19) — OOFT shape reads `task.due_date` + completion state; no reusable primitive to extract. |
| `isInActiveWindow(now: Date, task)` | `isInActiveWindow(month: 1..12, from?, to?)` | **CHOSEN** (D-20) — pure function, testable without clock mocking. Caller extracts `toZonedTime(now, tz).getMonth()+1`. |

**Version verification:**
```bash
# Already pinned in package.json — no registry queries needed for Phase 11.
# Versions verified against /root/projects/homekeep/package.json at 2026-04-22.
npm list pocketbase zod date-fns date-fns-tz vitest
#   pocketbase@0.26.8 (SDK) / pb_migrations run in PocketBase 0.37.1 server
#   zod@4.1.0
#   date-fns@4.1.0
#   date-fns-tz@3.2.0
#   vitest@4.1.4
```

All versions `[VERIFIED: /root/projects/homekeep/package.json]`. No new installs required.

## Architecture Patterns

### System Architecture Diagram

```
┌───────────────────────────────────────────────────────────────────┐
│   RSC Page / Server Action                                        │
│   ─ reads tasks from PB (fields: '*' already carries new cols)    │
│   ─ extracts home.timezone for seasonal-wakeup month boundary     │
└──────────────────────────┬────────────────────────────────────────┘
                           │ task, lastCompletion, now, override?, tz
                           ▼
┌───────────────────────────────────────────────────────────────────┐
│   lib/task-scheduling.ts :: computeNextDue                        │
│   (Pure module, extended with 3 new branches)                     │
│                                                                    │
│   1. archived?           → return null                            │
│   2. frequency validation→ throw                                  │
│   3. OVERRIDE     (P10)  → return snoozeUntil (D-06+D-10)         │
│   4. (P12 smoothed — reserved slot in branch order)               │
│   5. SEASONAL-DORMANT   →  return null        (D-12, new)         │
│      (out-of-window AND has window AND lastCompletion exists)     │
│   6. SEASONAL-WAKEUP    →  return start-of-window (D-12, new)     │
│      (has window AND (no lastCompletion OR last-in-prior-season)) │
│   7. OOFT                →  return due_date/null (D-05, new)      │
│      (frequency_days === null)                                    │
│   8. cycle / anchored   →  natural branch (unchanged from P10)    │
└──────────────────────────┬────────────────────────────────────────┘
                           │ Date | null
                           ▼
┌───────────────────────────────────────────────────────────────────┐
│   Downstream consumers                                            │
│   ─ lib/coverage.ts (extends: dormant filter pre-loop, D-14)      │
│   ─ lib/band-classification.ts (no change — reads Date|null)      │
│   ─ lib/scheduler.ts (no change — reads Date|null)                │
│   ─ lib/actions/completions.ts (extends: OOFT archive batch op)   │
└───────────────────────────────────────────────────────────────────┘

Data plane:
  tasks.frequency_days: int? 1 (nullable)                          NEW (was non-null)
  tasks.due_date: DATE?        ─────────── ┐                       NEW
  tasks.preferred_days: text? (enum)       ├─── migration 1745280001 NEW
  tasks.active_from_month: int? 1..12      ├                       NEW
  tasks.active_to_month:   int? 1..12      ┘                       NEW

Helpers (lib/task-scheduling.ts additions):
  narrowToPreferredDays(candidates, pref)  ─ Phase 12 consumes
  isInActiveWindow(monthOneIndexed, from?, to?)
  nextWindowOpenDate(now, from, to, tz)
  effectivePreferredDays(task) ─ null → 'any' projection
```

### Component Responsibilities

| File | Responsibility | Touched by Phase 11 |
|------|----------------|---------------------|
| `pocketbase/pb_migrations/1745280001_task_extensions.js` | Additive migration adding 4 fields + nullifying `frequency_days` | NEW |
| `lib/task-scheduling.ts` | Pure `computeNextDue` + new pure helpers | EXTENDED |
| `lib/coverage.ts` | Dormant-filter step added before per-task loop | EXTENDED |
| `lib/schemas/task.ts` | Cross-field refinements for OOFT + paired SEAS months | EXTENDED |
| `lib/actions/completions.ts` | OOFT auto-archive batch op appended | EXTENDED (1 conditional op) |
| `tests/unit/task-scheduling.test.ts` | +15 cases for OOFT + SEAS branches | EXTENDED |
| `tests/unit/coverage.test.ts` | +1 dormant-exclusion case | EXTENDED |
| `tests/unit/task-extensions.test.ts` | NEW — PREF helper + isInActiveWindow matrix | NEW |
| `tests/unit/task-extensions-integration.test.ts` | NEW — disposable PB on 18099, 4 lifecycle scenarios | NEW |

### Pattern 1: PB 0.37.1 Additive-Fields Migration (post-construction .fields.add)

**What:** Additive migration on an existing collection using the post-construction idiom. PB 0.37.1's Collection constructor silently drops `fields` / `indexes` passed in the init object — the only reliable way to add fields is `.fields.add(new FieldType({...}))` after construction.

**When to use:** Any migration that modifies an existing collection. Phase 11 adds 4 fields to `tasks`; the pattern is byte-identical to `1714953605_users_notification_prefs.js` (notification prefs extension).

**Example:**
```js
// Source: pocketbase/pb_migrations/1714953605_users_notification_prefs.js (verified in this repo)
migrate(
  (app) => {
    const tasks = app.findCollectionByNameOrId('tasks');

    // 1. Flip existing field nullable (OOFT-01). PB JSVM NumberField has no
    //    explicit "null the field"; the way to make a required NumberField
    //    nullable is to look it up and mutate its `required` property, then
    //    save. PB persists the change.
    const freq = tasks.fields.getByName('frequency_days');
    if (freq) {
      freq.required = false;
      // Note: `min: 1` stays — when present, validate >= 1. When null, skip.
    }

    // 2. Add 4 new nullable fields — post-construction pattern.
    tasks.fields.add(new DateField({ name: 'due_date', required: false }));
    tasks.fields.add(
      new SelectField({
        name: 'preferred_days',
        values: ['any', 'weekend', 'weekday'],
        maxSelect: 1,
        required: false,
      }),
    );
    tasks.fields.add(
      new NumberField({
        name: 'active_from_month',
        min: 1,
        max: 12,
        onlyInt: true,
        required: false,
      }),
    );
    tasks.fields.add(
      new NumberField({
        name: 'active_to_month',
        min: 1,
        max: 12,
        onlyInt: true,
        required: false,
      }),
    );

    app.save(tasks);
    // NO backfill needed (D-24) — existing rows read null for the new fields
    // and `frequency_days` retains its current non-null value.
  },
  (app) => {
    // DOWN — idempotent per Pitfall 10 (matches 1745280000 pattern).
    const tasks = app.findCollectionByNameOrId('tasks');
    const names = [
      'due_date',
      'preferred_days',
      'active_from_month',
      'active_to_month',
    ];
    for (const n of names) {
      const f = tasks.fields.getByName(n);
      if (f) tasks.fields.removeById(f.id);
    }
    // Flip frequency_days back to required
    const freq = tasks.fields.getByName('frequency_days');
    if (freq) {
      freq.required = true;
    }
    app.save(tasks);
  },
);
```

**One nuance to verify in Wave 0 of the plan:** PB 0.37.1's NumberField accepts `required: false` post-mutation on an existing field. This is how `1714953605_users_notification_prefs.js` adds optional fields; whether the same mutation works on an *already-required* existing field needs a 30-second integration smoke (write+save, re-read, assert `required === false`). If not, the fallback is to remove and re-add the field (loses zero data since the column is preserved — PB field removal is by ID, schema-only).

[VERIFIED: PB 0.37.1 `.fields.add()` post-construction pattern works — five migrations in this repo use it; `1714953605` most closely mirrors what Phase 11 needs]
[ASSUMED: mutating `required: true → false` on an existing NumberField via lookup-and-assign is supported in PB 0.37.1 — needs Wave 0 smoke confirmation]

### Pattern 2: computeNextDue Branch Order (after Phase 11)

**What:** The scheduler short-circuits through branches in a locked precedence order (D-16). Phase 11 inserts three new branches (seasonal-dormant, seasonal-wakeup, OOFT) between Phase 10's override and Phase 10's cycle/anchored natural branch.

**When to use:** Every call to `computeNextDue` in the codebase (BandView, coverage, scheduler, completion flow). Phase 11 does NOT change the signature — branches are added internally.

**Example (final Phase 11 shape — Phase 12 will later insert smoothed between override and seasonal-dormant):**
```typescript
// Source: lib/task-scheduling.ts (extends verified Phase 10 implementation)
export function computeNextDue(
  task: Task,
  lastCompletion: Completion | null,
  now: Date,
  override?: Override,
  // Phase 11 OPEN DECISION: does the signature grow a 5th param `timezone?: string`
  // for the seasonal-wakeup branch? See "Seasonal wake-up timezone plumbing" below.
): Date | null {
  if (task.archived) return null;

  // Frequency validation — only enforce the positive-integer guard when
  // the field is non-null. OOFT tasks (frequency_days === null) bypass.
  if (task.frequency_days !== null) {
    if (
      !Number.isInteger(task.frequency_days) ||
      task.frequency_days < 1
    ) {
      throw new Error(`Invalid frequency_days: ${task.frequency_days}`);
    }
  }

  // ─── Phase 10 override branch (unchanged) ──────────────────────────
  if (override && !override.consumed_at) {
    const snoozeUntil = new Date(override.snooze_until);
    const lastCompletedAt = lastCompletion
      ? new Date(lastCompletion.completed_at)
      : null;
    if (!lastCompletedAt || snoozeUntil > lastCompletedAt) {
      return snoozeUntil;
    }
  }

  // ─── Phase 12 smoothed branch (RESERVED slot — not yet implemented) ─
  // if (task.next_due_smoothed) return new Date(task.next_due_smoothed);

  // ─── Phase 11: seasonal-dormant branch (D-12) ──────────────────────
  // Task has an active window AND now is outside it AND a prior
  // completion exists → invisible. No prior completion means "first
  // cycle" which is the wake-up case (next branch).
  const hasWindow =
    task.active_from_month !== null && task.active_to_month !== null;
  if (hasWindow && lastCompletion) {
    // Month extraction in home timezone — caller supplies via tz param
    // OR we accept that the month boundary is "close enough" in UTC
    // (see "Seasonal wake-up timezone plumbing" for the decision).
    const nowMonth = extractMonthInHomeTz(now, task /* or tz param */);
    if (
      !isInActiveWindow(
        nowMonth,
        task.active_from_month!,
        task.active_to_month!,
      )
    ) {
      return null;
    }
  }

  // ─── Phase 11: seasonal-wakeup branch (D-12) ──────────────────────
  // Task has an active window AND (no lastCompletion OR lastCompletion
  // was in a prior season) → anchor to start-of-window in home tz.
  if (hasWindow) {
    const lastInPriorSeason = lastCompletion
      ? wasInPriorSeason(
          new Date(lastCompletion.completed_at),
          task.active_from_month!,
          task.active_to_month!,
          now,
        )
      : true; // null lastCompletion == "first cycle" — treat as prior season
    if (lastInPriorSeason) {
      return nextWindowOpenDate(
        now,
        task.active_from_month!,
        task.active_to_month!,
        /* tz */,
      );
    }
  }

  // ─── Phase 11: OOFT branch (D-05) ──────────────────────────────────
  // frequency_days === null → one-off task. Return due_date if no
  // completion, null otherwise (completed OOFT is archived by
  // completeTaskAction's batch, but race-condition safety returns null).
  if (task.frequency_days === null) {
    if (lastCompletion) return null;
    return task.due_date ? new Date(task.due_date) : null;
  }

  // ─── Cycle/anchored natural branch (unchanged from Phase 10) ───────
  if (task.schedule_mode === 'cycle') {
    const baseIso = lastCompletion?.completed_at ?? task.created;
    return addDays(new Date(baseIso), task.frequency_days);
  }

  // anchored — unchanged
  const baseIso = task.anchor_date ?? task.created;
  const base = new Date(baseIso);
  if (base.getTime() > now.getTime()) return base;
  const elapsedDays = differenceInDays(now, base);
  const cycles = Math.floor(elapsedDays / task.frequency_days) + 1;
  return addDays(base, cycles * task.frequency_days);
}
```

**Branch order rationale (why this exact order):**
1. **Override first (Phase 10, unchanged)** — user intent always wins; D-17 mandates override even on dormant seasonal tasks.
2. **Seasonal-dormant second (new)** — invisible tasks must be invisible before OOFT/natural branches compute a meaningless date. Return `null` early.
3. **Seasonal-wakeup third (new)** — a task waking from dormancy overrides its own natural cadence for the wake-up cycle.
4. **OOFT fourth (new)** — one-off logic is only relevant for `frequency_days === null` tasks; seasonal should never fire on OOFT (D-25 has no test case for "seasonal + OOFT" — they're orthogonal; if someone sets both, seasonal dormancy applies first then OOFT `due_date` is returned once window opens — but practically the user wouldn't combine these).
5. **Natural last (unchanged)** — cycle/anchored fallback.

### Pattern 3: Seasonal Wake-Up Timezone Plumbing

**What:** The seasonal wake-up branch needs to compute "first day of `active_from_month` in the home's timezone at midnight." This requires a timezone string.

**Two options (OPEN — plan must decide):**

- **Option A: Extend `computeNextDue` signature with 5th param `timezone?: string`.** Every caller already has home.timezone available (the RSC pages fetch home first, see `lib/actions/completions.ts:128-130`). Breaking change for tests (mechanical churn). No new dep.
- **Option B: Keep signature. Extract month and wake-up date at the caller.** Have the caller pass already-computed `currentMonthInHomeTz: number (1..12)` and `firstDayOfActiveWindowInHomeTz: Date | null` as parameters. Adds parameters but makes `computeNextDue` fully pure w.r.t. timezone.
- **Option C: Fallback — compute month/wake-up in UTC.** Works for most timezones (AEST/AEDT +8..+11 vs UTC month boundaries differ by ≤1 day). Accept the imprecision for v1.1; document as known limitation. Zero caller churn.

**Recommendation:** **Option A** — extend the signature once now (Phase 11) and lock the shape for Phase 12 (which will add `smoothed?` param anyway per CONTEXT.md D-07 forward-compat note). One round of mechanical churn across test files, not two.

Trade-off acknowledged: Option A introduces test-file churn; D-26 says "mechanical churn: zero". The reconciliation is that the 5th param defaults to `undefined`, and all existing call sites pass `undefined` — so behavior is byte-identical when tz is omitted, which matches the D-26 "zero" claim as long as the existing 44 Phase 10 test cases continue to omit tz. The new ~10 seasonal test cases pass tz explicitly.

[ASSUMED: Option A is acceptable to user — this needs confirmation. If user prefers zero-signature-change, fall back to Option B with a 5th param that's a computed-in-home-tz value.]

### Pattern 4: Pure Helpers Co-located in lib/task-scheduling.ts

**What:** Phase 11's three new pure helpers (`narrowToPreferredDays`, `isInActiveWindow`, `nextWindowOpenDate`) + one null-projection helper (`effectivePreferredDays`) live in the same file as `computeNextDue` (D-18). Keeps scheduling logic discoverable for Phase 12 LOAD's consumption.

**When to use:** Any scheduler-adjacent pure primitive. Matches the established pattern of co-locating pure logic (band-classification.ts has its own module, but its scheduler extension helpers live adjacent; coverage.ts imports from task-scheduling).

**Example:**
```typescript
// Source: lib/task-scheduling.ts (Phase 11 additions)

/** D-07: null preferred_days reads as 'any'. Projection helper. */
export function effectivePreferredDays(
  task: Pick<Task, 'preferred_days'>,
): 'any' | 'weekend' | 'weekday' {
  return task.preferred_days ?? 'any';
}

/**
 * D-08: hard narrowing constraint. Returns filtered candidate list.
 * Empty result means caller (Phase 12 LOAD) widens tolerance.
 *
 * Pure: no clock reads. date.getDay() returns 0..6 (0=Sun, 6=Sat) in
 * the Date's locale — since we operate on UTC-equivalent instants
 * (per module-level timezone posture doc), caller must pass candidates
 * already aligned to home-midnight-in-UTC. Phase 12 owns that alignment.
 */
export function narrowToPreferredDays(
  candidates: Date[],
  pref: 'any' | 'weekend' | 'weekday',
): Date[] {
  if (pref === 'any') return candidates.slice();
  return candidates.filter((d) => {
    const dow = d.getUTCDay(); // 0=Sun, 6=Sat
    const isWeekend = dow === 0 || dow === 6;
    return pref === 'weekend' ? isWeekend : !isWeekend;
  });
}

/**
 * D-13: active-window check, wrap-aware. Pure function on month integers.
 * Caller extracts month from Date in home tz via toZonedTime + getMonth()+1.
 *
 * Invariants:
 *   - month, from, to all in 1..12 (caller enforces; helper does not re-check).
 *   - from === to means a single-month active window (e.g. active Jan only).
 *   - from > to is a wrap window (e.g. 10-3 means Oct-Nov-Dec-Jan-Feb-Mar).
 *   - Either from or to is undefined/null → returns true (degenerate — caller
 *     should have short-circuited the "hasWindow" check, but defense-in-depth).
 */
export function isInActiveWindow(
  monthOneIndexed: number,
  from?: number | null,
  to?: number | null,
): boolean {
  if (from == null || to == null) return true;
  if (from <= to) return monthOneIndexed >= from && monthOneIndexed <= to;
  return monthOneIndexed >= from || monthOneIndexed <= to;
}

/**
 * D-12 wake-up: return the first day of active_from_month in home tz at
 * midnight. "First applicable year" = same year if now.month < from, else
 * next year. For wrap windows (from > to), the "next window open" is
 * always the from-month (wrap windows open on the from side).
 *
 * Edge: if now is already inside the window, `nextWindowOpenDate` still
 * returns the most recent from-month boundary (the caller — computeNextDue
 * seasonal-wakeup branch — only invokes this when last-in-prior-season).
 */
export function nextWindowOpenDate(
  now: Date,
  from: number,
  to: number,
  timezone: string,
): Date {
  // Extract home-tz year and month
  const zonedNow = toZonedTime(now, timezone);
  const nowYear = zonedNow.getFullYear();
  const nowMonth = zonedNow.getMonth() + 1; // 1..12

  // If window is still ahead this calendar year (from > nowMonth), same year;
  // else next year.
  const targetYear = nowMonth < from ? nowYear : nowYear + 1;

  // Construct the first-of-month at midnight in home tz, convert back to UTC
  const localMidnight = new Date(
    Date.UTC(targetYear, from - 1, 1, 0, 0, 0, 0),
  );
  return fromZonedTime(localMidnight, timezone);
}
```

[CITED: `lib/band-classification.ts` uses `fromZonedTime(startOfDay(toZonedTime(now, tz)), tz)` for similar tz-boundary math — Phase 11 follows the identical pattern]

### Pattern 5: Cross-Field Zod Refinement with Explicit Path

**What:** Zod schema extends `lib/schemas/task.ts` with three cross-field refinements. Every refinement uses `path: [...]` to route errors to the correct field for RHF form-error wiring (established pattern — see existing `.refine()` calls in task.ts, auth.ts, schedule-override.ts).

**When to use:** Any zod validation rule involving 2+ fields. If rules interact (OOFT due_date rule references frequency_days; paired SEAS months reference each other), they must each have a `.refine()` with explicit `path:`.

**Example:**
```typescript
// Source: lib/schemas/task.ts (extending verified Phase 2 schema)
export const taskSchema = z
  .object({
    // ...existing fields...

    // Phase 11 (D-02): frequency_days nullable.
    frequency_days: z
      .number()
      .int('Frequency must be a whole number')
      .min(1, 'Frequency must be at least 1 day')
      .nullable(),

    // Phase 11 (D-03): OOFT explicit "do by" date.
    due_date: z.string().nullable().optional(),

    // Phase 11 (D-07): preferred_days enum.
    preferred_days: z.enum(['any', 'weekend', 'weekday']).nullable().optional(),

    // Phase 11 (D-11): paired seasonal months.
    active_from_month: z.number().int().min(1).max(12).nullable().optional(),
    active_to_month: z.number().int().min(1).max(12).nullable().optional(),

    // ...rest of existing fields...
  })
  // Existing Phase 2 refine (anchor_date when anchored) — unchanged.
  .refine(
    (d) =>
      d.schedule_mode === 'cycle' ||
      (d.schedule_mode === 'anchored' &&
        typeof d.anchor_date === 'string' &&
        d.anchor_date.length > 0),
    {
      message: 'Anchor date required for anchored tasks',
      path: ['anchor_date'],
    },
  )
  // Phase 11 refine 1 (D-01, D-21): OOFT requires due_date.
  .refine(
    (d) => d.frequency_days !== null || (typeof d.due_date === 'string' && d.due_date.length > 0),
    {
      message: 'Due date required for one-off tasks',
      path: ['due_date'],
    },
  )
  // Phase 11 refine 2 (D-11, D-21): paired seasonal months.
  .refine(
    (d) => {
      const fromSet = d.active_from_month != null;
      const toSet = d.active_to_month != null;
      return fromSet === toSet; // both or neither
    },
    {
      message: 'Active months must be set together (both or neither)',
      path: ['active_from_month'],
    },
  )
  // Phase 11 refine 3: anchored + OOFT incompatible (OOFT-04 deferred to Phase 15
  // but defense-in-depth at schema layer avoids bad rows ever reaching storage).
  .refine(
    (d) => d.frequency_days !== null || d.schedule_mode !== 'anchored',
    {
      message: 'One-off tasks cannot use anchored mode',
      path: ['schedule_mode'],
    },
  );
```

[CITED: `lib/schemas/auth.ts` line 29, 44 — password/passwordConfirm refine uses `path: ['passwordConfirm']` to route to the confirm field. Phase 11 mirrors this.]

### Pattern 6: Atomic Batch Extension in completeTaskAction

**What:** Phase 10 built a `pb.createBatch()` that wraps (completion.create, schedule_overrides.update). Phase 11 appends one conditional op: when `task.frequency_days === null`, append `batch.collection('tasks').update(task.id, { archived: true })`.

**When to use:** OOFT completion only. The conditional is evaluated in-line; no new batch instantiation.

**Example (diff-style — shows the one addition):**
```typescript
// lib/actions/completions.ts — extend Phase 10 batch
const batch = pb.createBatch();
batch.collection('completions').create({
  task_id: taskId,
  completed_by_id: userId,
  completed_at: now.toISOString(),
  via: 'tap',
  notes: '',
});
if (activeOverride) {
  batch.collection('schedule_overrides').update(activeOverride.id, {
    consumed_at: now.toISOString(),
  });
}
// ──── Phase 11 (D-04): OOFT auto-archive in the same batch ────────
if (task.frequency_days === null) {
  batch.collection('tasks').update(task.id, {
    archived: true,
    archived_at: now.toISOString(),
  });
}
const results = await batch.send();
// results[0] = completion (existing); results[1] = override update if any;
// results[N] = task archive if OOFT. Order-dependent reads stay pinned to [0].
```

**Batch result ordering:** PB SDK 0.26.8 `Array<{status, body}>` in declaration order (verified in Phase 10, Plan 10-03 Scenario 9). The completion row is always `results[0]` — all downstream code that reads `results[0].body` remains correct. Phase 11's archive op lands at index 1 or 2 depending on whether an override was also consumed. Plan must not assume a fixed index > 0 without checking conditional paths.

### Anti-Patterns to Avoid

- **DO NOT:** Add fields via `new Collection({ ..., fields: [...] })` constructor form. PB 0.37.1 silently drops them. Documented 5+ times in this repo's migration deviations (02-01, 10-01). Always `.fields.add(...)` post-construction.
- **DO NOT:** Write `.refine()` without `path: [...]`. Pitfall 12 (Phase 2) — errors land under the top-level `''` key, RHF cannot wire them, form shows a mystery error.
- **DO NOT:** Put the seasonal month-boundary Date construction inside `isInActiveWindow`. Keep it at the caller (D-20). The helper takes a pre-extracted month integer, making it testable without `vi.useFakeTimers()` or timezone mocks.
- **DO NOT:** Hard-code weekend as "Sat, Sun" via `getDay() === 0 || 6` without annotation. UTC vs local-day difference can flip a weekend boundary near midnight. Use `getUTCDay()` consistently (matches `computeNextDue`'s UTC-equivalent posture).
- **DO NOT:** Write a new seasonal-awareness helper that mutates `now` or `Date.now()` inside its body. Every scheduling module in this repo is pure by invariant. Pass `now` explicitly.
- **DO NOT:** Call `getActiveOverride` inside the seasonal branches. Override is already fetched by Phase 10's helper BEFORE `computeNextDue`; its result is passed in via the `override?` param. Re-fetching would be a roundtrip in a pure path.
- **DO NOT:** Backfill existing rows with defaults. D-24 mandates "null-or-absent reads as v1.0 behavior." Writing defaults would cause a visible data migration that Phase 11's additive contract explicitly avoids.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-year wrap arithmetic | Nested if-else on month equality | `isInActiveWindow(month, from, to)` as D-13 pure fn | Off-by-one bugs mask for months. Single-function, 12x3 unit matrix. |
| Timezone month extraction | `new Date().getMonth()` from UTC | `toZonedTime(now, tz).getMonth() + 1` | Tasks at month boundaries in non-UTC timezones flip dormancy one day early/late. Established pattern in band-classification.ts. |
| Weekend/weekday classification | `date.getDay() === 0 \|\| 6` inline | `narrowToPreferredDays` + `getUTCDay()` | Mixing local and UTC days is a perennial bug source. Centralize via helper. |
| Paired field validation | Two independent refines | Single `.refine()` with `fromSet === toSet` | Two refines both trip with "only one is set" — surface shows two errors for one concept. |
| OOFT race-safe archive | Sequential `tasks.update` after completion write | Phase 10's `pb.createBatch()` atomic | Non-batch version can leave "completed but not archived" orphan rows on network failure. Phase 10's pattern is proven and already instrumented. |

**Key insight:** Every item in this table has an equivalent in the repo — Phase 11 reuses proven patterns, it does not invent. The research caution is entirely around *branch composition* (Phase 11's risk is integration, not novelty).

## Runtime State Inventory

**Phase type:** Additive schema extension + pure scheduler composition. Not a rename/refactor/migration of existing data. However, one category applies:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Existing `tasks` rows in PB (N per household). None carry Phase 11 field values. | **Code edit only.** Null/absent reads default to v1.0 behavior (D-24). No data migration. |
| Live service config | None — nothing external references task schema. | None — verified by grep for `tasks` and `frequency_days` in `.github/`, `docker/`, `scripts/` (returns only CI, Dockerfile, dev scripts — none of which hard-code field names). |
| OS-registered state | None — Phase 11 is pure TypeScript + PB JSVM migration. | None — verified by grep for `frequency_days`, `preferred_days`, `active_from_month`, `due_date` returning only source files in `lib/`, `components/`, `tests/`. |
| Secrets/env vars | None — no env var references task fields. | None — verified by grep in `.env.example`. |
| Build artifacts | None — Phase 11 adds no new build-time outputs. Vitest/Next.js bundles rebuild from source; migration runs at PB boot. | None. |

**Canonical verification:** *After every file in the repo is updated and the migration runs, what runtime systems still have the old schema cached?* Answer: **none.** PB's `app.save(tasks)` is atomic at the SQLite layer; the TypeScript consumers read schema-on-first-record-fetch (PB SDK does not cache schema). The migration is a one-time event; Phase 11 adds zero runtime state that outlives a deploy.

## Common Pitfalls

### Pitfall 1: Cross-year wrap off-by-one

**What goes wrong:** Task configured with `active_from=10, active_to=3` (Oct-Mar). Naive check `month >= from && month <= to` returns false for December (12 <= 3 is false), classifying December as dormant. User complains "my snow shovel task went dormant in winter."

**Why it happens:** The non-wrap formula `from <= to` doesn't apply when `from > to`. Easy to forget the wrap branch.

**How to avoid:** D-13's `isInActiveWindow` has a single line `if (from > to) return month >= from || month <= to`. D-25 requires 12 unit tests (one per month of an Oct-Mar task) — April through September assert dormant, October through March assert active. **Matrix is a hard gate:** any untested month is a future bug.

**Warning signs:** Unit tests that only test a non-wrap window (like Apr-Sep) — wrap branch stays untested. Integration test that happens to run in May (non-wrap works by accident for half the year).

### Pitfall 2: Zod cross-field refine missing path

**What goes wrong:** `.refine((d) => d.frequency_days !== null || d.due_date, { message: 'Due date required' })` without `path: ['due_date']`. Error lands under `''` top-level key. RHF's `errors.due_date` is undefined, form shows no error under the field — user sees a top-level banner or nothing. Validation appears broken.

**Why it happens:** The Pitfall 12 trap from Phase 2 — zod's default path is empty. D-21 mandates explicit `path:` on every new refine; plan must verify.

**How to avoid:** Every new `.refine()` in `lib/schemas/task.ts` must include `path: [...]`. Plan-checker should grep for `\.refine\(` in the PR diff and assert every block has a path.

**Warning signs:** Form submits, zod returns "failure" but RHF renders no error under the offending field. User reports "I can't submit but there's no error message."

### Pitfall 3: PB DateField nullability idioms

**What goes wrong:** PB 0.37.1 returns DateField as `null`, `''`, or sometimes `undefined` depending on how the row was created (A2 from Phase 10 Plan 10-01 — verified during integration). Code that checks `due_date === null` misses the empty-string case; code that checks `!due_date` may trip on legitimate future-date strings that accidentally start with `0` (not a real risk but false caution).

**Why it happens:** PB's underlying SQLite stores DateField as text; PB's SDK coerces empty strings sometimes. The safe check is `!value` (falsy covers null, '', and undefined).

**How to avoid:** Use `!task.due_date` when checking OOFT's "has a due date" semantic. Mirrors Phase 10's override `consumed_at` handling (10-02 Plan A2: `!override.consumed_at`).

**Warning signs:** OOFT task created, integration test creates it with `due_date = null`, code that checks `task.due_date !== null` returns "has date" even though none was set. Race-condition-style bug that masks in unit tests (where fixtures set `null` consistently) but trips in PB integration.

### Pitfall 4: Signature change explodes test-file churn

**What goes wrong:** If Phase 11 adopts Option A (5th timezone param), every existing test fixture that calls `computeNextDue(task, completion, now, undefined)` needs a 5th `undefined`. 44 call sites × mechanical edit = noisy diff, and D-26 says "mechanical churn: zero."

**Why it happens:** Each phase adds a param; existing call sites hold the line until they get revisited.

**How to avoid:** Make the 5th param optional with a safe default (undefined → caller falls back to UTC month extraction for seasonal tasks, which is "close enough" for v1.1 per non-goal-of-precision acceptance). Existing tests don't need to pass `undefined` — varargs allow omission. D-26 stays green.

**Warning signs:** TypeScript complains "Expected 5 arguments, got 4" — means the param wasn't declared optional.

### Pitfall 5: Seasonal-wakeup infinite loop (conceptual)

**What goes wrong:** User configures `active_from=13, active_to=0` (invalid). Zod catches, migration rejects, but if somehow a bad row lands in PB (admin UI bypass, direct DB write), `nextWindowOpenDate(now, 13, 0, tz)` produces an undefined Date OR an infinite "never opens" case.

**Why it happens:** Defense-in-depth gap between app-layer validation and storage integrity.

**How to avoid:** T-11-02 mitigates via migration `min: 1, max: 12`. Additionally, `isInActiveWindow` gets early return when `from == null || to == null`. `nextWindowOpenDate` assumes 1..12 per caller invariant; plan should document this assumption and have the seasonal-wakeup branch of `computeNextDue` check range before invoking.

**Warning signs:** Integration test seeds `active_from_month: 13` and watches for graceful rejection, not a crash.

### Pitfall 6: OOFT archive race vs subsequent create

**What goes wrong:** User completes OOFT at T=0 → batch writes completion + archive. User immediately (T=0.1s) tries to re-create the same task (say, accidental "undo"). If the race leaves the task un-archived during the brief window, the UI could show it as "completable" again. In practice, T-11-03 says Phase 10's atomic batch rolls back both ops on failure — the window doesn't exist.

**Why it happens:** Misreading atomicity — developers expect "completion landed" to commit individually, but Phase 10's model is all-or-nothing.

**How to avoid:** Integration test asserts: if PB rejects the archive op (say, task was deleted by another user mid-batch), the completion is also rolled back — not left orphaned. Plan must include this assertion in one of the 4 integration scenarios.

**Warning signs:** A test that asserts "completion succeeds, archive fails, state inconsistent" — that state should never exist.

## Code Examples

### Operation 1: Extract month in home timezone for seasonal check

```typescript
// Source: pattern established in lib/band-classification.ts (verified)
import { toZonedTime } from 'date-fns-tz';

function currentMonthInHomeTz(now: Date, timezone: string): number {
  return toZonedTime(now, timezone).getMonth() + 1; // 1..12
}
```

### Operation 2: Check "last completion was in prior season"

```typescript
// Phase 11 new helper — candidate for lib/task-scheduling.ts
/**
 * Returns true if lastCompletedAt's month was outside the active window,
 * OR if lastCompletedAt's month is in the window but a different "season
 * instance" than the current one (e.g., completed last November, now
 * waking in October of the next year — prior season).
 *
 * Simple implementation: if month-of-lastCompleted is out-of-window, TRUE.
 * If month-of-lastCompleted is in-window AND year delta + wrap means we've
 * since been dormant and are now waking, TRUE. Otherwise FALSE.
 *
 * Edge: if last completion was in-window within the same active season
 * (e.g., completed Oct 3, now Oct 15 of the same year), return FALSE —
 * that's not a wake-up, it's same-season continuation → cycle branch.
 */
function wasInPriorSeason(
  lastCompletedAt: Date,
  from: number,
  to: number,
  now: Date,
  timezone: string,
): boolean {
  const lastMonth = toZonedTime(lastCompletedAt, timezone).getMonth() + 1;
  if (!isInActiveWindow(lastMonth, from, to)) return true; // was dormant
  // In-window — check if there's been a dormancy gap between then and now
  // Simpler heuristic for v1.1: if lastCompletedAt is more than 1 year old,
  // we've definitionally crossed a dormancy gap. For shorter gaps, assume
  // same-season (cycle branch handles it).
  const daysSinceLast =
    (now.getTime() - lastCompletedAt.getTime()) / 86400000;
  return daysSinceLast > 365;
}
```

[ASSUMED: the "has there been a dormancy gap" detection with a 365-day heuristic is acceptable for v1.1. A more precise implementation walks forward from lastCompletedAt one month at a time checking dormancy — correct but slower. Plan-time decision.]

### Operation 3: Zod extension — paired seasonal months

```typescript
// Refine paired months: both set, or both null
.refine(
  (d) => (d.active_from_month == null) === (d.active_to_month == null),
  {
    message: 'Active from/to months must be set together',
    path: ['active_from_month'],
  },
)
```

### Operation 4: Migration — flip frequency_days nullable

```js
// Alternative if direct mutation doesn't work (Wave 0 smoke confirms):
// remove + re-add. SQLite column is preserved (PB field removal is
// metadata-only; data stays).
const tasks = app.findCollectionByNameOrId('tasks');
const freq = tasks.fields.getByName('frequency_days');
if (freq) {
  freq.required = false; // Direct mutation attempt
}
app.save(tasks);
// If direct mutation is rejected, fallback:
// tasks.fields.removeById(freq.id);
// tasks.fields.add(new NumberField({
//   name: 'frequency_days', min: 1, onlyInt: true, required: false,
// }));
// app.save(tasks);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Tasks always have frequency_days | Nullable frequency_days → OOFT path | Phase 11 | Data-model addition; v1.0 rows preserved |
| Single cycle/anchored branch in computeNextDue | Composed branches (override → seasonal-dormant → seasonal-wakeup → OOFT → cycle/anchored) | Phase 11 (Phase 12 inserts smoothed) | Scheduler becomes multi-branch; branch order is load-bearing |
| Coverage includes all non-archived | Coverage filters archived AND dormant | Phase 11 | SEAS-05; matches user intuition ("lawn isn't a problem in winter") |
| One-off workarounds via frequency=365 + archive manually | Native OOFT with explicit due_date + auto-archive | Phase 11 | Smaller mental model, no workarounds |

**Deprecated/outdated:**
- SDST (Seed Data Stagger Tasks) — removed from v1.1 addendum. Replaced by TCSEM (Phase 13).
- OOFT option (b) `creation + 7 days` — rejected in user-lock D-01.
- OOFT option (c) separate "To-do list" — rejected in user-lock D-01; may re-emerge in v1.2+.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | PB 0.37.1 NumberField `required: true → false` via direct mutation is supported | Pattern 1 (migration) | Plan Wave 0 smoke verifies. If rejected, fallback is remove+re-add (metadata only, data preserved). Low risk. |
| A2 | Option A (5th `timezone?` param on computeNextDue) is acceptable to user given D-26 "mechanical churn: zero" | Pattern 3 | Medium risk — if user rejects, plan pivots to Option B (compute seasonal boundary at caller); ~1 extra plan wave for caller threading. |
| A3 | 365-day heuristic for "dormancy gap detection" in wasInPriorSeason is acceptable for v1.1 | Code Examples §Operation 2 | Low risk — edge case only surfaces for tasks completed 12+ months ago in-window and now waking. Plan may opt for precise month-walk instead; cost is ~20 LOC. |
| A4 | The existing `fields: '*'` pattern used in most PB queries carries new Phase 11 columns without explicit listing | Integration Points (CONTEXT §Integration) | Low risk — verified by grep: callers use `'*'` or explicit field lists. A full audit of fields-list call sites is part of plan-checker. |
| A5 | Phase 11 adds zero new dependencies (stack verified against package.json) | Standard Stack | HIGH confidence. Verified by reading package.json — zod, date-fns, date-fns-tz already carry everything needed. |

## Open Questions

1. **Should `computeNextDue` gain a `timezone?` param now (Phase 11) or be deferred to Phase 12?**
   - What we know: seasonal-wakeup needs "first of active_from_month in home tz"; seasonal-dormant needs "current month in home tz". Both require tz.
   - What's unclear: Option A adds one param + optional-default shim. Option B pushes tz extraction to the caller.
   - Recommendation: **Option A** — do it now, lock the shape. Phase 12 will also add a `smoothed?` param; better to thread tz once than twice.

2. **Does the seasonal-wakeup branch need to honor the override "first" rule even for `null` lastCompletion?**
   - What we know: D-17 says override always fires first. D-12 says wake-up fires when `no lastCompletion OR last in prior season`.
   - What's unclear: if a user creates a seasonal task AND snoozes it immediately (bizarre but possible), does the override date win over the wake-up-to-October-1 semantic?
   - Recommendation: **Yes, override wins** (branch order is unambiguous — override is branch 3, seasonal-wakeup is branch 6). Document in a unit test: "override on an unborn-seasonal task respects override date, not wake-up date."

3. **Wave 0 smoke for PB NumberField required-mutation.**
   - What we know: PB 0.37.1 allows post-construction `.fields.add()` for new fields.
   - What's unclear: does mutating `required` on an already-registered field persist through `app.save(collection)`?
   - Recommendation: **Include as Wave 0 smoke test in the migration plan** — 30-second disposable PB smoke. If it fails, fallback to remove+re-add (no data loss since SQLite column persists).

4. **Integration test Scenario 11 — "override on dormant seasonal task."**
   - What we know: D-17 mandates override beats dormancy. Phase 15 UI will warn; Phase 11 data layer accepts.
   - What's unclear: does the ~30-unit-test budget cover this interaction explicitly?
   - Recommendation: **Add one case** to the SEAS matrix — "dormant seasonal + active override → computeNextDue returns override.snooze_until (not null)". Brings D-25 count to ~31 — still within the "~30" budget.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PocketBase binary | Integration tests (disposable-PB) | ✓ | 0.37.1 at `./.pb/pocketbase` | — |
| Node.js | Test runner (vitest + spawn) | ✓ | ≥22.0.0 (package.json engines) | — |
| Vitest | Unit + integration test framework | ✓ | 4.1.4 | — |
| zod | Cross-field refinement | ✓ | 4.1.0 | — |
| date-fns | Date arithmetic (addDays, differenceInDays, startOfMonth?) | ✓ | 4.1.0 | — |
| date-fns-tz | Home tz extraction (toZonedTime, fromZonedTime) | ✓ | 3.2.0 | — |
| TypeScript | Type-check | ✓ | 6.0.3 | — |
| PB JSVM runtime | Migration runtime | ✓ | embedded in PB 0.37.1 | — |
| Network access for Phase 11 | None — fully offline | ✓ | — | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

Phase 11 is fully implementable against the current toolchain. Zero new installs.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.1.4 |
| Config file | `vitest.config.ts` (repo root) |
| Quick run command | `npm test -- tests/unit/task-scheduling.test.ts tests/unit/task-extensions.test.ts tests/unit/coverage.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| OOFT-01 | Nullable frequency_days accepted by schema + DB | unit + integration | `npm test -- task-extensions-integration.test.ts -t "OOFT"` | NEW (Wave 0: tests/unit/task-extensions-integration.test.ts) |
| OOFT-02 | One-off auto-archives atomically with completion | integration | `npm test -- task-extensions-integration.test.ts -t "archive"` | NEW |
| OOFT-03 | Zod rejects OOFT without due_date; accepts with past due_date | unit | `npm test -- task-extensions.test.ts -t "zod OOFT"` | NEW |
| OOFT-05 | computeNextDue returns due_date for unborn OOFT, null post-completion | unit | `npm test -- task-scheduling.test.ts -t "OOFT branch"` | EXISTS (extend) |
| PREF-01 | Schema accepts any/weekend/weekday; null reads as 'any' | unit | `npm test -- task-extensions.test.ts -t "effectivePreferredDays"` | NEW |
| PREF-02 | narrowToPreferredDays filters correctly (weekend keeps Sat/Sun; weekday drops Sat/Sun) | unit | `npm test -- task-extensions.test.ts -t "narrowToPreferredDays"` | NEW |
| PREF-03 | narrowToPreferredDays returns empty when no match (caller widens in Phase 12) | unit | `npm test -- task-extensions.test.ts -t "narrow empty"` | NEW |
| PREF-04 | narrow never produces earlier date (trivially true — filters input list) | unit | `npm test -- task-extensions.test.ts -t "narrow identity"` | NEW |
| SEAS-01 | Schema accepts paired active_from/to months; rejects one-set-one-null | unit | `npm test -- task-extensions.test.ts -t "zod paired months"` | NEW |
| SEAS-02 | Dormant task returns null from computeNextDue | unit | `npm test -- task-scheduling.test.ts -t "seasonal dormant"` | EXISTS (extend) |
| SEAS-03 | Wake-up returns start-of-window in home tz | unit | `npm test -- task-scheduling.test.ts -t "seasonal wakeup"` | EXISTS (extend) |
| SEAS-04 | isInActiveWindow handles wrap (Oct-Mar active Dec, dormant Jul) | unit | `npm test -- task-extensions.test.ts -t "isInActiveWindow wrap"` | NEW |
| SEAS-05 | computeCoverage excludes dormant from mean | unit | `npm test -- coverage.test.ts -t "dormant exclusion"` | EXISTS (extend) |
| All existing 355 | Regression: no existing test assertion changes | unit + integration | `npm test` | EXISTS |

### Sampling Rate

- **Per task commit:** `npm test -- task-scheduling.test.ts task-extensions.test.ts coverage.test.ts` (~3s)
- **Per wave merge:** `npm test` (full suite, ~25-40s based on Phase 10 benchmark)
- **Phase gate:** Full suite green before `/gsd-verify-work`, with D-26 regression assertion (355 existing tests pass + ~30 new)

### Wave 0 Gaps

- [ ] `tests/unit/task-extensions.test.ts` — NEW file — covers PREF helper matrix + isInActiveWindow 12×3 matrix + zod refinement cases (~18 cases)
- [ ] `tests/unit/task-extensions-integration.test.ts` — NEW file — disposable PB on port 18099, 4 lifecycle scenarios (migration + OOFT lifecycle + seasonal lifecycle + override × dormant composition)
- [ ] Wave 0 PB smoke: confirm `NumberField.required = false` via direct mutation is persisted by `app.save()`. If not, fallback plan branch removes+re-adds. This is a 30-second smoke check before Plan 11-01 is written.
- [ ] Integration fixture plumbing: tests/unit/schedule-overrides-integration.test.ts is the canonical pattern; copy its disposable-PB boot block verbatim, changing port 18098 → 18099.

*(Existing `tests/unit/task-scheduling.test.ts` and `tests/unit/coverage.test.ts` are extended in-place — no new files for those.)*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Phase 11 adds no auth surface — reuses existing PB auth + member-gated tasks rule |
| V3 Session Management | no | No session primitives touched |
| V4 Access Control | yes | New fields inherit tasks.{list,view,create,update,delete}Rule = `home_id.owner_id = @request.auth.id` (or member via Phase 4 extensions). No new rules. |
| V5 Input Validation | yes | zod refinements on all 4 new fields (D-21). PB NumberField `min:1 max:12` is defense-in-depth on SEAS. PB SelectField locks PREF enum. |
| V6 Cryptography | no | No new crypto surface |
| V7 Error Handling | yes | Branch guards in computeNextDue fail-closed: invalid frequency throws; null/archived return null. Consistent with Phase 10. |
| V8 Data Protection | no | No sensitive new data; tasks already classified as user-controlled content |
| V9 Communication | no | No new network surface |
| V10 Malicious Code | no | No new eval/dynamic code paths |
| V11 Business Logic | yes | Branch-order composition (D-16) encodes business logic; D-25 test matrix is the control |

### Known Threat Patterns for {stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| T-11-01 OOFT without due_date | Tampering (validation bypass) | D-21 zod refine (app-layer); integration test asserts rejection. PB DateField `required: false` is deliberately permissive since "one-off" cross-field rule can't be expressed in PB migrations — zod is the source of truth. |
| T-11-02 Seasonal task corrupt window (from=13, to=0) | Tampering (schema bypass) | D-11 PB NumberField `min:1 max:12` + zod range + paired refine. Defense-in-depth at 3 layers. |
| T-11-03 OOFT race: completion lands but archive fails | Tampering (state corruption) | Phase 10's `pb.createBatch()` atomicity — rollback on any op failure. D-04 appends the archive op to the same batch. No orphan state. |
| T-11-04 Cross-year wrap off-by-one (SEAS-04) | Tampering (logic bug, user-visible) | 12×1 unit matrix covering every month of a wrap window (Oct-Mar: test Apr..Sep dormant; Oct..Mar active). Hard gate on phase completion. |
| T-11-05 (new) Dormant override abuse | Information Disclosure / Business Logic | User snoozes a dormant task (Phase 15 UI will warn, but API accepts per D-17). Override wins → task becomes visible during its dormant window with user's chosen date. This is intended behavior (override is user intent); integration test documents. |
| T-11-06 (new) Past-date OOFT | Business Logic | D-22 accepts past due_date for OOFT — legitimate "I forgot this, do it ASAP" pattern. Task appears overdue immediately. No threat; documented as by-design distinct from Phase 10's snooze past-date rejection. |

## Sources

### Primary (HIGH confidence)
- `pocketbase/pb_migrations/1714953605_users_notification_prefs.js` — additive-fields-on-existing-collection pattern (exemplar for D-23).
- `pocketbase/pb_migrations/1745280000_schedule_overrides.js` — PB 0.37.1 post-construction pattern + down-migration idempotence (exemplar for D-23 + A1 fallback).
- `lib/task-scheduling.ts` (Phase 10-extended) — existing `computeNextDue` shape + branch order extension contract.
- `lib/coverage.ts` — existing dormant-filter extension point at line 50 (`.filter((t) => !t.archived)`).
- `lib/schemas/task.ts` — existing zod refine pattern with `path:` (Pitfall 12 mitigation).
- `lib/schemas/schedule-override.ts` — zod CLOCK_SKEW_SECS refine idiom (similar cross-field shape).
- `lib/actions/completions.ts` (Phase 10) — `pb.createBatch()` atomic pattern + BatchRequestResult ordering (Plan 10-03 verified).
- `.planning/v1.1/audit.md` §Q2, §Idea 5 — original SEAS + cross-year wrap decisions.
- `.planning/v1.1/audit-addendum-load.md` §Rider 2, §10 — OOFT locking + LOAD branch order after Phase 11.
- `.planning/phases/11-task-model-extensions/11-CONTEXT.md` — user-locked D-01..D-27.

### Secondary (MEDIUM confidence)
- `lib/band-classification.ts` — `toZonedTime` / `fromZonedTime` pattern for tz boundary math.
- `lib/household-streak.ts`, `lib/personal-streak.ts`, `lib/history-filter.ts` — identical tz idiom (3 exemplars, all verified).
- `tests/unit/schedule-overrides-integration.test.ts` — disposable-PB boot pattern + port allocation log (copy-paste template for port 18099).
- `package.json` — version verification (pocketbase 0.26.8 SDK, zod 4.1.0, date-fns 4.1.0, date-fns-tz 3.2.0, vitest 4.1.4).

### Tertiary (LOW confidence — flagged in Assumptions Log)
- A1: PB 0.37.1 direct `required` mutation behavior — needs Wave 0 smoke.
- A2: Option A vs B for timezone param plumbing — needs user preference confirmation.
- A3: 365-day heuristic for dormancy-gap detection — open design choice at plan time.

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — zero new deps, every version verified against package.json at 2026-04-22.
- Architecture: **HIGH** — branch order locked in CONTEXT.md D-16; every pattern has a working exemplar in the repo (migration, zod refine, computeNextDue branch, batch op).
- Pitfalls: **HIGH** — all 6 pitfalls are either (a) observed in prior phases (PB 0.37.1 quirks, zod path routing) or (b) called out in threat model T-11-01..04 in CONTEXT.md.
- Integration details: **MEDIUM** — two open decisions (A1 PB mutation behavior, A2 timezone param plumbing) documented as Wave 0 smoke + plan-time decision.

**Research date:** 2026-04-22
**Valid until:** 2026-05-22 (30 days — stable; no fast-moving dependencies in this phase's stack)

---

*Phase: 11-task-model-extensions*
*Researched: 2026-04-22 by gsd-researcher via /gsd-research-phase 11*
