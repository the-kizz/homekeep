# Phase 10: Schedule Override Foundation — Research

**Researched:** 2026-04-22
**Domain:** PocketBase schema migration + pure TS helpers + `computeNextDue` signature extension; no UI, no user-visible behavior change for v1.0 paths
**Confidence:** HIGH across all areas (every claim is grounded in this repo's existing migrations, helpers, and tests; no unverified training-data guesses)

## Summary

Phase 10 is the smallest possible foundation for v1.1 snooze — a new `schedule_overrides` PocketBase collection plus two pure fetch helpers, a `computeNextDue` signature extension, and an atomic consumption path in `completeTaskAction`. Every implementation decision is already locked in CONTEXT.md (D-01 through D-16); the research job is to pin concrete PB 0.37.1 syntax, filter shape, zod refine exemplar, and the full grep of `computeNextDue` callers so the planner can split tasks by concrete file targets.

The key discipline is: **mirror existing patterns verbatim**. Completions (`1714867200_completions.js`) shows the double-hop rule form for task-owned child collections; notifications (`1714953606_notifications.js`) shows a new-collection migration with `createRule = null` semantics; users-prefs (`1714953605_users_notification_prefs.js`) shows the post-construction `.fields.add()` pattern that the 02-01 deviation codified. `latestByTask: Map<string, CompletionRecord>` in `lib/coverage.ts` is the direct template for `Map<taskId, Override>`. PB filter injection is solved via `pb.filter('task_id = {:tid}', {tid})`. The batch write in `completeTaskAction` reuses the existing `pb.createBatch()` primitive already wired in `lib/actions/seed.ts:93` and `lib/actions/invites.ts:192`.

**Primary recommendation:** Create the collection + helpers first (Wave 0), then extend `computeNextDue` signature (Wave 1 — mechanical test-fixture update), then wire consumption in `completeTaskAction` (Wave 2 — atomic batch). Disposable PB integration test claims port 18098. No new dependencies; every required primitive is already in `package.json`.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Data model:**
- **D-01:** New `schedule_overrides` PocketBase collection. Shape: `(id, task_id, snooze_until, consumed_at, created)`. Per-task override storage, one row per snooze event. Decision over `snoozed_until` + `snooze_consumed_at` fields on `tasks` — preserves snooze history and supports v1.2+ "Recent reschedules" surface without refactor.
- **D-02:** One active override per task. When a new snooze is written, atomically set `consumed_at = now` on any existing active override for the same task in the same write batch. Always 0 or 1 active row per task. Second-writer wins (explicit "consume the predecessor").

**Schema rules:**
- **D-03:** Member-gated rules mirroring `tasks` collection. Use the double-hop relation `@request.auth.home_members_via_user_id.home_id ?= task_id.home_id` for `listRule` / `viewRule` / `createRule` / `updateRule` / `deleteRule`. Anyone in the household can snooze any task.
- **D-04:** `createRule` additionally enforces auth context. No body-check for `created_by` since the override doesn't carry an author field by default — `task_id` membership is sufficient.
- **D-05:** `updateRule` allows member writes (needed for `consumed_at` updates). `deleteRule` member-allowed too.

**`computeNextDue` integration:**
- **D-06:** Add `override?: Override` parameter to `computeNextDue`. Signature becomes `computeNextDue(task, lastCompletion, now, override?)`. Optional — calls without `override` get v1.0-identical behavior. Single source of truth.
- **D-07:** Phase 12 will add a second branch (LOAD). Phase 10 ships ONLY the override branch + natural fallback. Signature is forward-compatible.

**Helper API:**
- **D-08:** Two fetch helpers in `lib/schedule-overrides.ts`:
  - `getActiveOverride(pb, taskId): Promise<Override | null>` — single-task fetch.
  - `getActiveOverridesForHome(pb, homeId): Promise<Map<string, Override>>` — batch fetch. Mirrors `latestByTask` pattern.
- **D-09:** Helpers stay independent of `next_due_smoothed`. Phase 10's helpers return ONLY override rows. Composition lives in `computeNextDue`.

**Consumption semantics:**
- **D-10:** Atomic write at completion + read-time filter (defense in depth). In `completeTaskAction`: batch-write the completion AND set `consumed_at = now` on any active override in one transaction. At read time: `getActiveOverride` filters on `(consumed_at IS NULL AND snooze_until > <latest_completion_ts>)`.

**Validation:**
- **D-11:** Past-date snooze rejected at app layer. Zod `.refine()` requires `snooze_until > now` with ~30s clock-skew fudge.
- **D-12:** Far-future snooze allowed but unlimited. No upper bound in v1.1.

**Test scope:**
- **D-13:** Unit + integration coverage. Unit tests in `tests/unit/schedule-overrides.test.ts`; integration test in `tests/integration/schedule-overrides.test.ts` on disposable PB port **18098**.
- **D-14:** All 311 existing unit + 23 E2E tests pass. Mechanical fixture migration (add `undefined` as 4th argument).

**Migration:**
- **D-15:** Additive migration following 1714953605 pattern. Post-construction `fields.add()` (PB 0.37.1 silent-drop workaround). New collection only — no existing collection touched. Down migration removes the collection.

**Phase 12 forward-compatibility:**
- **D-16:** SNZE-07 marker flag deferred. Phase 10 ships only `schedule_overrides` — the marker field on `tasks` is NOT part of Phase 10.

### Claude's Discretion

- Specific PB collection field IDs / names beyond the 5-tuple (id, task_id, snooze_until, consumed_at, created). Names obvious; types follow PB conventions.
- Index choices on `schedule_overrides`. Recommendation: `(task_id, consumed_at)` for per-task active fetch and `(task_id)` for batch. Planner validates against query patterns.
- Whether to add `created_by_id` field for audit trail. Recommendation: yes (mirrors completions; cheap + useful for debugging).
- Helper file organization: `lib/schedule-overrides.ts` (helpers) + `lib/schemas/schedule-override.ts` (zod). Standard split.
- Unit test count beyond the floor: planner's call based on edge cases.

### Deferred Ideas (OUT OF SCOPE)

- Per-task "From now on" marker flag (Phase 11 or 15, REQUIRED by REBAL in Phase 17).
- Action-sheet UI surface (Phase 15).
- `ExtendWindowDialog` for cross-window snoozes (Phase 15; depends on SEAS data).
- LOAD smoothed-date branch in `computeNextDue` (Phase 12).
- REBAL preservation reads on `schedule_overrides` (Phase 17; reads only).
- "Recent reschedules" surface (v1.2+, V2-05).
- Snooze sanity-check warnings e.g. "Snooze 5 years?" (Phase 15).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SNZE-04 | New `schedule_overrides` PB collection stores one-off snoozes `(id, task_id, snooze_until, consumed_at, created)` | Migration recipe below (§"Migration recipe"); mirrors `1714867200_completions.js` + `1714953606_notifications.js` |
| SNZE-05 | `computeNextDue` consults the latest active (unconsumed) override BEFORE the smoothed-date branch | Signature extension pattern below (§"computeNextDue signature extension"); override branch is first short-circuit |
| SNZE-06 | Overrides are consumed when the next completion lands after the override date | Atomic batch consumption pattern below (§"Consumption in completeTaskAction"); read-time filter also enforces (D-10) |
| SNZE-09 | Coverage ring uses the snoozed (later) next_due (snoozed tasks don't drag coverage down) | Free by construction — `computeCoverage` calls `computeNextDue`; override fed through = later `nextDue` = `overdueDays = 0` = `health = 1.0`. No formula change. |
| SNZE-10 | Scheduler ntfy `ref_cycle` keys on the resulting next_due (one notification per effective due date — idempotent re-firing) | Free by construction — `buildOverdueRefCycle(taskId, nextDueIso)` (lib/notifications.ts:53-58) already keys on `nextDueIso`. Override changes next_due → changes ref_cycle → one notification at new date. (§"Pitfalls" surfaces the ISO-string determinism risk.) |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Override row storage (schema + RLS rules) | Database / Storage (PocketBase) | — | PB is the ownership source of truth; rules gate access at the DB layer regardless of which client authenticates. |
| Override fetch (single + batch) | Database / Storage + API (server-side) | — | Server actions and server components run in Next.js, reading PB via authenticated SDK client. Helpers are pure composition over `pb.collection(...)`. |
| `computeNextDue` extension (pure fn) | API / Backend (lib pure module) | — | `lib/task-scheduling.ts` is isomorphic pure TS used by server components, server actions, and the in-process scheduler. No tier boundary crossed. |
| Override consumption write | API / Backend (server action) | Database / Storage | `completeTaskAction` runs on the server; it extends an existing `pb.createBatch()` operation to include the override update in one transaction. |
| Zod validation (past-date rejection) | API / Backend (shared schema) | Frontend (future Phase 15 form) | Schema file is isomorphic; Phase 10 uses it in server actions only. Phase 15 will reuse it in the action-sheet form without churn. |
| UI surface | — (not in scope) | Phase 15 (Browser / Client) | Explicitly out of scope per D-16 / deferred list. |

## Standard Stack

No new libraries. Phase 10 uses what's already in `package.json`.

### Core (already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `pocketbase` (JS SDK) | 0.26.8 | PB client used by server components and server actions | Already wired; supports `createBatch`, `pb.filter(...)` parameterized filters, `getFirstListItem`, `getFullList`. [VERIFIED: package.json:37] |
| `pocketbase` (server binary) | 0.37.1 | Database engine serving the migrations | Bundled in Dockerfile via pinned checksum; same version used in all test harnesses. [VERIFIED: `.pb/pocketbase --version` returns `pocketbase version 0.37.1`] |
| `zod` | 4.1.0 | Schema validation for override write payload | Already the project's schema standard; `.refine()` with `path: ['snooze_until']` is the exemplar pattern from `lib/schemas/task.ts:52-62`. [VERIFIED: package.json:45] |
| `date-fns` | 4.1.0 | Pure date math in `computeNextDue` | Already imported throughout scheduling helpers. [VERIFIED: package.json:28] |
| `date-fns-tz` | 3.2.0 | Timezone-aware rendering at UI boundaries | Already used for `formatInTimeZone` in band classification and next-due display; Phase 10 does no UI work so this is only relevant via consumers. [VERIFIED: package.json:29] |
| `vitest` | (via devDependencies) | Unit + integration test runner | All existing test files are vitest. [VERIFIED: tests/unit/*.test.ts suite boots via `vitest run`] |

### Supporting (already installed)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node-cron` | 3.0.3 | In-process scheduler | Only touched if Phase 10 needs to update `processOverdueNotifications` — which it DOES (override batch fetch before the per-task loop). Code change, not a new dependency. [VERIFIED: package.json:33, lib/scheduler.ts:1] |

### Alternatives Considered
None. CONTEXT.md locks every alternative:
- Alternative to `schedule_overrides` collection (fields on `tasks`) → rejected in audit.md Q1 and CONTEXT.md D-01.
- Alternative to batch fetch helper (per-task only) → rejected in discussion log.
- Alternative to `override?` parameter (`applyOverride` wrapper) → rejected in discussion log.

**Installation:** no action. All packages present.

**Version verification:**
```bash
# Verified on this researcher's run (2026-04-22, linux):
$ cat /root/projects/homekeep/package.json | grep '"pocketbase"'
    "pocketbase": "0.26.8",
$ /root/projects/homekeep/.pb/pocketbase --version
pocketbase version 0.37.1
```
JS SDK 0.26.8 is fully compatible with server 0.37.1 (SDK semver-tracks server major). No upgrade needed.

## Architecture Patterns

### System Architecture Diagram

```
                   ┌──────────────────────────────────────┐
                   │ PocketBase (server 0.37.1)           │
                   │  ┌────────────┐  ┌────────────────┐  │
                   │  │   tasks    │  │ schedule_over- │  │
                   │  │            │  │     rides      │  │
                   │  │ home_id ───┤  │ task_id ───────┼──┼─► FK → tasks
                   │  └────┬───────┘  │ snooze_until   │  │
                   │       │          │ consumed_at    │  │
                   │       │          │ created_by_id  │  │
                   │       │          └──────┬─────────┘  │
                   │  ┌────▼───────┐         │            │
                   │  │completions │         │            │
                   │  └────────────┘         │            │
                   └─────────▲──────────────▲┘
                             │              │
                   ┌─────────┴──────┐  ┌────┴─────────────────┐
    read path ─────► getCompletions │  │ getActiveOverride    │
                   │  ForHome       │  │ getActiveOverrides-  │
                   │  (existing)    │  │   ForHome (new)      │
                   └─────────┬──────┘  └────┬─────────────────┘
                             │              │
                             ▼              ▼
                   ┌─────────────────────────────────────────┐
                   │ computeNextDue(task, last, now, over?)  │
                   │                                         │
                   │ if (override && !consumed)              │
                   │   return new Date(snooze_until)   ◄─── NEW BRANCH
                   │ // Phase 12 will add smoothed branch here
                   │ // natural cycle/anchored branches      │
                   └──────┬──────┬─────────┬─────────┬───────┘
                          │      │         │         │
                          ▼      ▼         ▼         ▼
                    coverage  bands    scheduler  weekly-summary
                    (ring)   (UI)      (ntfy)     (notification)

    write path (completion):
    completeTaskAction
         │
         ▼
    pb.createBatch()
         ├── completions.create({task_id, completed_by_id, completed_at...})
         └── schedule_overrides.update(activeOverrideId, {consumed_at: now})
                                   ▲─── IFF an active override exists
         .send()   ◄── single atomic PB transaction
```

### Recommended Project Structure

Add only what's new; touch existing files minimally:

```
lib/
├── schedule-overrides.ts          # NEW — pure helpers (getActiveOverride, getActiveOverridesForHome)
├── task-scheduling.ts             # EDIT — add override? param to computeNextDue
├── coverage.ts                    # EDIT — wire override Map into per-task loop
├── band-classification.ts         # EDIT — same wiring
├── weekly-summary.ts              # EDIT — same wiring
├── scheduler.ts                   # EDIT — batch fetch overrides, pass into computeNextDue
├── area-coverage.ts               # EDIT — accept override Map pass-through
├── completions.ts                 # NO CHANGE — unrelated
└── actions/
    └── completions.ts             # EDIT — extend pb.createBatch() with override consumption
lib/schemas/
└── schedule-override.ts           # NEW — zod refine exemplar

pocketbase/pb_migrations/
└── 1745300000_schedule_overrides.js  # NEW — creates the collection (timestamp ~2026-04-22)

tests/unit/
├── schedule-overrides.test.ts     # NEW — pure helper logic + computeNextDue override branch
├── task-scheduling.test.ts        # EDIT — add `undefined` 4th arg to existing fixtures
├── coverage.test.ts               # EDIT — one new test covering override path
├── band-classification.test.ts    # EDIT — one new test covering override path
└── ... (other consumers get mechanical signature update only)

tests/integration/
└── schedule-overrides.test.ts     # NEW — disposable PB port 18098; rules + consumption contract
```

### Pattern 1: New PB collection migration (additive, PB 0.37.1 post-construction pattern)

**What:** Create a brand-new collection with double-hop rules, relation FK to `tasks`, indexes, via the `new Collection({...}).fields.add(...)` pattern.

**When to use:** Any new PB collection in this codebase — non-negotiable per the 02-01 deviation. PB 0.37.1 silently drops `fields:` and `indexes:` passed to the `Collection` constructor; you MUST use post-construction `.fields.add()` + `indexes = [...]` before `app.save()`.

**Example (adapted from `1714867200_completions.js:27-97` + `1714953606_notifications.js:43-130`):**
```javascript
// Source: this repo — pocketbase/pb_migrations/1714867200_completions.js
// Source: this repo — pocketbase/pb_migrations/1714953606_notifications.js
/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const tasks = app.findCollectionByNameOrId('tasks');
    const users = app.findCollectionByNameOrId('users');

    // Double-hop member rule via task_id.home_id (mirrors completions).
    // D-03: all five rules are member-gated. D-05: update/delete allowed
    // for members so consumption writes + "undo a snooze" affordances work.
    const memberRule =
      '@request.auth.id != "" && @request.auth.home_members_via_user_id.home_id ?= task_id.home_id';

    const overrides = new Collection({
      type: 'base',
      name: 'schedule_overrides',
      listRule:   memberRule,
      viewRule:   memberRule,
      createRule: memberRule, // D-04: no body-check; task_id membership is sufficient
      updateRule: memberRule, // D-05: allow consumed_at updates + undo
      deleteRule: memberRule, // D-05: allow member delete for undo affordance
    });

    overrides.fields.add(new RelationField({
      name: 'task_id',
      required: true,
      collectionId: tasks.id,
      cascadeDelete: true,      // if a task is hard-deleted, its overrides go too
      minSelect: 1,
      maxSelect: 1,
    }));
    overrides.fields.add(new DateField({
      name: 'snooze_until',
      required: true,
    }));
    overrides.fields.add(new DateField({
      name: 'consumed_at',
      required: false,          // NULL = active; set-to-now when consumed
    }));
    // Audit trail (Claude's Discretion — recommended yes, mirrors completions).
    overrides.fields.add(new RelationField({
      name: 'created_by_id',
      required: false,          // legacy/admin writes may omit
      collectionId: users.id,
      cascadeDelete: false,     // preserve audit trail even if user is deleted
      minSelect: 0,
      maxSelect: 1,
    }));
    overrides.fields.add(new AutodateField({ name: 'created', onCreate: true }));

    overrides.indexes = [
      // Per-task active-override lookup — powers getActiveOverride single fetch.
      // (task_id, consumed_at) composite so PB can partial-scan the null rows
      // for a given task without a full-collection scan.
      'CREATE INDEX idx_schedule_overrides_task_consumed ON schedule_overrides (task_id, consumed_at)',
      // Creation-ordered lookup for "latest active" tie-breaker.
      'CREATE INDEX idx_schedule_overrides_created ON schedule_overrides (created)',
    ];

    app.save(overrides);
  },
  (app) => {
    // DOWN — idempotent.
    try {
      const c = app.findCollectionByNameOrId('schedule_overrides');
      app.delete(c);
    } catch (_) { /* idempotent */ }
  },
);
```

**Migration file timestamp:** pick `1745280000` (roughly 2026-04-22T00:00:00Z in Unix seconds) or any 2026-04-22-based value that's `> 1714953606` (the last allocated prefix). The exact value is mechanical; the numeric ordering is what matters to PB's migration runner. The existing 1714...606 prefix still refers to "May 2024 Unix seconds" by accident — the numeric-ordering contract is preserved regardless.

### Pattern 2: Batch map helper (mirrors `latestByTask`)

**What:** Single PB roundtrip per home dashboard render; return `Map<taskId, Override>` so callers can do O(1) lookup in a per-task loop without N+1 queries.

**When to use:** Any aggregate consumer (BandView, coverage, scheduler, weekly summary) that iterates >1 task. The single-task helper is for TaskDetailSheet or an individual server action touching one task.

**Example (modeled on `lib/completions.ts:83-97` + `lib/coverage.ts:35-61`):**
```typescript
// Source: this repo — lib/completions.ts (reduceLatestByTask pattern)
// Source: this repo — lib/notifications.ts (pb.filter parameterization)
import type PocketBase from 'pocketbase';

export type Override = {
  id: string;
  task_id: string;
  snooze_until: string;      // ISO 8601 UTC
  consumed_at: string | null;
  created_by_id: string | null;
  created: string;
};

/**
 * Single-task fetch: returns the latest unconsumed override for this task,
 * or null if none exists.
 *
 * Read-time filter (D-10 defense in depth):
 *   consumed_at is NULL AND snooze_until > latest_completion.completed_at
 *
 * NOTE: the "snooze_until > latest_completion" half of D-10 MUST be applied
 * by the caller (computeNextDue has lastCompletion in scope) — this helper
 * returns the row for the caller to decide if it's still relevant. Keeps
 * the helper pure on a single collection.
 */
export async function getActiveOverride(
  pb: PocketBase,
  taskId: string,
): Promise<Override | null> {
  try {
    const rec = await pb
      .collection('schedule_overrides')
      .getFirstListItem(
        pb.filter('task_id = {:tid} && consumed_at = null', { tid: taskId }),
        { sort: '-created' },
      );
    return rec as unknown as Override;
  } catch {
    // PB throws ClientResponseError 404 when no row matches — the common
    // "no active override" case. Other errors collapse the same way
    // (fail-open to natural next-due); downstream behavior is safe.
    return null;
  }
}

/**
 * Batch fetch: all active overrides for tasks in `homeId`, keyed by task_id.
 * Mirrors `latestByTask: Map<string, CompletionRecord>` pattern (coverage.ts).
 *
 * Single PB roundtrip per home dashboard render — eliminates N+1 hot path.
 */
export async function getActiveOverridesForHome(
  pb: PocketBase,
  homeId: string,
): Promise<Map<string, Override>> {
  const rows = await pb.collection('schedule_overrides').getFullList({
    filter: pb.filter(
      'task_id.home_id = {:hid} && consumed_at = null',
      { hid: homeId },
    ),
    sort: '-created',
    batch: 500, // Pitfall 3 (lib/completions.ts:17-23) — explicit batch size
  });

  // Reduce to Map; when multiple active rows exist for one task (should be 0
  // per D-02, but defense in depth), the one with the newest `created` wins
  // because sort: '-created' puts newest first and Map.set overwrites older.
  // Actually we want FIRST wins — so flip logic:
  const m = new Map<string, Override>();
  for (const r of rows) {
    const row = r as unknown as Override;
    if (!m.has(row.task_id)) m.set(row.task_id, row);
  }
  return m;
}
```

### Pattern 3: `computeNextDue` signature extension (D-06)

**What:** Add an optional 4th parameter `override?: Override`. Branch on it FIRST (before cycle/anchored natural logic). Phase 12 will insert a `next_due_smoothed` branch between override and natural — Phase 10 signature is forward-compatible.

**Example (extending current `lib/task-scheduling.ts:50-83`):**
```typescript
// Source: this repo — lib/task-scheduling.ts (current implementation)
// Source: .planning/v1.1/audit-addendum-load.md §2 (branch order)
import { addDays, differenceInDays } from 'date-fns';

export type Task = {
  id: string;
  created: string;
  archived: boolean;
  frequency_days: number;
  schedule_mode: 'cycle' | 'anchored';
  anchor_date: string | null;
};

export type Completion = {
  completed_at: string;
};

// Imported from lib/schedule-overrides.ts; duplicated here for clarity only.
export type Override = {
  id: string;
  task_id: string;
  snooze_until: string;
  consumed_at: string | null;
  // ...
};

export function computeNextDue(
  task: Task,
  lastCompletion: Completion | null,
  now: Date,
  override?: Override,  // NEW — D-06
): Date | null {
  if (task.archived) return null;

  if (!Number.isInteger(task.frequency_days) || task.frequency_days < 1) {
    throw new Error(`Invalid frequency_days: ${task.frequency_days}`);
  }

  // ─── NEW BRANCH (Phase 10) ──────────────────────────────────────────
  // Override wins when:
  //   (a) override is present
  //   (b) override.consumed_at is NULL
  //   (c) override.snooze_until > lastCompletion.completed_at (D-10 read-time filter)
  //
  // Without the (c) check, a completion that lands AFTER the snooze
  // would be ignored at read time even if the atomic-consumption write
  // missed (race, PB hiccup, future admin edit). (c) implements the
  // defense-in-depth half of D-10.
  if (override && override.consumed_at === null) {
    const snoozeUntil = new Date(override.snooze_until);
    const lastCompletedAt = lastCompletion
      ? new Date(lastCompletion.completed_at)
      : null;
    if (!lastCompletedAt || snoozeUntil > lastCompletedAt) {
      return snoozeUntil;
    }
    // else: override is stale (completion occurred after snooze_until);
    // fall through to the natural branch. Caller SHOULD have written
    // consumed_at at completion time via D-10 — this is the safety net.
  }

  // ─── Phase 12 will insert: next_due_smoothed branch HERE ────────────
  // if (task.next_due_smoothed) return new Date(task.next_due_smoothed);

  // ─── Existing v1.0 branches (unchanged) ─────────────────────────────
  if (task.schedule_mode === 'cycle') {
    const baseIso = lastCompletion?.completed_at ?? task.created;
    return addDays(new Date(baseIso), task.frequency_days);
  }

  // anchored
  const baseIso = task.anchor_date ?? task.created;
  const base = new Date(baseIso);
  if (base.getTime() > now.getTime()) return base;
  const elapsedDays = differenceInDays(now, base);
  const cycles = Math.floor(elapsedDays / task.frequency_days) + 1;
  return addDays(base, cycles * task.frequency_days);
}
```

### Pattern 4: Atomic consumption in `completeTaskAction` (D-10 write half)

**What:** Extend the existing completion write to ALSO update `consumed_at` on any active override, in ONE `pb.createBatch()` transaction. On PB failure, BOTH writes roll back atomically.

**When to use:** Only in `lib/actions/completions.ts:completeTaskAction`. Nowhere else writes completions.

**Example (modifying current `lib/actions/completions.ts:173-181`):**
```typescript
// Source: this repo — lib/actions/completions.ts (current completion write)
// Source: this repo — lib/actions/seed.ts:93 (createBatch exemplar)
// Source: this repo — lib/actions/invites.ts:192 (createBatch + update exemplar)

// BEFORE (single .create):
// const created = await pb.collection('completions').create({
//   task_id: taskId,
//   completed_by_id: userId,
//   completed_at: now.toISOString(),
//   via: 'tap',
//   notes: '',
// });

// AFTER: fetch the active override (if any), then batch both writes.
const activeOverride = await getActiveOverride(pb, taskId);

const batch = pb.createBatch();
const completionOpId = batch.collection('completions').create({
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
const results = await batch.send();
// results[0] is the created completion; PB SDK 0.26.8 returns raw record payloads.
const created = results[0].body as { id: string; completed_at: string; /*...*/ };
```

**Note:** PB SDK `pb.createBatch()` returns an object whose `.send()` resolves to an array of result objects. The shape in 0.26.8 is `{ status, body }[]`. If `batch.send()` throws (PB unique-index violation, rule-gate failure, network error), the caller's existing `try { ... } catch { return { ok: false, formError: 'Could not record completion' }; }` wrapper captures it — error shape unchanged.

### Pattern 5: Zod schema with `.refine()` for future-date validation

**What:** The zod schema file for a new write action. Phase 10 doesn't surface the write as a server action (action-sheet UI lives in Phase 15), but the schema MUST exist now so Phase 15 can import it without churn and tests can exercise the refine logic.

**Example (modeled on `lib/schemas/task.ts:52-62` refine pattern):**
```typescript
// Source: this repo — lib/schemas/task.ts (refine with path routing)
// Source: this repo — lib/schemas/completion.ts (ISO string field pattern)
import { z } from 'zod';

/**
 * Schedule override schema (Phase 10, D-11).
 *
 * Shared client + server. Past-date snooze rejected at the app layer
 * (PocketBase DateField allows any value); zod.refine enforces future-
 * date intent with a 30-second fudge factor for client clock skew
 * (D-11). UI (Phase 15 action sheet) will use a date picker that
 * disallows past dates — this is defense in depth.
 *
 * Fields NOT in this schema:
 *   - id / created / consumed_at — server-controlled or absent at create.
 *   - created_by_id — server-set from pb.authStore.record.id in the
 *     Phase 15 server action (mirrors completions pattern).
 */
const CLOCK_SKEW_SECS = 30;

export const scheduleOverrideSchema = z
  .object({
    task_id: z.string().min(1, 'task_id is required'),
    snooze_until: z.string().min(1, 'snooze_until is required'), // ISO 8601 UTC
  })
  .refine(
    (d) => {
      const snooze = new Date(d.snooze_until);
      if (Number.isNaN(snooze.getTime())) return false;
      const threshold = Date.now() - CLOCK_SKEW_SECS * 1000;
      return snooze.getTime() > threshold;
    },
    {
      message: 'Snooze date must be in the future',
      path: ['snooze_until'],
    },
  );

export type ScheduleOverrideInput = z.infer<typeof scheduleOverrideSchema>;
```

Note: `Date.now()` usage is deliberate — this schema evaluates at write time; unlike `computeNextDue`, there's no testability requirement for a `now: Date` injection. Completions schema uses the same posture for `completed_at` (no refine, but same freedom).

### Anti-Patterns to Avoid

- **Body-check for `created_by_id` in createRule (like completions does).** CONTEXT.md D-04 explicitly omits this — the override doesn't require authorship accountability at the rule layer; `task_id` membership is sufficient. Adding it constrains Phase 15's server action needlessly (user can't "undo another member's snooze" if rule demands equality). Audit trail lives in the optional `created_by_id` field, not the create gate.
- **Storing ALL override history rows as `consumed_at = null` "active".** D-02 mandates exactly 0 or 1 active row per task — on new snooze, atomically consume the predecessor. "Many active, latest wins" was explicitly rejected in the discussion log (preserves simpler UX semantics in Phase 15).
- **Using `pb.filter('task_id = "' + taskId + '"')` (template literal).** T-04-01-08 injection mitigation requires parameter binding: `pb.filter('task_id = {:tid}', { tid: taskId })`. See `lib/notifications.ts:93` and `lib/membership.ts:37` for exemplars.
- **Setting `updateRule = null` on the override collection.** That's the completions pattern (append-only); the override collection MUST allow member updates so `consumed_at` can be written from `completeTaskAction` without admin-client escalation. D-05 is explicit.
- **Extending `computeNextDue` with a Map parameter.** D-08 + D-09 keep helpers single-purpose; `computeNextDue` takes a single `Override | undefined`, not a Map. Callers do the Map lookup themselves (`overridesByTask.get(task.id)`). Mirrors the existing `latestByTask.get(task.id)` pattern.
- **Resuming a snooze after the user's next completion when the atomic write failed silently.** The read-time filter in `computeNextDue` (the `(c)` sub-branch above) catches this: if completion `completed_at > snooze_until`, fall through to natural next-due. NEVER surface a "forever-snoozed" task because a single batch write raced.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Override-row ownership enforcement | Custom server-side filter or wrapper assertion | PocketBase `task_id.home_id` double-hop rule via `@request.auth.home_members_via_user_id` | Mirrors tasks/completions; PB is the source of truth for RLS. Hand-rolled filters get bypassed when a new caller forgets them. [VERIFIED: `pocketbase/pb_migrations/1714953602_update_rules_multi_member.js`] |
| Filter-string injection defense | Manual quoting / escape function | `pb.filter('x = {:y}', {y: value})` | SDK-level parameterization; T-04-01-08 mitigation. [VERIFIED: lib/notifications.ts:93, lib/membership.ts:37, lib/actions/invites.ts:135] |
| Atomic completion + override consumption | Two sequential awaits with try/catch compensation | `pb.createBatch()` with `.send()` | Existing exemplar; one roundtrip, one transaction, automatic rollback on any op failure. [VERIFIED: lib/actions/seed.ts:93, lib/actions/invites.ts:192] |
| Per-request N+1 override fetch | Per-task fetch inside dashboard render loop | `getActiveOverridesForHome` batch Map fetch | Mirrors `latestByTask` pattern; single roundtrip; O(1) per-task lookup. [VERIFIED: lib/coverage.ts:35-61] |
| Next-due branch ordering | Branch-by-branch ad-hoc if/else in every caller | Single `computeNextDue` extension + optional param | Single source of truth — every caller already goes through this function; new callers in Phase 12+ inherit correct semantics free. [VERIFIED: grep of `computeNextDue(` shows 5 non-test call sites] |
| ISO string construction for `snooze_until` / `consumed_at` | `new Date().toString()` / custom formatters | `new Date().toISOString()` (built-in) | Project convention — every PB DateField stores ISO 8601 UTC; rendering happens at UI boundaries only. [VERIFIED: lib/actions/completions.ts:177, lib/task-scheduling.ts docstring §15] |
| PB Collection constructor field-list | `new Collection({ fields: [...] })` init-object pattern | `new Collection({name, type, *Rule}); coll.fields.add(...); app.save(coll);` | PB 0.37.1 bug — init-object fields are silently dropped. 02-01 deviation codified this. [VERIFIED: every pb_migrations/*.js file uses post-construction pattern; comments cite the deviation] |

**Key insight:** The codebase has already paid the cost of figuring out the PB 0.37.1 quirks, filter-injection defense, batch-atomic writes, and Map-based reducer patterns. Phase 10's implementation is ~95% "copy the exemplar file and adjust field names"; the remaining 5% is wiring the new helper into the existing `computeNextDue` callers.

## Runtime State Inventory

> Phase 10 is additive (new collection, new helpers, new schema file, forward-compatible signature extension). It is NOT a rename, refactor, or migration in the sense that requires runtime-state discovery.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — `schedule_overrides` is a brand-new collection. v1.0 databases have no legacy override rows. Existing `tasks`, `completions`, `home_members` rows are untouched. | None |
| Live service config | None — no external service (n8n, Datadog, Tailscale, etc.) references `schedule_overrides`. The codebase has no SMTP, no cron external to `node-cron`, no dashboards. | None |
| OS-registered state | None — no OS-level task registration uses "schedule_overrides" as a name. Windows Task Scheduler, pm2, systemd are not in this codebase's deployment surface. Docker supervisord/s6 runs `nextjs` + `pocketbase` + `caddy` longruns; none reference override state by name. | None |
| Secrets / env vars | None — no `.env`, no SOPS keys, no CI environment variables reference "snooze", "override", or "schedule_override". | None |
| Build artifacts / installed packages | None — no new package.json entries. No compiled binary rename. `.pb/pocketbase` binary version unchanged (still 0.37.1). | None |

**Nothing found in any category** — verified by: (1) greps for "schedule_override" across repo (only the planning docs and CONTEXT.md match), (2) reading `docker/Dockerfile`, `scripts/dev-pb.js`, and `pocketbase/pb_hooks/*` for external-service bindings, (3) scanning the v1.0 data volume path (`./data` bind, SQLite at `./data/pb_data/`) — which doesn't care about new collections.

## Common Pitfalls

### Pitfall 1: PB 0.37.1 Collection constructor silent-drop
**What goes wrong:** `new Collection({ fields: [...], indexes: [...] })` silently discards the `fields` and `indexes` options; the collection is created empty. The subsequent `app.save()` may succeed but rule expressions reference fields that don't exist, so the FIRST real request 500s with a cryptic "field not found" error.
**Why it happens:** PB 0.37.1 JSVM Collection constructor bug — the init-object form only honors `type`, `name`, and `*Rule` properties.
**How to avoid:** Construct with `type`/`name`/`*Rule` only, then add fields and indexes post-construction before `app.save()`. Every migration in this repo comments the pattern; the exemplars are `1714867200_completions.js:31-88` and `1714953605_users_notification_prefs.js:41-59`.
**Warning signs:** A brand-new migration's first PB request fails with `validation_missing_rel_records` or `invalid_value` for a field the rule expression references.

### Pitfall 2: `?=` vs `=` in back-relation rule filters
**What goes wrong:** Writing `@request.auth.home_members_via_user_id.home_id = task_id.home_id` (with single `=`) requires EVERY home_members row for the authed user to match the task's home — which only works if the user belongs to exactly one home. Users in multiple homes lose access to tasks in ANY of them.
**Why it happens:** PB multi-value relation filters default to "all-match" (`=`). The correct operator for "any-match across the set" is `?=`.
**How to avoid:** ALWAYS use `?=` in back-relation rules on `home_members_via_user_id`. See the Pitfall 2 codification in `1714953602_update_rules_multi_member.js:14-17` and `1714953600_home_members.js:36-37`.
**Warning signs:** Integration tests pass when the test user is in one home but fail when the user is in two homes.

### Pitfall 3: PB filter template-literal injection
**What goes wrong:** `filter: \`task_id = "${taskId}"\`` concatenates user-controllable data into a filter string. A taskId containing `"` or `&&` can escape the intended filter.
**Why it happens:** Convenience; template literals look safer than string concatenation but have identical injection semantics.
**How to avoid:** Use `pb.filter('task_id = {:tid}', { tid: taskId })`. The SDK parameterizes at the binding layer. T-04-01-08 mitigation is codified in `lib/membership.ts:18-21` and `lib/notifications.ts:25-29`.
**Warning signs:** Code review flags a non-parameterized filter on any user-derived value.

### Pitfall 4: `getFullList` without explicit `batch: 500`
**What goes wrong:** PB 0.37 defaults `getFullList` page size to some implementation value; if that default changes in a minor version bump, silent pagination drops rows.
**Why it happens:** SDK relies on server-side default paging, which is undocumented for 0.37.
**How to avoid:** Pass `batch: 500` explicitly in every `getFullList` call. `lib/completions.ts:65` comments this as "Pitfall 3 — explicit batch size, don't rely on PB default."
**Warning signs:** A household with >500 tasks silently loses the tail — override rows for "later" tasks fail to fetch.

### Pitfall 5: Atomic-consumption write NOT batched with completion
**What goes wrong:** If `completions.create()` and `schedule_overrides.update(consumed_at)` are two sequential awaits, a PB error between them leaves a consumed completion but an active override — next render, `computeNextDue` returns the stale `snooze_until` as next due, and the task re-appears "in the future" even though it's been done.
**Why it happens:** Forgetting that `pb.createBatch()` exists, or assuming two sequential awaits are "probably atomic enough."
**How to avoid:** Wrap both ops in `pb.createBatch()` + `.send()`. PB rolls the whole transaction back if either op fails. Exemplars: `lib/actions/seed.ts:93-113`, `lib/actions/invites.ts:192-202`.
**Warning signs:** Integration test seeds a completion, asserts override `consumed_at` is set, and sees `null` — race between the two writes.

### Pitfall 6: Read-time filter forgets the `snooze_until > lastCompletion` guard
**What goes wrong:** If the atomic-consumption write misses (race, PB hiccup, direct Admin UI edit re-setting `consumed_at = null`), a stale unconsumed override lingers. Without the D-10 read-time `snooze_until > lastCompletion.completed_at` guard, `computeNextDue` returns the ancient snooze date forever — task appears permanently "future-due" even after completion.
**Why it happens:** Treating the write-time consumption as the sole source of truth.
**How to avoid:** Implement D-10 defense in depth: `computeNextDue`'s override branch MUST check `snooze_until > (lastCompletion?.completed_at ?? epoch)` before returning the snooze date. See Pattern 3 §"NEW BRANCH" above.
**Warning signs:** A user reports "I completed this task yesterday but it's still showing as due next week" — the override was never consumed, but the completion is in the database.

### Pitfall 7: ISO-string determinism and `ref_cycle` cache
**What goes wrong:** SNZE-10 ("one notification per effective next_due") relies on `buildOverdueRefCycle(taskId, nextDueIso)` producing a DIFFERENT string when the snooze lands. If the override's `snooze_until` ISO string is millisecond-precise but `computeNextDue` truncates to the date, the two renderings produce different ISOs — and a legitimate notification for the snoozed date gets blocked by a cached `ref_cycle` row from before the snooze.
**Why it happens:** `new Date(override.snooze_until).toISOString()` round-trips through Date's internal precision; small mismatches (e.g. `.000Z` vs `.123Z`) produce different strings.
**How to avoid:** The snooze ISO is stored as-given; `computeNextDue` returns `new Date(override.snooze_until)` unchanged; `nextDue.toISOString()` round-trips deterministically. Avoid any "normalize to midnight UTC" step in the override path — that would produce a different ISO string than what was stored, breaking idempotency in `hasNotified`. [VERIFIED: `lib/notifications.ts:53-58` keys on raw `nextDueIso`]
**Warning signs:** Snoozing a task triggers the notification cron, but NO ntfy POST fires because `hasNotified` returns true for the new cycle. Inspection of the `notifications` table shows `ref_cycle` rows with slightly different ISO strings.

### Pitfall 8: Disposable-PB test port collision
**What goes wrong:** Two integration tests try to bind the same port; one fails with `EADDRINUSE`, the other's fixtures get corrupted.
**Why it happens:** Port allocation is tracked in per-test-file comments, not a central registry.
**How to avoid:** Phase 10 claims **port 18098** — next available after 18097 (06-02 scheduler). Document this in the test file header and update the allocation log in STATE.md. Full log: 18090 (02-01), 18091 (03-01), 18092 (04-01 hook), 18093 (04-01 rules), 18094 (04-02 invites), 18095 (05-01 onboarded), 18096 (06-01 notifications), 18097 (06-02 scheduler), **18098 (10 schedule-overrides)**.
**Warning signs:** CI flakes with `EADDRINUSE` when multiple test files run concurrently.

### Pitfall 9: PB superuser WAL-race at test boot
**What goes wrong:** Starting `pb serve` and then immediately creating a superuser via CLI sees a SQLite WAL race — `superuser create` operates on the DB while `serve` has a write lock, producing intermittent `database is locked` failures.
**Why it happens:** PB's SQLite WAL mode expects exclusive-writer semantics during schema bootstrap.
**How to avoid:** ALWAYS create the superuser BEFORE spawning `pb serve`. Exemplar: `tests/unit/hooks-completions-append-only.test.ts:41-57`. Every integration test in this repo codifies the pattern.
**Warning signs:** Integration test is flaky — sometimes green, sometimes fails on `authWithPassword`.

### Pitfall 10: Migration down-hook not idempotent
**What goes wrong:** Running `migrate down` twice throws on the second run because the collection is already deleted. CI pipeline reports "migration failure" even though state is correct.
**Why it happens:** Bare `app.delete(c)` without the `try/catch` idempotency guard.
**How to avoid:** Wrap every `app.delete()` in `try { ... } catch (_) { /* idempotent */ }`. Exemplar: `1714867200_completions.js:89-97`.
**Warning signs:** `npm run migrate:down && npm run migrate:down` — second invocation throws.

## Code Examples

### Common Operation 1: Passing an override Map through a dashboard render

Adapting `app/(app)/h/[homeId]/by-area/page.tsx:62-97` to thread overrides into the coverage + counts computation:

```typescript
// Source: this repo — app/(app)/h/[homeId]/by-area/page.tsx (current pattern)
// NEW: import the batch helper
import { getActiveOverridesForHome } from '@/lib/schedule-overrides';

// ... inside the page's Server Component render:
const tasksRaw = await pb.collection('tasks').getFullList({ /* ... */ });
const completions = await getCompletionsForHome(pb, taskIds, now);
const latestByTask = reduceLatestByTask(completions);

// NEW: single-roundtrip batch fetch of active overrides, keyed by task_id.
const overridesByTask = await getActiveOverridesForHome(pb, homeId);

// When calling computeAreaCoverage / computeAreaCounts, pass the Map so
// they thread it into computeNextDue per-task:
const cards = areas.map((a) => {
  const tasksInArea = tasksByArea.get(a.id as string) ?? [];
  return {
    area: { /* ... */ },
    coverage: computeAreaCoverage(tasksInArea, latestByTask, overridesByTask, now),
    counts: computeAreaCounts(tasksInArea, latestByTask, overridesByTask, now, timezone),
  };
});
```

### Common Operation 2: Threading override into `computeCoverage`

```typescript
// Source: this repo — lib/coverage.ts (current, to be extended)
import type { Override } from '@/lib/schedule-overrides';

export function computeCoverage(
  tasks: Task[],
  latestByTask: Map<string, CompletionRecord>,
  overridesByTask: Map<string, Override>, // NEW
  now: Date,
): number {
  const active = tasks.filter((t) => !t.archived);
  if (active.length === 0) return 1.0;
  let sum = 0;
  let counted = 0;
  for (const task of active) {
    const last = latestByTask.get(task.id) ?? null;
    const override = overridesByTask.get(task.id); // NEW — undefined if none
    const nextDue = computeNextDue(task, last, now, override); // NEW — 4th arg
    if (!nextDue) continue;
    const overdueDays = Math.max(0, (now.getTime() - nextDue.getTime()) / 86400000);
    const health = Math.max(0, Math.min(1, 1 - overdueDays / task.frequency_days));
    sum += health;
    counted += 1;
  }
  return counted === 0 ? 1.0 : sum / counted;
}
```

### Common Operation 3: Unit-test fixture mechanical update

```typescript
// Source: this repo — tests/unit/task-scheduling.test.ts (current)
// BEFORE:
const result = computeNextDue(task, null, now);

// AFTER (D-14 mechanical fixture change):
const result = computeNextDue(task, null, now, undefined);
```

All 14 test cases in `tests/unit/task-scheduling.test.ts` get this treatment. A handful (~2-3) in `tests/unit/coverage.test.ts`, `tests/unit/band-classification.test.ts`, `tests/unit/weekly-summary.test.ts` get the same update because their upstream helpers (`computeCoverage`, `computeTaskBands`, `computeWeeklySummary`) gain the new `overridesByTask` parameter. The 311 total unit tests stay green because the new parameter is strictly additive — every old call produces byte-identical output.

**Fixture-churn estimate:**
- `tests/unit/task-scheduling.test.ts` — 14 direct calls (mechanical `undefined` 4th arg)
- `tests/unit/coverage.test.ts` — 10 tests, each calls `computeCoverage`; add `new Map()` 3rd arg
- `tests/unit/band-classification.test.ts` — 12 tests, each calls `computeTaskBands`; add `new Map()` 3rd-or-4th arg
- `tests/unit/weekly-summary.test.ts` — 9 tests via `computeWeeklySummary`; schema update
- `tests/unit/area-coverage.test.ts` — 11 tests via wrappers
- `tests/unit/scheduler.test.ts` — 4 tests; may need disposable-PB seed of `schedule_overrides` rows

Total: ~60 fixture signature updates across 6 test files. Zero behavioral assertions need to change.

## Callers to Update (full grep of `computeNextDue` call sites)

Verified via `grep -rn "computeNextDue(" --include="*.ts"` on 2026-04-22:

### Production code (5 call sites, all require edits)

| File:Line | Caller | Edit Required |
|-----------|--------|---------------|
| `lib/task-scheduling.ts:50` | `computeNextDue` definition | Extend signature with `override?: Override` 4th arg; add override branch BEFORE cycle/anchored logic |
| `lib/coverage.ts:47` | `computeCoverage` loop | Accept `overridesByTask: Map<string, Override>` 3rd arg (before `now`), pass `overridesByTask.get(task.id)` as 4th arg to computeNextDue |
| `lib/band-classification.ts:67` | `computeTaskBands` loop | Same pattern as coverage; accept override Map; forward per-task |
| `lib/scheduler.ts:221` | `processOverdueNotifications` inner loop | Add batch fetch `const overridesByTask = await getActiveOverridesForHome(pb, homeId)` BEFORE the `for (const task of tasks)` loop (after the `fetchHomeMembers` / `tasks.getFullList` calls); pass `overridesByTask.get(task.id)` as 4th arg |
| `lib/actions/completions.ts:236` | `completeTaskAction` next-due toast | This call happens AFTER the completion write and override consumption. It computes next-due for the success toast — the write just consumed the override, so pass `undefined` as the 4th arg. (The freshly-consumed override would ALSO produce the right answer via D-10 read-time filter, but `undefined` is semantically cleaner for a post-completion computation.) |
| `lib/weekly-summary.ts:112` | `computeWeeklySummary` inner loop | Accept `overridesByTask: Map<string, Override>` — the weekly summary currently builds `latestByTask` internally via `reduceLatestByTask`; Phase 10 can extend the caller to pass overrides in, OR the function itself does the second batch fetch. Recommend: caller passes in, to match the Phase 10 "helpers independent" discipline. |

### Page-level callers (indirect, via the helpers above)

| File | Change |
|------|--------|
| `app/(app)/h/[homeId]/by-area/page.tsx` | Add `getActiveOverridesForHome(pb, homeId)` call; pass result into `computeAreaCoverage` + `computeAreaCounts` |
| `app/(app)/h/[homeId]/person/page.tsx` | Same pattern for the person view — fetches tasks + completions → add overrides |
| (main dashboard page that renders `<BandView>`) | Fetches tasks + completions → add overrides fetch; pass into `<BandView>` as new prop |
| `lib/scheduler.ts` weekly summary call (line 318) | Already inside `processWeeklySummaries`; batch-fetch override Map before the `for (const member of eligible)` loop and thread into `computeWeeklySummary` |

### Component-level callers (indirect via props)

| File | Change |
|------|--------|
| `components/band-view.tsx:168-169` | Accept `overridesByTask: Map<string, Override>` as new prop; pass into `computeTaskBands` and `computeCoverage`. (BandView is a Client Component — the Map must be serializable, which it's not. Solution: serialize as `Record<string, Override>` at the Server Component boundary; `Object.entries` reconstruction inside the client, or convert to Map inline.) |
| `components/person-task-list.tsx:83` | Same pattern: new prop, pass into `computeTaskBands`. |
| `components/task-list.tsx:62` | Phase 2 tasks-list rendering on area detail page — pass `undefined` 4th arg (area detail is pre-completion Phase 2; no active overrides rendered). Alternatively, the area-detail page can fetch the Map and pass it in. Planner's call. |

### Test code (mechanical update only)

- `tests/unit/task-scheduling.test.ts` — 14 direct calls (§"Common Operation 3" above)
- Indirect callers inherit via their subjects (see fixture-churn estimate above)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| "Snooze" implemented as a completion row lie (pretend the task is done) | Dedicated `schedule_overrides` collection with `(task_id, snooze_until, consumed_at)` tuple | v1.1 audit Q1 locked 2026-04-22 | Snooze is now a first-class primitive; history preserved; read-time composition in `computeNextDue` |
| `applyOverride(nextDue, override)` wrapper helper | `computeNextDue(task, last, now, override?)` parameter | CONTEXT.md D-06 locked 2026-04-22 | Single source of truth; Phase 12+ callers inherit correct semantics automatically |
| Per-task N+1 override fetch in BandView | Batch `getActiveOverridesForHome` → `Map<taskId, Override>` | CONTEXT.md D-08 locked 2026-04-22 | Single roundtrip per render; mirrors `latestByTask` pattern |

**Deprecated/outdated:**
- None — this is a brand-new capability in the v1.0 → v1.1 transition. No deprecated code to remove.

## Assumptions Log

Claims made in this research that are NOT verified by a tool call or cited reference. Surface for user confirmation before planning if any feel load-bearing.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | PB SDK 0.26.8 `createBatch().send()` resolves to an array of `{ status, body }` objects in declaration order. | Pattern 4 | Planner's "read `results[0].body`" instruction fails; completeTaskAction needs the completion's id for downstream `sendPartnerCompletedNotifications`. Mitigation: treat this as the expected shape, but verify with a tiny spike test when Pattern 4 is implemented. If shape differs, the wrapper is ~3 lines; no architectural impact. |
| A2 | PB 0.37.1 DateField accepts empty-string / null for optional fields (`required: false`) and stores them as NULL. | Pattern 1 | If PB stores empty string for `consumed_at`, the `consumed_at = null` filter clause won't match, and active overrides will never surface via `getActiveOverride`. Mitigation: integration test Scenario 1 ("write override → read override → assert returned row") validates this on the first green run. |
| A3 | `pb.filter()` correctly parameterizes across the cross-table path `task_id.home_id = {:hid}` in PB 0.37.1. | Pattern 2 (batch helper) | Back-relation filter parameterization is subtler than flat-field parameterization; if PB 0.37 rejects, the batch helper throws and the integration test surfaces the problem before production. Mitigation: exemplar filter in `lib/scheduler.ts:208-212` uses flat `home_id = "xxx"` string concatenation on a pre-fetched-safe homeId; Phase 10 could do the same for the batch helper if needed (homeId comes from pb.authStore, not user input). |
| A4 | Phase 10's additive schema + helpers + signature extension leaves anchored-mode byte-identical to v1.0. | CONTEXT.md D-14 / REQ success criterion #6 | If a signature-extension test fails in anchored-mode branch, scope is clear (unintended behavior regression). Mitigation: the 02-05 anchored-mode exact-boundary test in `tests/unit/task-scheduling.test.ts:72-140` is already in place; running it green after the signature extension is the validation. |

## Open Questions

None — every decision in CONTEXT.md is locked, and every helper signature + migration shape is codified by existing exemplars. The discretion items in §"Claude's Discretion" are all flagged with recommended answers in CONTEXT.md itself.

One borderline item worth calling out for the planner:

1. **Batch-result payload shape.**
   - What we know: `pb.createBatch()` returns a handle; `.send()` returns `Promise<BatchResult[]>` in the SDK source. Each result is `{ status: number, body: Record<string, unknown> }`.
   - What's unclear: whether `body` on a `.create` is the full created record OR just its id.
   - Recommendation: the first task implementing Pattern 4 runs a 1-line spike (`console.log(results[0])`) in the integration test before committing; fold the finding into a code comment so Phase 15 reuses the pattern without rediscovery.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js runtime | `next dev`, `vitest`, PB SDK | ✓ | per Dockerfile (Next 16.2.4 requires ≥20.9) | — |
| PocketBase binary | disposable-PB integration test (port 18098); dev-pb script | ✓ | 0.37.1 at `.pb/pocketbase` | — |
| `pocketbase` JS SDK | All PB calls from Next.js | ✓ | 0.26.8 (package.json:37) | — |
| `zod` | New schema file | ✓ | 4.1.0 (package.json:45) | — |
| `date-fns` / `date-fns-tz` | Date math in helpers | ✓ | 4.1.0 / 3.2.0 | — |
| `vitest` | Unit + integration tests | ✓ | via devDependencies | — |
| `docker` / Docker buildx | Phase 10.N deploy (if separate deploy plan is inserted) | Not required for Phase 10 code work; required at the deploy step | — | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

Phase 10 is 100% code + migration + test work; all tooling is already in the repo.

## Validation Architecture

> `workflow.nyquist_validation: true` in `.planning/config.json`. Section REQUIRED.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `vitest` (version via devDependencies; same runner used across 311 existing unit tests) |
| Config file | `vitest.config.ts` in repo root (inferred from existing test layout; test files use `@vitest-environment node` for PB integration tests) |
| Quick run command | `npm test -- schedule-overrides` (runs only files matching the pattern) |
| Full suite command | `npm test` (i.e. `vitest run`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SNZE-04 | `schedule_overrides` PB collection exists with `(id, task_id, snooze_until, consumed_at, created)` and member-gated rules | integration | `npm test -- tests/integration/schedule-overrides.test.ts` | ❌ Wave 0 — `tests/integration/schedule-overrides.test.ts` creates disposable PB on port 18098, asserts collection exists, asserts cross-home access 404s (mirrors `tests/unit/rules-member-isolation.test.ts` pattern) |
| SNZE-05 | `computeNextDue` returns override date BEFORE natural branch; returns natural when override undefined | unit | `npm test -- tests/unit/schedule-overrides.test.ts` | ❌ Wave 0 — new file covers: override active+unconsumed → snooze_until; override consumed → natural; override undefined → natural; override present but snooze_until < lastCompletion → natural (D-10 read-time filter); archived task → null regardless of override |
| SNZE-06 | `completeTaskAction` writes `consumed_at` on any active override in the same batch as the completion | integration | `npm test -- tests/integration/schedule-overrides.test.ts::atomic-consumption` | ❌ Wave 0 — scenario: seed task + active override → call `completeTaskAction` → assert `completions` row exists AND `schedule_overrides.consumed_at` is non-null |
| SNZE-09 | Coverage ring reads snoozed next_due (snoozed tasks don't drag coverage) | unit | `npm test -- tests/unit/coverage.test.ts::override-branch` | ❌ Wave 0 — new test appends to existing `tests/unit/coverage.test.ts`: seed overdue task + active override snoozing into future → assert `computeCoverage` returns 1.0 for that task |
| SNZE-10 | Scheduler `ref_cycle` keys on effective (post-override) next-due | unit | `npm test -- tests/unit/scheduler.test.ts::override-ref-cycle` or a new unit test on `buildOverdueRefCycle` composition | ❌ Wave 0 — new test: given a task with an active override, `processOverdueNotifications` builds a `ref_cycle` containing the override's `snooze_until` ISO, not the natural next-due ISO. Existing `buildOverdueRefCycle` is already ISO-driven (lib/notifications.ts:53-58) — the test asserts the WIRING in the scheduler, not the builder. |
| All (D-14 regression) | All 311 existing unit + 23 E2E tests pass | full suite | `npm test && npm run test:e2e` | ✅ Infrastructure exists; only mechanical fixture-update needed (§"Common Operation 3") |

### Sampling Rate
- **Per task commit:** `npm test -- schedule-overrides` (~3-5 seconds for new unit tests; ~15 seconds if integration runs too)
- **Per wave merge:** `npm test` — full unit suite (~60 seconds locally, 311+ new tests)
- **Phase gate:** Full unit suite green + `npm run test:e2e` green before `/gsd-verify-work` closes the phase

### Wave 0 Gaps

- [ ] `tests/unit/schedule-overrides.test.ts` — pure helper logic + `computeNextDue` override branch unit tests. Covers REQ-SNZE-05.
- [ ] `tests/integration/schedule-overrides.test.ts` — disposable PB on port 18098. Covers REQ-SNZE-04 (collection + rules) and REQ-SNZE-06 (atomic consumption).
- [ ] (No new conftest / shared fixtures needed — the existing disposable-PB boot pattern in `tests/unit/hooks-completions-append-only.test.ts:34-76` is the template.)
- [ ] (No framework install — `vitest` is already wired.)

Plus mechanical edits to existing test files:
- `tests/unit/task-scheduling.test.ts` — add `undefined` 4th arg to 14 call sites.
- `tests/unit/coverage.test.ts`, `tests/unit/band-classification.test.ts`, `tests/unit/weekly-summary.test.ts`, `tests/unit/area-coverage.test.ts`, `tests/unit/scheduler.test.ts` — update helper signatures to accept `overridesByTask: Map<string, Override>` 3rd arg; most call sites pass `new Map()`.

## Security Domain

> `security_enforcement` not explicitly disabled in `.planning/config.json` — section REQUIRED.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | Member-gated PB rules are the source of truth for ownership; helpers are defense-in-depth only. Phase 10 adds no new auth tiers. |
| V2 Authentication | no | No new auth path — existing `pb.authStore` / `createServerClient` / `assertMembership` cover override reads and writes. |
| V3 Session Management | no | No new session surface. |
| V4 Access Control | yes | D-03 double-hop member rules; D-05 member-allowed update/delete. Cross-home-snooze attack (T-10-01) mitigated by rules alone; integration test asserts 404 for cross-home access. |
| V5 Input Validation | yes | Zod `.refine()` rejects past-date snooze (D-11). Field types constrained by PB `DateField` (PB parses ISO at write time). Task-id validated by membership check + PB RelationField `required: true`. |
| V6 Cryptography | no | No crypto surface in Phase 10. ISO strings, no token generation, no secret handling. |
| V7 Error Handling | yes | Best-effort error swallowing in fetch helpers (mirrors `lib/notifications.ts` `hasNotified` pattern) — PB 404 on no-active-override is the common case, NOT an error. Integration test asserts "no overrides" produces `null` return, not thrown exception. |
| V8 Data Protection | yes | `schedule_overrides.created_by_id` uses `cascadeDelete: false` — user delete preserves the audit trail on override rows (mirrors `completions.completed_by_id`). GDPR erasure consideration deferred to Phase 7 ops hardening (pre-existing posture). |
| V10 Malicious Code | yes | No eval, no template interpolation into PB filters — all filters use `pb.filter('x = {:y}', {y})` parameter binding. |
| V14 Config | yes | Migration down-hook is idempotent (Pitfall 10); no secrets in code; no env vars added. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| T-10-01 Cross-home snooze (user X snoozes a task in home Y where they're not a member) | Tampering / Elevation of Privilege | `createRule` double-hop member check (D-03) — PB rejects at the API layer; `task_id.home_id = @request.auth.home_members_via_user_id.home_id ?= task_id.home_id` pattern |
| T-10-02 Simultaneous snooze race (two members snooze the same task within ms) | Tampering | D-02 atomic-replace semantic — second writer consumes predecessor in its own write batch; both writes complete; reads see only the second row as active. UNIQUE INDEX not needed (soft contract). |
| T-10-03 Past-date snooze nonsense | Input Validation (V5) | D-11 Zod `.refine()` rejects at app layer with 30s clock-skew fudge; Phase 15 UI date picker disallows past dates at keystroke time |
| T-10-04 Consumed-row resurrection (admin sets `consumed_at = null` via Admin UI) | Tampering | D-10 read-time filter on `snooze_until > latest_completion.completed_at` — if admin revives an old override that's been superseded by a completion, the override silently falls through to natural next-due. Acceptable: "I un-consumed a stale override but the task was done since" → ignored. |
| SQL injection via filter string | Tampering (V5/V10) | `pb.filter('task_id = {:tid}', {tid: taskId})` — SDK-level parameterization; NEVER template-literal concat. [VERIFIED: lib/notifications.ts:93 exemplar] |
| Membership-gate bypass via body param tampering | Tampering | PB enforces the member rule at the DB layer; helpers are defense-in-depth only. `createRule` body-checks are unnecessary (D-04) because `task_id` membership is sufficient. |
| Stale authStore injection | Spoofing | Existing `createServerClient` / `createAdminClient` factories; Phase 10 adds no new auth surface. |

## Sources

### Primary (HIGH confidence) — verified against this repo's live code

- `/root/projects/homekeep/.planning/phases/10-schedule-override-foundation/10-CONTEXT.md` — all 16 locked decisions
- `/root/projects/homekeep/.planning/phases/10-schedule-override-foundation/10-DISCUSSION-LOG.md` — alternatives explicitly rejected
- `/root/projects/homekeep/.planning/v1.1/audit.md` §Q1 — original cross-cutting decisions on override storage strategy
- `/root/projects/homekeep/.planning/v1.1/audit-addendum-load.md` §2 + §8 — forward-compatibility confirmation; branch order
- `/root/projects/homekeep/pocketbase/pb_migrations/1714867200_completions.js` — double-hop rule exemplar, post-construction pattern, cascade semantics
- `/root/projects/homekeep/pocketbase/pb_migrations/1714953605_users_notification_prefs.js` — additive field migration pattern
- `/root/projects/homekeep/pocketbase/pb_migrations/1714953606_notifications.js` — new-collection rules with superuser-only writes (contrast — Phase 10 goes MEMBER writes per D-05)
- `/root/projects/homekeep/pocketbase/pb_migrations/1714953602_update_rules_multi_member.js` — `_via_` back-relation + `?=` operator exemplar
- `/root/projects/homekeep/pocketbase/pb_migrations/1714953600_home_members.js` — `home_members_via_user_id` rule syntax, UNIQUE INDEX pattern
- `/root/projects/homekeep/lib/task-scheduling.ts` — current `computeNextDue` implementation; signature baseline
- `/root/projects/homekeep/lib/coverage.ts` — `latestByTask` Map template for Phase 10's override Map
- `/root/projects/homekeep/lib/band-classification.ts` — another per-task loop caller of `computeNextDue`
- `/root/projects/homekeep/lib/scheduler.ts` — `processOverdueNotifications` loop to augment with batch override fetch
- `/root/projects/homekeep/lib/weekly-summary.ts` — 3rd per-task loop caller
- `/root/projects/homekeep/lib/actions/completions.ts` — `completeTaskAction`; Pattern 4 atomic consumption point
- `/root/projects/homekeep/lib/notifications.ts` — `buildOverdueRefCycle` (SNZE-10 free-by-construction pattern); `pb.filter` parameterization; best-effort accessor pattern
- `/root/projects/homekeep/lib/completions.ts` — `reduceLatestByTask` Map reducer exemplar
- `/root/projects/homekeep/lib/membership.ts` — `pb.filter` + `getFirstListItem` exemplar
- `/root/projects/homekeep/lib/actions/seed.ts` — `pb.createBatch()` atomic multi-op pattern
- `/root/projects/homekeep/lib/actions/invites.ts` — `pb.createBatch()` with mixed create + update ops
- `/root/projects/homekeep/lib/schemas/completion.ts` — zod schema exemplar (simple, no refine)
- `/root/projects/homekeep/lib/schemas/task.ts` — zod `.refine()` with `path:` exemplar (Phase 10's D-11 pattern)
- `/root/projects/homekeep/tests/unit/hooks-completions-append-only.test.ts` — disposable-PB integration test boot pattern
- `/root/projects/homekeep/tests/unit/scheduler.test.ts` — port-allocation log exemplar (18097); vi.mock of admin client
- `/root/projects/homekeep/tests/unit/task-scheduling.test.ts` — the 14 fixtures requiring mechanical update
- `/root/projects/homekeep/.planning/STATE.md` — decision log; v1.1 scope context
- `/root/projects/homekeep/.planning/REQUIREMENTS.md` — SNZE-04..06, 09, 10 verbatim
- `/root/projects/homekeep/.planning/ROADMAP.md` §"Phase 10" — success criteria

### Secondary (MEDIUM confidence) — repo observation cross-checked

- PB SDK version pin `"pocketbase": "0.26.8"` (package.json:37)
- PB server binary version `pocketbase version 0.37.1` (`.pb/pocketbase --version` output)
- Tested-port allocation log reconstructed via grep of `18090..18097` across `tests/` — 18098 is next available

### Tertiary (LOW confidence) — flagged for validation

- A1: `createBatch().send()` result shape — SDK declaration says `{status, body}[]` but behavior not directly exercised in this research session. 1-line console.log in Wave 0 integration test confirms.
- A2: PB DateField NULL semantics for `required: false` — inferred from `lib/notifications.ts:131-132` (`task_id: created.task_id ?? null`) and `1714953606_notifications.js:82-90` (`minSelect: 0` implies NULL-permitted). Integration test Scenario 1 confirms.
- A3: `pb.filter('task_id.home_id = {:hid}', ...)` cross-table parameterization — inferred from flat-field usage in this repo; direct proof requires running the batch helper against a real PB. If PB rejects, fall back to homeId template concat (homeId is pb-controlled, not user input, so the fallback has no injection surface).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every library is already in `package.json`, every version is verified on disk.
- Migration pattern: HIGH — four in-tree exemplars, every detail documented in the 02-01 deviation note.
- Helper API (`getActiveOverride`, `getActiveOverridesForHome`): HIGH — mirrors `latestByTask` / `reduceLatestByTask` patterns byte-for-byte.
- `computeNextDue` extension: HIGH — pure function; signature is additive; anchored-mode exact-boundary test in place.
- Atomic consumption: MEDIUM-HIGH — `pb.createBatch()` pattern has two in-tree exemplars; result-shape detail (A1) drops confidence to MEDIUM-HIGH; 1-line spike closes the gap.
- Zod `.refine()`: HIGH — exact exemplar in `lib/schemas/task.ts`.
- Callers grep: HIGH — exhaustive via `grep -rn "computeNextDue(" --include="*.ts"`.
- Pitfalls: HIGH — every pitfall has a concrete in-tree exemplar of the fix.

**Research date:** 2026-04-22
**Valid until:** 2026-05-22 (30 days — stable codebase; no fast-moving external dependencies; CONTEXT.md locked)
