# Phase 3: Core Loop - Research

**Researched:** 2026-04-20
**Domain:** React 19 optimistic UI + PocketBase append-only collections + SVG coverage ring + timezone-aware band classification
**Confidence:** HIGH (stack versions verified against registry; React/Next/PB APIs verified against official docs)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01 — `completions` collection (new PB migration `*_completions.js`):**
Fields — `task_id` (relation → tasks, required, cascadeDelete=true since PB cascades on task-row removal, but tasks archive not delete so cascade effectively never runs), `completed_by_id` (relation → users, required), `completed_at` (date, required, default now), `notes` (text, optional), `via` (select: `tap` | `manual-date`; default `tap`). Rules: auth required; user must own the home that owns the task.

**D-02 — Never delete completions:** Collection has NO delete rule (`deleteRule = null`). Archiving a task does not affect its completions.

**D-03 — Extend scheduling to consume lastCompletion:** `computeNextDue` signature stays the same (already accepts `lastCompletion`). Phase 3 adds `getLastCompletion(taskId)` to data access + `computeTaskBandAssignments(tasks, completions, now, homeTimezone)` returning `{ overdue, thisWeek, horizon }`.

**D-04 — Band classification:**
- `overdue`: `computeNextDue(...) < now`
- `thisWeek`: `now <= nextDue <= addDays(now, 7)`
- `horizon`: `nextDue > addDays(now, 7)`
- Archived tasks excluded from all bands.

**D-05 — Within-band sort:**
- Overdue: `daysOverdue DESC` (worst first)
- This Week: `nextDue ASC`
- Horizon: `nextDue ASC` (rendered as month-aggregated calendar)

**D-06 — Coverage ring formula:**
```ts
// taskHealth = clamp(1 - max(0, (now - nextDue) / frequency_days), 0, 1)
// coverage = mean(taskHealth) across all non-archived tasks
// 0 tasks → 100 (empty house = perfectly maintained; show "Add your first task" CTA)
```
Render as `Math.round(coverage * 100)`. Pure function in `lib/coverage.ts`.

**D-07 — Early-completion guard (COMP-02):** If `elapsed < 0.25 * frequency_days`, show confirm dialog.
Reference: `lastCompletion?.completed_at ?? task.created`.

**D-08 — One-tap completion (COMP-01):** Tap target = whole task row. Optimistic UI: task moves out of current band immediately + soft toast "Done — next due {formatted}". Server action writes completion; on failure revert + error toast.

**D-09 — `completeTaskAction(taskId, { force?: boolean })`:** if `force=false` and guard triggers, returns `{ requiresConfirm: true, elapsed, frequency, lastCompletion }` without writing. Client shows dialog, re-calls with `force=true`.

**D-10 — Append-only enforcement (COMP-03):** `updateRule = null` + `deleteRule = null` on `completions`. Document in SUMMARY.

**D-11 — Default landing at `/h/[homeId]` is BandView:** Replace current "areas list + task counts" stub. Areas remain at `/h/[homeId]/areas`.

**D-12 — Layout (mobile-first, stacks to desktop):** HomeSwitcher + CoverageRing at top → Overdue (conditional) → This Week → Horizon (12-month strip). shadcn Card for each band. Overdue: warm terracotta-sand border-left-4, not a red panic bar (SPEC §19 "information, not alarm").

**D-13 — This Week grouping:** If band has >5 items, group by day (today / tomorrow / weekday names). ≤5 items: flat list sorted ASC. Group headers muted-foreground.

**D-14 — Horizon component:** 12 cells = 12 months (starting from current month). Each cell: muted month label + 0..N dots for task occurrences. Tap → open `<Sheet>` listing tasks + exact due dates.

**D-15 — CoverageRing:** SVG with animated stroke-dashoffset, warm accent stroke, number in center, "on schedule" label. Pure component `percentage: number`. Hand-rolled (no libraries). Accessible: `role="img"` + `aria-label="Coverage X%"`.

**D-16 — Task row:** Icon + name + subtitle (`{freq}d · area`) + right-aligned badge (days-overdue or days-until-due). Entire row is tap target. Long-press / right-click → open detail sheet.

**D-17 — Task detail sheet (VIEW-06):** shadcn `<Sheet>` — bottom on mobile, right on desktop. Contents: name, area, freq, schedule mode, notes, next-due, Complete / Edit / Archive buttons, last 5 completions list.

**D-18 — Server Component at `/h/[homeId]` fetches in one round-trip:** all non-archived tasks (expand=area_id); most recent completion per task (query last 13 months bounded by max freq 365 + slack; reduce client-side); pass server-computed `{ overdue, thisWeek, horizon, coverage }` to Client Components.

**D-19 — Optimistic update via `useOptimistic`:** update client-side task→completion map on tap; server action writes real record; on success `router.refresh()` re-syncs.

**D-20 — Unit (Vitest):**
- `lib/task-scheduling.ts`: reverify "with completion" path.
- `lib/band-classification.ts`: `computeTaskBands(tasks, completions, now)` matrix.
- `lib/coverage.ts`: `computeCoverage(tasks, completions, now)` matrix.
- `lib/early-completion-guard.ts`: `shouldWarnEarly(task, lastCompletion, now)` matrix.

**D-21 — E2E (Playwright):**
- Create home + task (freq=7d) → visit `/h/[id]` → task in This Week band → tap → confirm guard (just-created task triggers) → accept → toast + task moves to horizon → reload + coverage updated.
- Seed "stale" task (created 10d ago, freq=7) → reload → Overdue band → tap → no guard → task moves out + coverage ticks up.

### Claude's Discretion

- Exact animation duration on coverage ring (default 600ms ease-out)
- Colour tokens for overdue indicator (stays within warm palette)
- Tap feedback haptics (mobile-only, via CSS `:active`)
- Sheet vs Dialog for task detail (Sheet chosen — more room, edge-slide)

### Deferred Ideas (OUT OF SCOPE)

- Multi-user cascading assignee display on task rows — Phase 4
- By Area / Person / History dedicated routes — Phase 5
- Completion photos — v1.1
- Year-in-review — v1.1
- Streaks / celebrations — Phase 6
- Notifications — Phase 6
- PWA manifest / offline — Phase 7
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| COMP-01 | User can complete a task with one tap (records who, when) | §Optimistic Completion Flow; §Server Action Pattern; §Pitfalls 1, 7 |
| COMP-02 | Early-completion guard prompts when <25% of cycle elapsed | §Early-Completion Guard Algorithm; §Guard Edge Cases |
| COMP-03 | Completions are append-only history (never deleted) | §Completions Collection Migration; §PocketBase API Rule Semantics |
| VIEW-01 | Default screen shows three bands | §Band Classification; §Architectural Responsibility Map |
| VIEW-02 | Overdue band only appears when overdue exists, sorted by days-overdue | §Band Classification; §Empty States |
| VIEW-03 | This Week: 7-day window, grouped by day if >5 items | §This Week Grouping |
| VIEW-04 | Horizon: 12-month calendar strip with dots/pills per month | §Horizon Component; §Timezone-Safe Month Bucketing |
| VIEW-05 | Coverage ring shows % of annual maintenance on track | §Coverage Formula Validation; §SVG Coverage Ring |
| VIEW-06 | Tapping a task allows completion or viewing details | §Task Detail Sheet; §shadcn Sheet Installation |
</phase_requirements>

## Summary

Phase 3 is a focused React-19-plus-PocketBase layer on top of the Phase 2 data model. Every locked decision has a verified, standard pattern in the React/Next/PB ecosystem as of April 2026 — no novel primitives, no bleeding-edge APIs, no hand-rolled solutions where a library already solves the problem. Four pieces need custom code: the `computeTaskBands` / `computeCoverage` / `shouldWarnEarly` pure functions (Vitest matrix), the SVG coverage ring (single file, <80 lines), the horizon month strip (CSS grid + date-fns-tz), and the `completeTaskAction` server action (mirrors the Phase 2 `archiveTask` shape).

The two load-bearing patterns to get right are (a) **PocketBase's "latest completion per task" query** (PB has no native `GROUP BY` / `TOP-1-PER-GROUP`, so a bounded full-range fetch + client-side reduce is the standard approach at Phase 3 scale of <1000 tasks per home), and (b) **React 19 `useOptimistic` reconciliation when the parent Server Component re-renders with fresh data** (the reducer pattern is mandatory — the updater-function form drops concurrent props updates). Both are well-documented and well-understood; the research below shows the exact code.

**Primary recommendation:** Ship `BandView` as a single Client Component that receives pre-classified `{ overdue, thisWeek, horizon, coverage }` from the Server Component page. Use `useOptimistic` with a **reducer** (not updater) so completions applied optimistically survive parent re-renders. Install shadcn `Sheet` (missing from the current UI set), keep everything else using the existing shadcn/Radix stack. Use `null` rules on the completions collection's updateRule+deleteRule for append-only enforcement per PB's verified semantics.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Band classification (overdue/thisWeek/horizon) | Frontend Server (SSR) | Client (re-classify on optimistic update) | Deterministic pure function; server renders correctly on first paint. Client re-runs after optimistic completion adjusts the completion map. |
| Coverage formula | Frontend Server (SSR) | Client (re-compute on optimistic update) | Same — pure function, server bakes the initial %; client recalculates during optimistic reconciliation. |
| Completion write | API (PocketBase) | — | Append-only create. Ownership enforced via PB createRule. |
| Latest-completion-per-task query | API (PocketBase) | Client (reduce) | PB fetch is bounded by 13 months; client reduces to a `Map<taskId, Completion>` for O(N) lookup. |
| Optimistic UI state | Client | — | React 19 `useOptimistic` is client-only. Parent SSR provides the baseline `completions` array. |
| Early-completion guard decision | Client (first-pass UX) | API (defense-in-depth) | Client guard prevents unnecessary server round-trips; server action re-checks with `force=false` to block automated bypass. |
| Timezone-aware date formatting | Client | — | `date-fns-tz` IANA DB already loaded client-side (Phase 2 pattern in `NextDueDisplay`). |
| Horizon month bucketing | Frontend Server | — | Pure computation over `nextDue` + home timezone; runs once per request. |
| Task detail sheet | Client | Frontend Server (initial completions fetch) | Sheet interactivity (open/close, focus trap) is client; content hydrates from the server-passed last-5-completions. |

## Standard Stack

### Core (already installed — verified via `npm view` 2026-04-20)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `react` / `react-dom` | 19.2.5 | Framework | `useOptimistic` + `useTransition` + Actions API are native React 19 primitives [VERIFIED: npm registry + react.dev docs] |
| `next` | 16.2.4 | App router + server actions | Server actions + `revalidatePath` + `router.refresh` are the blessed data-mutation path [VERIFIED: nextjs.org/docs] |
| `pocketbase` | 0.26.8 | JS SDK (server + browser) | Already-pinned SDK with `getFullList`, realtime, batch APIs [VERIFIED: npm registry] |
| `date-fns` | 4.1.0 | UTC date math | Already pinned + used by `computeNextDue` [VERIFIED: existing] |
| `date-fns-tz` | 3.2.0 | IANA timezone formatting + zoning | Already used by `NextDueDisplay`; provides `formatInTimeZone`, `toZonedTime`, `fromZonedTime` [VERIFIED: github.com/marnusw/date-fns-tz] |
| `sonner` | 2.0.7 | Toast notifications | Already wired in root layout (`<Toaster />`); used for success + error toasts [VERIFIED: app/layout.tsx grep] |
| `react-hook-form` | 7.73.1 | Form state (detail sheet inline edits later) | Phase 2 template [VERIFIED: existing] |
| `zod` | 4.1.0 | Schema validation | Phase 2 pattern for `completionSchema` [VERIFIED: existing] |
| `radix-ui` | 1.4.3 | Umbrella package for shadcn primitives | Already installed; provides `Dialog` primitives used by shadcn's Sheet wrapper [VERIFIED: node_modules/@radix-ui/react-dialog] |
| `lucide-react` | 1.8.0 | Icons | Phase 2 pin [VERIFIED: existing] |
| `tailwindcss` | 4.2.2 | Styling | Phase 2 pin [VERIFIED: existing] |

### Supporting (to add in Phase 3)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| shadcn `Sheet` component | n/a (codegen) | Bottom-on-mobile / right-on-desktop drawer for task detail | `pnpm dlx shadcn@latest add sheet` — uses existing Radix Dialog primitives under the hood [CITED: ui.shadcn.com/docs/components/sheet] |

**Note:** shadcn components are codegenerated into `components/ui/` — no runtime dependency is added. The existing project uses the `radix-ui` umbrella package (v1.4.3) with the `DialogPrimitive` import form; shadcn's current Sheet template uses the same import style, so no new npm install is needed beyond the `shadcn` CLI run.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Client-side reduce for latest-completion-per-task | PB JSVM custom route with SQL `MAX(completed_at) GROUP BY task_id` | JSVM route adds deploy complexity + a custom endpoint to version; at <1000 tasks per home (v1 target) the reduce is O(N) on a 13-month bounded fetch. Keep client-side. |
| Client-side reduce | PB realtime subscription for live `latestCompletion[taskId]` updates | Realtime adds a stateful subscription, reconnection logic, and breaks the "one round-trip Server Component" model. Defer until multi-user (Phase 4) if ever. |
| Hand-rolled SVG coverage ring | `@chakra-ui/progress` / `react-circular-progressbar` | Adds a runtime dep for ~30 lines of SVG. Hand-rolled is verified working pattern + full style control for the warm accent. |
| `useOptimistic` for completion UI | Pure `useState` + full page refresh | `useState` alone loses the automatic-rollback-on-throw behavior React 19 gives for free. [CITED: react.dev/reference/react/useOptimistic] |
| shadcn `Sheet` | shadcn `Dialog` + CSS media query for bottom-positioning | `Sheet` already ships the side="bottom"/"right" prop. Reimplementing is work for no benefit. |

**Installation:**
```bash
# Phase 3 install
pnpm dlx shadcn@latest add sheet
# or if project uses npm:
npx shadcn@latest add sheet
# No additional runtime deps — Sheet is codegen + uses existing radix-ui umbrella.
```

**Version verification:** All pinned versions match registry `latest` as of 2026-04-20:
- `react@19.2.5` ✓
- `next@16.2.4` ✓
- `pocketbase@0.26.8` ✓
- `sonner@2.0.7` ✓
- `date-fns-tz@3.2.0` ✓
- `@radix-ui/react-dialog@1.1.15` ✓ (via umbrella `radix-ui@1.4.3`)

## Architecture Patterns

### System Architecture Diagram

```
                          REQUEST
                             │
                             ▼
              ┌───────────────────────────────┐
              │ /h/[homeId]  Server Component │
              │ (app/(app)/h/[homeId]/page.tsx)│
              └───────────────────────────────┘
                             │
                 parallel: Promise.all
                             │
      ┌──────────────────────┼──────────────────────┐
      ▼                      ▼                      ▼
 PB tasks               PB completions         PB home (for timezone)
 (filter: home_id,      (filter: task_id IN     getOne(homeId)
  archived=false,        [taskIds] &&
  expand=area_id)        completed_at >=
                         13-months-ago)
      │                      │                      │
      └──────────────┬───────┴──────────┬───────────┘
                     ▼                  ▼
              Array<Task>         Array<Completion>
                     │                  │
                     └────────┬─────────┘
                              ▼
              ┌───────────────────────────────┐
              │ Reduce: latestByTask =        │
              │   Map<taskId, Completion>     │
              │ (client-side, pure function)  │
              └───────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │ computeTaskBands(             │
              │   tasks, latestByTask,        │
              │   now, homeTimezone)          │
              │ → { overdue, thisWeek,        │
              │     horizon }                 │
              │                               │
              │ computeCoverage(              │
              │   tasks, latestByTask, now)   │
              │ → percentage 0-1              │
              └───────────────────────────────┘
                              │
                              ▼ (props)
              ┌───────────────────────────────┐
              │ BandView  (Client Component)  │
              │  ↳ useOptimistic(completions) │
              │  ↳ CoverageRing               │
              │  ↳ OverdueBand (if count>0)   │
              │  ↳ ThisWeekBand               │
              │  ↳ HorizonStrip               │
              │  ↳ TaskDetailSheet (on tap)   │
              │  ↳ EarlyCompletionDialog      │
              └───────────────────────────────┘
                              │
                     TAP ROW  │  (one-tap complete)
                              ▼
              ┌───────────────────────────────┐
              │ 1. Client: shouldWarnEarly?   │
              │ 2. If yes → show dialog       │
              │ 3. On confirm → call          │
              │    completeTaskAction(taskId, │
              │    { force: true })           │
              │ 4. addOptimisticCompletion()  │
              │ 5. startTransition(async()…)  │
              └───────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │ completeTaskAction            │
              │ (lib/actions/completions.ts)  │
              │  1. Parse taskId + force      │
              │  2. Ownership preflight       │
              │     (task.home_id.owner==me)  │
              │  3. If !force → guard check   │
              │     → return {requiresConfirm}│
              │  4. Create completion record  │
              │  5. revalidatePath(/h/homeId) │
              │  6. return { ok, completion } │
              └───────────────────────────────┘
                              │
                              ▼
              On success: router.refresh() → Server Component re-renders
                          → fresh props flow down → optimistic reconciles
              On throw:   optimistic auto-rolls back → error toast
```

### Recommended Project Structure

```
lib/
├── band-classification.ts      # NEW — pure computeTaskBands(tasks, latest, now, tz)
├── coverage.ts                 # NEW — pure computeCoverage(tasks, latest, now)
├── early-completion-guard.ts   # NEW — pure shouldWarnEarly(task, last, now)
├── completions.ts              # NEW — data access helpers (getCompletionsForHome, reduceLatest)
├── task-scheduling.ts          # EXTEND (Phase 2) — no signature change; pass real lastCompletion
├── schemas/
│   └── completion.ts           # NEW — zod completionSchema + ForceCompletionInput type
└── actions/
    └── completions.ts          # NEW — completeTaskAction server action

components/
├── band-view.tsx               # NEW — top-level Client Component; owns useOptimistic
├── coverage-ring.tsx           # NEW — SVG + stroke-dashoffset + prefers-reduced-motion
├── task-band.tsx               # NEW — reusable band Card with header + rows
├── task-row.tsx                # NEW — tappable row (entire row target; long-press → sheet)
├── horizon-strip.tsx           # NEW — 12-month strip; taps open Sheet
├── task-detail-sheet.tsx       # NEW — shadcn <Sheet> with detail + actions + last-5-completions
├── early-completion-dialog.tsx # NEW — shadcn <Dialog> confirm
└── ui/
    └── sheet.tsx               # NEW — shadcn codegen

app/(app)/h/[homeId]/page.tsx   # REWRITE — fetches tasks + completions + home; passes to BandView

pocketbase/pb_migrations/
└── 1714867200_completions.js   # NEW — completions collection with null update/delete rules

tests/unit/
├── band-classification.test.ts # NEW
├── coverage.test.ts            # NEW
├── early-completion-guard.test.ts # NEW
└── schemas/completion.test.ts  # NEW

tests/e2e/
└── core-loop.spec.ts           # NEW — D-21 both scenarios
```

### Pattern 1: PocketBase completions collection with append-only enforcement

**What:** A new migration creates the `completions` collection with `updateRule = null` and `deleteRule = null`, which per PB's documented semantics means only superusers can update/delete — regular API callers get 403. The `listRule`, `viewRule`, and `createRule` are scoped to "authenticated user who owns the home that owns the task".

**When to use:** Every append-only audit-trail collection. Same pattern will apply to activity logs (Phase 5 History view), invite-accepted events (Phase 4), and scheduler-fired notifications (Phase 6).

**Example:**
```javascript
// pocketbase/pb_migrations/1714867200_completions.js
/// <reference path="../pb_data/types.d.ts" />
// Source: CITED pocketbase.io/docs/api-rules-and-filters ("null = locked, only superusers; '' = everyone")
// Source: CITED pocketbase.io/docs/collections/ (rule syntax)
// Source: VERIFIED against Phase 2 init migration (pocketbase/pb_migrations/1714780800_init_homekeep.js)

migrate((app) => {
  const tasks = app.findCollectionByNameOrId("tasks");
  const users = app.findCollectionByNameOrId("users");

  const completions = new Collection({
    type: "base",
    name: "completions",
    // LIST/VIEW/CREATE: auth + ownership through the task's home.
    // The double-hop `task_id.home_id.owner_id` is supported by PB filter DSL.
    listRule:   '@request.auth.id != "" && task_id.home_id.owner_id = @request.auth.id',
    viewRule:   '@request.auth.id != "" && task_id.home_id.owner_id = @request.auth.id',
    createRule: '@request.auth.id != "" && task_id.home_id.owner_id = @request.auth.id && @request.body.completed_by_id = @request.auth.id',
    // D-10: null = locked to superusers; regular API callers get 403.
    // Ensures completions are truly append-only from the app's perspective.
    updateRule: null,
    deleteRule: null,
  });

  completions.fields.add(new RelationField({
    name: "task_id",
    required: true,
    collectionId: tasks.id,
    cascadeDelete: true, // if a task is ever hard-deleted, completions go with it
    minSelect: 1,
    maxSelect: 1,
  }));
  completions.fields.add(new RelationField({
    name: "completed_by_id",
    required: true,
    collectionId: users.id,
    cascadeDelete: false,
    minSelect: 1,
    maxSelect: 1,
  }));
  completions.fields.add(new DateField({
    name: "completed_at",
    required: true,
  }));
  completions.fields.add(new TextField({ name: "notes", max: 2000 }));
  completions.fields.add(new SelectField({
    name: "via",
    required: true,
    values: ["tap", "manual-date"],
    maxSelect: 1,
  }));
  completions.fields.add(new AutodateField({ name: "created", onCreate: true }));

  completions.indexes = [
    // The two critical access paths:
    // 1. "latest completion per task for a given list of task_ids"
    "CREATE INDEX idx_completions_task_completed ON completions (task_id, completed_at)",
    // 2. "all completions in the last N months across a home" (for the batched fetch)
    "CREATE INDEX idx_completions_completed_at ON completions (completed_at)",
  ];
  app.save(completions);
}, (app) => {
  try {
    const c = app.findCollectionByNameOrId("completions");
    app.delete(c);
  } catch (_) { /* idempotent */ }
});
```

**Why the create rule includes `@request.body.completed_by_id = @request.auth.id`:** Prevents a user from forging completions-on-behalf-of-another-user. Even though only the authenticated user can reach the endpoint, the body-check is defense-in-depth for Phase 4 multi-user.

### Pattern 2: Latest-completion-per-task via bounded fetch + client-side reduce

**What:** PocketBase has no native `GROUP BY ... MAX(completed_at) LIMIT 1 PER group` [VERIFIED: pocketbase.io/docs/api-records]. The standard approach at Phase 3 scale is to fetch all completions within a bounded recency window (13 months covers the longest frequency of 365 days + slack) and reduce client-side to a `Map<taskId, Completion>`.

**When to use:** Default for v1. Revisit if a single home ever has >10,000 completions (not realistic for a single-home maintenance app).

**Example:**
```ts
// lib/completions.ts (data access)
import type { Completion } from '@/lib/task-scheduling';
import type PocketBase from 'pocketbase';

/**
 * Fetch all completions for a home's tasks in the recency window.
 * Bounded by max frequency (365d) + slack to avoid unbounded growth over years.
 * Source: CITED pocketbase.io/docs/api-records (getFullList + filter syntax)
 */
export async function getCompletionsForHome(
  pb: PocketBase,
  taskIds: string[],
  now: Date,
): Promise<Completion[]> {
  if (taskIds.length === 0) return [];
  // 13 months = 395 days; longest freq is 365 plus ~30d buffer.
  const cutoffIso = new Date(now.getTime() - 395 * 24 * 60 * 60 * 1000).toISOString();
  // PB filter DSL: use task_id ~ "id1" || task_id ~ "id2" ... or task_id.id ?= for relation IN.
  // Safer: build the list using pb.filter() for escaping.
  const idFilter = taskIds.map((id) => `task_id = "${id}"`).join(' || ');
  return await pb.collection('completions').getFullList({
    filter: `(${idFilter}) && completed_at >= "${cutoffIso}"`,
    sort: '-completed_at',
    fields: 'id,task_id,completed_by_id,completed_at,notes,via',
    // getFullList internally paginates up to Infinity; pass `batch` to override PB's default of 500.
    batch: 500,
  });
}

/**
 * Pure reducer: group a flat completions array to a Map keyed by task_id
 * containing the most-recent completion for each task.
 * Source: VERIFIED — idiomatic JS Array.reduce pattern.
 */
export function reduceLatestByTask(
  completions: Completion[],
): Map<string, Completion> {
  const m = new Map<string, Completion>();
  for (const c of completions) {
    const prev = m.get(c.task_id);
    if (!prev || new Date(c.completed_at) > new Date(prev.completed_at)) {
      m.set(c.task_id, c);
    }
  }
  return m;
}
```

**Pitfall avoidance:** PB `getFullList`'s `batch` parameter overrides the default 500-per-request page size [VERIFIED against SDK source]. The default `perPage` of 30 is for `getList`, not `getFullList` — the SDK's `getFullList` auto-paginates.

### Pattern 3: `useOptimistic` with reducer + `router.refresh` reconciliation

**What:** The React 19 reducer form of `useOptimistic` re-runs the reducer when the parent's `value` prop changes while the action is still pending. This is mandatory for our case — `router.refresh()` will re-fetch the Server Component and push new `completions` down; the reducer ensures the optimistic completion stays visible until the server-confirmed version arrives [CITED: react.dev/reference/react/useOptimistic].

**When to use:** Any time the optimistic update is additive (append to list) and the parent may re-render during the action.

**Example:**
```tsx
// components/band-view.tsx
'use client';
import { useOptimistic, useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { completeTaskAction } from '@/lib/actions/completions';
import { computeTaskBands } from '@/lib/band-classification';
import { computeCoverage } from '@/lib/coverage';
import { shouldWarnEarly } from '@/lib/early-completion-guard';
import type { Completion } from '@/lib/task-scheduling';
// ... other imports

type Props = {
  tasks: TaskWithArea[];
  completions: Completion[];   // flat list for the home, last 13 months
  userId: string;
  homeId: string;
  timezone: string;
  now: string;                 // ISO — server-owned clock (Phase 2 pattern)
};

export function BandView({ tasks, completions, userId, homeId, timezone, now }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [guardState, setGuardState] = useState<GuardState | null>(null);

  // Reducer form — re-runs with the fresh `completions` prop when the parent
  // (Server Component) re-renders after router.refresh().
  // Source: CITED react.dev/reference/react/useOptimistic
  const [optimisticCompletions, addOptimisticCompletion] = useOptimistic(
    completions,
    (current: Completion[], added: Completion): Completion[] => [...current, added],
  );

  // Re-derive bands + coverage from the optimistic completions.
  // Pure functions; zero cost to recompute per render.
  const nowDate = new Date(now);
  const latestByTask = reduceLatestByTask(optimisticCompletions);
  const bands = computeTaskBands(tasks, latestByTask, nowDate, timezone);
  const coverage = computeCoverage(tasks, latestByTask, nowDate);

  async function handleComplete(taskId: string, { force = false } = {}) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const lastCompletion = latestByTask.get(taskId) ?? null;

    // Client-side guard (UX); server re-checks for defense-in-depth.
    if (!force && shouldWarnEarly(task, lastCompletion, nowDate)) {
      setGuardState({ task, lastCompletion, nowDate });
      return;
    }

    setPendingTaskId(taskId);
    startTransition(async () => {
      // Synthesize the optimistic completion row client-side.
      const optimistic: Completion = {
        id: `optimistic-${taskId}-${Date.now()}`,
        task_id: taskId,
        completed_by_id: userId,
        completed_at: new Date().toISOString(),
        notes: '',
        via: 'tap',
      };
      addOptimisticCompletion(optimistic);

      try {
        const result = await completeTaskAction(taskId, { force });
        if (result.requiresConfirm) {
          // Server-side guard fired (e.g. client was stale). Show the dialog.
          setGuardState({ task, lastCompletion, nowDate });
          return;
        }
        if (!result.ok) {
          throw new Error(result.formError ?? 'Could not complete task');
        }
        toast.success(`Done — next due ${result.nextDueFormatted}`);
        router.refresh(); // Re-fetch Server Component; fresh completions prop flows in.
      } catch (err) {
        // React 19 auto-rolls back the optimistic state because `completions` prop
        // is unchanged. Source: CITED react.dev/reference/react/useOptimistic (§ Handling failed actions)
        toast.error(err instanceof Error ? err.message : 'Could not complete task');
      } finally {
        setPendingTaskId(null);
      }
    });
  }

  return (
    <div>
      <CoverageRing percentage={Math.round(coverage * 100)} />
      {bands.overdue.length > 0 && (
        <TaskBand
          label="Overdue"
          tasks={bands.overdue}
          onComplete={handleComplete}
          pendingTaskId={pendingTaskId}
          timezone={timezone}
          variant="overdue"
        />
      )}
      <TaskBand label="This Week" tasks={bands.thisWeek} onComplete={handleComplete}
                pendingTaskId={pendingTaskId} timezone={timezone} />
      <HorizonStrip tasks={bands.horizon} now={nowDate} timezone={timezone} />
      {guardState && (
        <EarlyCompletionDialog
          state={guardState}
          onConfirm={() => { const t = guardState.task; setGuardState(null); handleComplete(t.id, { force: true }); }}
          onCancel={() => setGuardState(null)}
        />
      )}
    </div>
  );
}
```

### Pattern 4: `completeTaskAction` with typed result (requiresConfirm | ok)

**What:** The server action accepts `taskId` + an options object, returns a discriminated-union result. The `requiresConfirm` branch lets the client show its confirm dialog without the action throwing. On `ok: true`, the action includes the computed `nextDueFormatted` so the toast can show it without another round-trip.

**When to use:** Any server action that has "maybe-proceed" semantics (early-completion guard, duplicate detection, rate-limited retry).

**Example:**
```ts
// lib/actions/completions.ts
'use server';
import { revalidatePath } from 'next/cache';
import { formatInTimeZone } from 'date-fns-tz';
import { createServerClient } from '@/lib/pocketbase-server';
import { shouldWarnEarly } from '@/lib/early-completion-guard';
import { computeNextDue } from '@/lib/task-scheduling';

export type CompleteResult =
  | { ok: true; completion: { id: string; completed_at: string }; nextDueFormatted: string }
  | { ok: false; formError: string }
  | { requiresConfirm: true; elapsed: number; frequency: number; lastCompletedAt: string | null };

export async function completeTaskAction(
  taskId: string,
  opts: { force?: boolean } = {},
): Promise<CompleteResult> {
  if (typeof taskId !== 'string' || taskId.length === 0) {
    return { ok: false, formError: 'Missing task id' };
  }
  const pb = await createServerClient();
  if (!pb.authStore.isValid) return { ok: false, formError: 'Not signed in' };
  const userId = pb.authStore.record?.id as string;

  try {
    // Ownership preflight via viewRule — cross-user forged ids 404 here.
    const task = await pb.collection('tasks').getOne(taskId, {
      fields: 'id,home_id,frequency_days,schedule_mode,anchor_date,archived,created,name',
      expand: 'home_id',
    });
    if (task.archived) return { ok: false, formError: 'Task is archived' };

    // Fetch home for timezone (used for the toast formatting).
    const homeId = task.home_id as string;
    const home = await pb.collection('homes').getOne(homeId, { fields: 'id,timezone' });

    // Latest completion for this task (guards against client-stale state).
    let lastCompletion = null;
    try {
      lastCompletion = await pb.collection('completions').getFirstListItem(
        `task_id = "${taskId}"`,
        { sort: '-completed_at', fields: 'id,completed_at' },
      );
    } catch {
      // No prior completion — that's fine.
    }

    const now = new Date();
    if (!opts.force) {
      const taskForGuard = {
        created: task.created as string,
        frequency_days: task.frequency_days as number,
      };
      const lastForGuard = lastCompletion
        ? { completed_at: lastCompletion.completed_at as string }
        : null;
      if (shouldWarnEarly(taskForGuard, lastForGuard, now)) {
        const ref = lastCompletion?.completed_at ?? task.created;
        const elapsed = (now.getTime() - new Date(ref as string).getTime()) / 86400000;
        return {
          requiresConfirm: true,
          elapsed,
          frequency: task.frequency_days as number,
          lastCompletedAt: (lastCompletion?.completed_at as string) ?? null,
        };
      }
    }

    // Write the completion. PB createRule enforces ownership + completed_by_id = auth.id.
    const created = await pb.collection('completions').create({
      task_id: taskId,
      completed_by_id: userId,
      completed_at: now.toISOString(),
      via: 'tap',
      notes: '',
    });

    // Compute next-due for the success toast.
    const nextDue = computeNextDue(
      {
        id: task.id,
        created: task.created as string,
        archived: false,
        frequency_days: task.frequency_days as number,
        schedule_mode: task.schedule_mode as 'cycle' | 'anchored',
        anchor_date: (task.anchor_date as string | null) || null,
      },
      { completed_at: now.toISOString() },
      now,
    );
    const nextDueFormatted = nextDue
      ? formatInTimeZone(nextDue, home.timezone as string, 'MMM d, yyyy')
      : 'soon';

    revalidatePath(`/h/${homeId}`);
    return {
      ok: true,
      completion: { id: created.id, completed_at: created.completed_at as string },
      nextDueFormatted,
    };
  } catch {
    return { ok: false, formError: 'Could not record completion' };
  }
}
```

### Pattern 5: SVG coverage ring (hand-rolled, <80 lines, accessible)

**What:** A single SVG with two concentric circles — a muted track + a colored progress arc. Progress uses `stroke-dasharray` + `stroke-dashoffset` (radius 16 trick so circumference ≈ 100 and offset = 100 − percentage). Rotate -90deg so stroke starts at 12 o'clock. CSS transition on `stroke-dashoffset` gives the animation; `prefers-reduced-motion` disables it.

**When to use:** The main dashboard ring. Other progress rings (per-area coverage in Phase 5) will reuse this component.

**Example:**
```tsx
// components/coverage-ring.tsx
'use client';
/**
 * CoverageRing — pure display component.
 * Source: VERIFIED css-tricks.com/building-progress-ring-quickly + nikitahl.com/svg-circle-progress
 * Radius 16 trick: circumference = 2*π*16 ≈ 100.53 ≈ 100. Set stroke-dasharray="100 100" and
 * offset = 100 - percentage.
 *
 * Accessibility:
 *  - role="img" + aria-label so screen readers read the percentage.
 *  - prefers-reduced-motion: snap to final value (no transition).
 *
 * No runtime deps; just Tailwind classes.
 */
export function CoverageRing({ percentage }: { percentage: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(percentage)));
  const offset = 100 - clamped;
  return (
    <div
      role="img"
      aria-label={`Coverage ${clamped}%`}
      className="relative inline-flex size-28 items-center justify-center"
    >
      <svg viewBox="0 0 36 36" className="size-28 -rotate-90" aria-hidden="true">
        {/* Track */}
        <circle
          cx="18" cy="18" r="16"
          fill="none"
          className="stroke-muted"
          strokeWidth="3"
        />
        {/* Progress */}
        <circle
          cx="18" cy="18" r="16"
          fill="none"
          className="stroke-[color:var(--accent-warm,#D4A574)] motion-safe:transition-[stroke-dashoffset] motion-safe:duration-[600ms] motion-safe:ease-out"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="100 100"
          strokeDashoffset={offset}
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold tabular-nums">{clamped}%</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">on schedule</span>
      </div>
    </div>
  );
}
```

**Notes:**
- The `motion-safe:` Tailwind prefix applies the transition only when `prefers-reduced-motion: no-preference` [VERIFIED: tailwindcss.com motion-safe variant].
- The rotate is on the SVG element (`-rotate-90`), so the stroke starts at 12 o'clock clockwise.
- The `var(--accent-warm, #D4A574)` fallback matches the Phase 2 area-palette anchor color.

### Pattern 6: Horizon 12-month strip with timezone-safe bucketing

**What:** Compute the 12 months starting from `now`'s month in the home timezone. For each task in the horizon band, determine which month bucket its `nextDue` falls into using `formatInTimeZone` (NOT raw `.getMonth()` which uses the server's local timezone and will cross DST boundaries wrong). Render a 12-cell CSS grid; each cell shows 0..N dots.

**When to use:** The horizon band. Same pattern applies to future calendar views (Person view's "my tasks this year").

**Example:**
```tsx
// components/horizon-strip.tsx
'use client';
import { formatInTimeZone } from 'date-fns-tz';
import { addMonths, startOfMonth } from 'date-fns';
import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
// Source: CITED github.com/marnusw/date-fns-tz (formatInTimeZone signature)

export function HorizonStrip({
  tasks,
  now,
  timezone,
}: {
  tasks: Array<{ id: string; name: string; nextDue: Date }>;
  now: Date;
  timezone: string;
}) {
  const [openMonthKey, setOpenMonthKey] = useState<string | null>(null);

  // Build 12 month keys using the home's timezone.
  // formatInTimeZone('yyyy-MM') gives us the month the date falls into
  // when observed in the home's timezone — NOT the server's.
  const months: { key: string; label: string; date: Date }[] = [];
  for (let i = 0; i < 12; i++) {
    // Work in UTC then format in zone; start-of-month is approximate (calendar month).
    // For Phase 3 v1 this is acceptable — the strip is a visual scan, not an exact edge.
    const d = startOfMonth(addMonths(now, i));
    months.push({
      key: formatInTimeZone(d, timezone, 'yyyy-MM'),
      label: formatInTimeZone(d, timezone, 'MMM'),
      date: d,
    });
  }

  // Bucket tasks by month key.
  const buckets = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const k = formatInTimeZone(t.nextDue, timezone, 'yyyy-MM');
    const arr = buckets.get(k) ?? [];
    arr.push(t);
    buckets.set(k, arr);
  }

  const openTasks = openMonthKey ? (buckets.get(openMonthKey) ?? []) : [];

  return (
    <>
      <div className="grid grid-cols-12 gap-1">
        {months.map((m) => {
          const count = (buckets.get(m.key) ?? []).length;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => count > 0 && setOpenMonthKey(m.key)}
              className="flex min-h-[44px] flex-col items-center justify-center gap-1 rounded border p-1 text-xs"
              aria-label={`${m.label} — ${count} task${count === 1 ? '' : 's'}`}
            >
              <span className="text-muted-foreground">{m.label}</span>
              <span className="flex gap-0.5">
                {Array.from({ length: Math.min(count, 3) }).map((_, i) => (
                  <span key={i} className="size-1.5 rounded-full bg-[color:var(--accent-warm,#D4A574)]" />
                ))}
                {count > 3 && <span className="text-[10px]">+{count - 3}</span>}
              </span>
            </button>
          );
        })}
      </div>

      <Sheet open={!!openMonthKey} onOpenChange={(o) => !o && setOpenMonthKey(null)}>
        <SheetContent side="bottom" className="sm:max-w-md sm:mx-auto">
          <SheetHeader>
            <SheetTitle>{openMonthKey}</SheetTitle>
          </SheetHeader>
          <ul className="space-y-2 p-4">
            {openTasks.map((t) => (
              <li key={t.id}>
                {t.name} — {formatInTimeZone(t.nextDue, timezone, 'MMM d')}
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}
```

### Pattern 7: Band classification as pure, timezone-aware function

**What:** The critical edge is "overdue" — "due before midnight today in the home's timezone", NOT "due before `new Date()` in UTC". A task with `nextDue` at 2026-04-20T23:00Z for a home in `Australia/Melbourne` (UTC+10) is actually on 2026-04-21 local, so it should NOT be overdue at 2026-04-20T23:30Z UTC.

**Standard approach:** Convert `now` to the home's local "start of day" as a UTC instant, then compare. Use `fromZonedTime` to compute "midnight in the home timezone as a UTC Date".

**Example:**
```ts
// lib/band-classification.ts
import { addDays, startOfDay } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { computeNextDue, type Task, type Completion } from '@/lib/task-scheduling';

export type ClassifiedTask = Task & { nextDue: Date; daysDelta: number };
export type Bands = {
  overdue: ClassifiedTask[];
  thisWeek: ClassifiedTask[];
  horizon: ClassifiedTask[];
};

/**
 * Classify tasks into three bands, using the home's timezone for day boundaries.
 *
 * "Today" in Melbourne starts at 14:00Z on winter dates and 13:00Z on summer dates.
 * Comparing a UTC nextDue against a UTC "now" directly would misclassify tasks due
 * just after local midnight on the wrong side of the band boundary.
 *
 * Algorithm:
 *   1. Compute "local midnight today" as a UTC instant via fromZonedTime(startOfDay(zoned_now), tz)
 *   2. Compute "local midnight +7 days" the same way.
 *   3. overdue:  nextDue <  localMidnightToday
 *      thisWeek: localMidnightToday <= nextDue <= localMidnightToday + 7d
 *      horizon:  nextDue > localMidnightToday + 7d
 *
 * Source: CITED github.com/marnusw/date-fns-tz (toZonedTime/fromZonedTime semantics)
 */
export function computeTaskBands(
  tasks: Task[],
  latestByTask: Map<string, Completion>,
  now: Date,
  timezone: string,
): Bands {
  // Local midnight today, returned as a UTC Date.
  const zonedNow = toZonedTime(now, timezone);
  const localMidnightTodayUtc = fromZonedTime(startOfDay(zonedNow), timezone);
  const localMidnightPlus7Utc = addDays(localMidnightTodayUtc, 7);

  const classified: ClassifiedTask[] = [];
  for (const task of tasks) {
    if (task.archived) continue;
    const last = latestByTask.get(task.id) ?? null;
    const nextDue = computeNextDue(task, last, now);
    if (!nextDue) continue;
    const daysDelta = (nextDue.getTime() - localMidnightTodayUtc.getTime()) / 86400000;
    classified.push({ ...task, nextDue, daysDelta });
  }

  const overdue = classified
    .filter((t) => t.nextDue < localMidnightTodayUtc)
    .sort((a, b) => a.daysDelta - b.daysDelta); // most negative first = worst overdue

  const thisWeek = classified
    .filter((t) => t.nextDue >= localMidnightTodayUtc && t.nextDue <= localMidnightPlus7Utc)
    .sort((a, b) => a.nextDue.getTime() - b.nextDue.getTime());

  const horizon = classified
    .filter((t) => t.nextDue > localMidnightPlus7Utc)
    .sort((a, b) => a.nextDue.getTime() - b.nextDue.getTime());

  return { overdue, thisWeek, horizon };
}
```

### Pattern 8: Coverage formula (linear, empty-safe, equal-weight)

**Example:**
```ts
// lib/coverage.ts
import { computeNextDue, type Task, type Completion } from '@/lib/task-scheduling';

/**
 * Household coverage = mean of per-task health.
 * Per-task health = clamp(1 - max(0, (now - nextDue) / frequency_days), 0, 1).
 *
 * Intuition:
 *  - On schedule or early: health = 1.0
 *  - Overdue by a full cycle: health = 0.0 (cannot go below)
 *  - Overdue by half a cycle: health = 0.5
 *
 * Empty home (0 non-archived tasks): returns 1.0 (100%) — "empty house is perfectly
 * maintained" per D-06. UI shows "Add your first task" CTA alongside the 100% ring.
 */
export function computeCoverage(
  tasks: Task[],
  latestByTask: Map<string, Completion>,
  now: Date,
): number {
  const active = tasks.filter((t) => !t.archived);
  if (active.length === 0) return 1.0;

  let sum = 0;
  let counted = 0;
  for (const task of active) {
    const last = latestByTask.get(task.id) ?? null;
    const nextDue = computeNextDue(task, last, now);
    if (!nextDue) continue;
    const overdueDays = Math.max(0, (now.getTime() - nextDue.getTime()) / 86400000);
    const health = Math.max(0, Math.min(1, 1 - overdueDays / task.frequency_days));
    sum += health;
    counted += 1;
  }
  return counted === 0 ? 1.0 : sum / counted;
}
```

**Note on frequency weighting:** The formula is equal-weight per SPEC and D-06 (`mean(taskHealth)`). Shorter-frequency tasks (daily bench wipe) and longer-frequency tasks (yearly gutter clean) contribute equally. This is DESIRED per the project's key decision logged in STATE.md ("Equal-weight coverage ring with frequency-normalized overdue ratio"). The overdue ratio in the per-task health IS the frequency-normalization — "N days overdue" means different things for daily vs yearly tasks, and dividing by `frequency_days` normalizes it. No additional weighting needed.

### Pattern 9: Early-completion guard (pure function, edge-case matrix)

**Example:**
```ts
// lib/early-completion-guard.ts
/**
 * Decide whether to warn the user that they're completing a task early.
 *
 * Returns true when the elapsed time since last completion (or task creation if no
 * completions) is less than 25% of the frequency.
 *
 * Key design decisions (from D-07):
 *  - No prior completion → reference is task.created. Prevents "created it, marked it
 *    done 1 second later" accidents.
 *  - Anchored mode does NOT affect the guard. The guard is about "how long since last
 *    actually done", not about anchor dates. A quarterly anchored task completed 3
 *    days ago still triggers the guard if user taps again today.
 *  - Exactly at the 25% boundary: no warn (strict less-than).
 */
export function shouldWarnEarly(
  task: { created: string; frequency_days: number },
  lastCompletion: { completed_at: string } | null,
  now: Date,
): boolean {
  const referenceIso = lastCompletion?.completed_at ?? task.created;
  const reference = new Date(referenceIso);
  const elapsedDays = (now.getTime() - reference.getTime()) / 86400000;
  const threshold = 0.25 * task.frequency_days;
  return elapsedDays < threshold;
}
```

### Anti-Patterns to Avoid

- **Reading `Date.now()` inside render or classification code.** Pass `now: Date` as a prop (Phase 2 pattern from `computeNextDue`). Cements determinism in tests and avoids per-row millisecond drift.
- **Using the updater-function form of `useOptimistic` for list additions.** The updater form sees the state at action-start time and can lose concurrent prop updates. Use the reducer form instead [CITED: react.dev/reference/react/useOptimistic].
- **Comparing UTC `nextDue` directly against UTC `now` for band boundaries.** Must convert to "midnight in home timezone as UTC instant" first. Otherwise users in non-UTC timezones see tasks flip between bands at the wrong local time.
- **Re-computing `new Date()` in multiple places.** Compute once in the Server Component; pass through as prop.
- **Using `pb.authStore.record` without fresh re-fetch.** Phase 2 already codified this — the cookie snapshot is stale. Re-fetch via `pb.collection('users').getOne()` when any live user field matters.
- **Relying on PB `updateRule = ""` for append-only.** `""` allows everyone — the correct setting is `null` which per PB docs means "locked, superusers only" [CITED: pocketbase.io/docs/api-rules-and-filters].
- **Blocking the UI on the server action.** Always wrap in `startTransition` so React doesn't suspend the whole tree.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Toast notifications | Custom toast system | `sonner` + shadcn `Toaster` (already wired) | Queue management, stacking, reduced-motion, a11y all handled. |
| Modal / dialog | Custom focus trap + ESC | shadcn `Dialog` (already installed) | Radix Dialog handles focus trap, aria-modal, scroll-lock, ESC. |
| Bottom / side drawer | Custom CSS + animation | shadcn `Sheet` (install in Phase 3) | `side="bottom"` / `"right"` prop. Built-in reduced-motion. |
| Optimistic list updates | Custom rollback logic | React 19 `useOptimistic` + reducer | Automatic rollback on throw; parent-reconciliation built in. |
| Timezone-aware formatting | Raw `Date.toLocaleString` | `date-fns-tz.formatInTimeZone` (already used) | IANA DB + DST-safe. |
| "Start of day in a timezone" | Manual UTC offset math | `date-fns-tz.fromZonedTime(startOfDay(toZonedTime(now, tz)), tz)` | DST transitions covered. |
| Pending state indicator | Custom spinner logic | `useTransition` `isPending` + `lucide-react` `Loader2` | Suspense-aware. |
| Date / month math | Custom day counters | `date-fns` `addDays`, `addMonths`, `startOfMonth`, `startOfDay` | Well-tested; already installed. |
| Latest-completion-per-task | Custom SQL / JSVM route | Bounded-fetch + client reduce (see Pattern 2) | O(N) on <1000 rows; zero deploy complexity. |
| Coverage ring SVG | Chart library (Recharts / Chart.js) | Hand-rolled 30-line SVG (Pattern 5) | Verified standard pattern; full style control; no runtime cost. |

**Key insight:** Phase 3 is mostly about wiring known primitives together. The only novel code is four pure functions (band-classification, coverage, guard, latest-reducer) and a single SVG. Everything else is library composition.

## Runtime State Inventory

**N/A — Phase 3 is a greenfield feature phase.** No rename, refactor, string replacement, or migration. The only runtime state changes are:

| Category | Items | Action |
|----------|-------|--------|
| Stored data | New `completions` collection created in PB | Fresh migration `1714867200_completions.js`; no pre-existing data to migrate. |
| Live service config | None — PB is the only runtime service, migration is self-contained | None. |
| OS-registered state | None | None. |
| Secrets/env vars | None (Phase 6 adds ntfy; Phase 3 does not) | None. |
| Build artifacts | None — no renames to installed packages | None. |

## Common Pitfalls

### Pitfall 1: `useOptimistic` reducer stale closure on new props

**What goes wrong:** The reducer uses `current` (state) + `added` (action) only. If the developer reaches outside via `useMemo` or captures `completions` in a closure, the optimistic state can show stale values after `router.refresh()`.

**Why it happens:** React 19 re-runs the reducer with fresh `value` when the parent's `completions` prop changes. Closures over the outer `completions` prevent that re-run from using the new data.

**How to avoid:** Keep the reducer dependency-free — only `current` and `action`. Derive `bands` and `coverage` from `optimisticCompletions` directly in render, NOT from a memoized snapshot.

**Warning signs:** "I completed a task, server-refresh happened, but the task reappeared in This Week for one render."

### Pitfall 2: Timezone day-boundary off-by-one

**What goes wrong:** A task due at 2026-07-15T14:00Z is "today" in Melbourne (UTC+10 summer, local 00:00 2026-07-16) but "yesterday" in Los Angeles (UTC-7, local 07:00 2026-07-15). Comparing UTC times against UTC now misclassifies.

**Why it happens:** `new Date().getHours()` uses the SERVER's timezone. `date-fns`'s `isSameDay(a, b)` compares local days in the server's timezone.

**How to avoid:** Always route band-boundary comparisons through `fromZonedTime(startOfDay(toZonedTime(now, tz)), tz)` to produce "local midnight as UTC instant". Example codified in Pattern 7.

**Warning signs:** "Tasks appear overdue in the morning but move to This Week in the afternoon" (server tz + user tz straddle UTC midnight).

### Pitfall 3: PB `getFullList` default batch size

**What goes wrong:** A home with 600 completions in the 13-month window returns only 500 rows — the rest silently drop. The client sees a stale `latestByTask` map and shows tasks as more-overdue than they are.

**Why it happens:** `getFullList` internally paginates with `batch=500` by default [VERIFIED: PB SDK source]. It auto-continues until empty, but if the developer mistakenly thinks `getFullList` = "no limit", they miss that the PB server can error or cap at 500 per request under some configurations.

**How to avoid:** Explicit `batch: 500` in the call (documented intent). For homes with extreme completion volumes, consider a lighter fetch (only the last 1-2 completions per task via a JSVM route) — not needed for v1.

**Warning signs:** Unit test with >500 completions in the 13-month window fails; E2E with many seed completions shows wrong band placement.

### Pitfall 4: Race — rapid double-tap creates two completions

**What goes wrong:** User taps a task row twice in 100ms. Two server actions fire; two completion rows created.

**Why it happens:** `useOptimistic` + `startTransition` don't debounce. Both invocations succeed at the server.

**How to avoid:** Disable the tap target while `pendingTaskId === taskId`. `useTransition`'s `isPending` is global (applies to any transition); `pendingTaskId` state is task-specific. The row renders `aria-disabled="true"` + `pointer-events-none` while pending.

**Warning signs:** Completion history shows duplicate entries for the same task at near-identical timestamps.

### Pitfall 5: Server-action throw vs error-shape return

**What goes wrong:** The developer throws an Error in `completeTaskAction` on the "task archived" case. React 19 auto-rolls back the optimistic state, which is correct — but the error propagates as an uncaught exception instead of a typed result.

**Why it happens:** Server actions that throw propagate to the client's `await` as a thrown promise. The discriminated-union result pattern (Pattern 4) expects return values, not throws.

**How to avoid:** Throw ONLY for unexpected errors (network failures, PB outages). For business-logic outcomes (archived, requires-confirm, not-signed-in), return a typed result. The client's `try/catch` handles both uniformly.

**Warning signs:** `toast.error` shows "Could not complete task" even on expected business cases.

### Pitfall 6: `revalidatePath` + `router.refresh` double-invalidation

**What goes wrong:** The server action calls `revalidatePath('/h/${homeId}')`, and the client calls `router.refresh()`. Both are complementary, not redundant — `revalidatePath` invalidates the server cache; `router.refresh` forces the current page to re-fetch. But if the developer relies on only one and forgets the other, stale data can render.

**Why it happens:** Misunderstanding of the cache layers. [CITED: nextjs.org/docs/app/api-reference/functions/revalidatePath — "Updates the UI immediately if viewing the affected path."]

**How to avoid:** Call `revalidatePath` in the server action AND `router.refresh()` on the client after a successful action return. The docs explicitly confirm the complementary nature.

**Warning signs:** Completion-toast shows, but the task is still in the Overdue band after the action resolves.

### Pitfall 7: Optimistic completion not re-classifying the row

**What goes wrong:** The optimistic completion is appended to `optimisticCompletions`, but `bands` is memoized on `completions` (props), not `optimisticCompletions`. The row doesn't move bands visually.

**Why it happens:** Developer memoizes bands for performance, accidentally on the wrong dependency.

**How to avoid:** DON'T memoize bands. `computeTaskBands` is O(N) and runs on every render — negligible cost at Phase 3 scale. Let React re-compute from `optimisticCompletions` each render. The React Compiler (Next 16 default) may still memoize — verify by adding a `console.log` at the top of `BandView` body and watch it re-run on optimistic update.

**Warning signs:** Tap → toast fires, but the task row visibly stays in the same band.

### Pitfall 8: Tap target below 44×44

**What goes wrong:** Task row renders as 38px tall. Mobile tap accuracy drops; accessibility audit fails.

**Why it happens:** Tailwind's `text-sm` line-height at 1.25 + small padding gives rows under 44px.

**How to avoid:** Explicit `min-h-[44px]` on the tap target element. Applied to the entire `<button>` or `<Link>` wrapping the row.

**Warning signs:** Axe / Lighthouse "touch target size" warning.

### Pitfall 9: Coverage ring stroke-dashoffset direction

**What goes wrong:** The progress arc grows counter-clockwise instead of clockwise, or starts at the wrong angle.

**Why it happens:** `stroke-dasharray` starts drawing at 3 o'clock (right) by default. Without rotation, 75% looks wrong.

**How to avoid:** Apply `-rotate-90` to the SVG element (or `transform="rotate(-90 18 18)"` on the `<circle>`). Verified in Pattern 5.

**Warning signs:** Visual — the filled portion starts on the right side.

### Pitfall 10: React Compiler over-memoizing `useOptimistic` state

**What goes wrong:** Next 16 enables the React Compiler by default. It may wrap `bands` / `coverage` computations in `useMemo` with inferred dependencies. If it misses `optimisticCompletions` as a dependency, the bands stay stale.

**Why it happens:** The React Compiler is conservative but not perfect; known interactions with hooks like `useOptimistic` can cause skipped memoization warnings.

**How to avoid:** Phase 2's 02-05 summary already notes a similar interaction (RHF `watch()` + React Compiler). Expect a compiler warning on `BandView`; verify visually that bands update on tap. If broken, opt out via the `'use no memo'` directive at the top of the file or a file-level `// @ts-ignore react-compiler` guard.

**Warning signs:** Compiler emits `react-hooks/incompatible-library` for BandView; tap doesn't re-classify rows.

### Pitfall 11: PB double-hop filter `task_id.home_id.owner_id` on list rule

**What goes wrong:** The double-hop relation filter works on view/list rules, but is slow if there's no index. At 10k completions, a list query for a home can take seconds.

**Why it happens:** PB evaluates the rule per-row with a join; without `idx_completions_task` it's a full table scan.

**How to avoid:** The index `CREATE INDEX idx_completions_task_completed ON completions (task_id, completed_at)` (in Pattern 1) covers the common access path. For the bounded-recency fetch, the `(task_id IN [...]) && completed_at >= cutoff` filter uses this index directly.

**Warning signs:** Slow first-paint on `/h/[homeId]` after hundreds of completions seeded.

### Pitfall 12: Sheet focus trap conflicting with toast focus

**What goes wrong:** User taps task → Sheet opens with focus on first button → user confirms early-completion guard inside Sheet → dialog opens on top → tab cycle confused.

**Why it happens:** Radix Dialog (which Sheet uses) has its own focus trap. Stacking a second dialog over a sheet creates two traps.

**How to avoid:** Don't stack. When the guard triggers, CLOSE the Sheet first, then open the Dialog. Coordinate via component state (`guardState` is a single atom).

**Warning signs:** Tab / ESC behave unexpectedly when both Sheet and Dialog are open.

### Pitfall 13: "Via" field on completion not set

**What goes wrong:** Migration defines `via` as required, but server action forgets to pass it → PB rejects with "via is required".

**Why it happens:** Easy miss in the create payload.

**How to avoid:** Default in the server action: `via: 'tap'` for one-tap completion. Schema validation would catch this too; ensure `completionSchema` requires it with a default.

**Warning signs:** `completeTaskAction` always returns `ok: false` with generic error.

## Code Examples

### Fetching completions and reducing in the Server Component

```tsx
// app/(app)/h/[homeId]/page.tsx  (rewrite)
import { BandView } from '@/components/band-view';
import { createServerClient } from '@/lib/pocketbase-server';
import { getCompletionsForHome, reduceLatestByTask } from '@/lib/completions';
// ...

export default async function HomePage({ params }: { params: Promise<{ homeId: string }> }) {
  const { homeId } = await params;
  const pb = await createServerClient();
  const userId = pb.authStore.record?.id as string;

  const [home, tasks] = await Promise.all([
    pb.collection('homes').getOne(homeId, { fields: 'id,name,timezone' }),
    pb.collection('tasks').getFullList({
      filter: `home_id = "${homeId}" && archived = false`,
      expand: 'area_id',
      fields: 'id,name,frequency_days,schedule_mode,anchor_date,archived,created,icon,color,area_id,notes,expand',
    }),
  ]);

  const taskIds = tasks.map((t) => t.id);
  const now = new Date();
  const completions = await getCompletionsForHome(pb, taskIds, now);

  // Server-side initial computation so first-paint is correct.
  // Client re-computes same via useOptimistic reducer after tap.
  return (
    <BandView
      homeId={homeId}
      userId={userId}
      timezone={home.timezone as string}
      now={now.toISOString()}
      tasks={tasks.map(mapPBToTaskWithArea)}
      completions={completions}
    />
  );
}
```

### EarlyCompletionDialog (shadcn Dialog)

```tsx
// components/early-completion-dialog.tsx
'use client';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

type GuardState = {
  task: { name: string; frequency_days: number };
  lastCompletion: { completed_at: string } | null;
  nowDate: Date;
};

export function EarlyCompletionDialog({
  state,
  onConfirm,
  onCancel,
}: {
  state: GuardState;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const reference = state.lastCompletion
    ? new Date(state.lastCompletion.completed_at)
    : null;
  const daysSince = reference
    ? Math.max(0, Math.round((state.nowDate.getTime() - reference.getTime()) / 86400000))
    : 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark “{state.task.name}” done?</DialogTitle>
          <DialogDescription>
            {state.lastCompletion
              ? `Last done ${daysSince} day${daysSince === 1 ? '' : 's'} ago, every ${state.task.frequency_days} day${state.task.frequency_days === 1 ? '' : 's'}.`
              : `Task was just created. Usually done every ${state.task.frequency_days} day${state.task.frequency_days === 1 ? '' : 's'}.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={onConfirm}>Mark done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### TaskRow (44px min-target, disabled-during-pending)

```tsx
// components/task-row.tsx
'use client';
import { clsx } from 'clsx';

export function TaskRow({
  task,
  onComplete,
  pending,
  daysDelta,
  variant,
}: {
  task: { id: string; name: string; frequency_days: number };
  onComplete: (taskId: string) => void;
  pending: boolean;
  daysDelta: number;
  variant?: 'overdue' | 'thisWeek' | 'horizon';
}) {
  return (
    <button
      type="button"
      disabled={pending}
      aria-disabled={pending}
      onClick={() => onComplete(task.id)}
      className={clsx(
        'flex w-full min-h-[44px] items-center justify-between gap-2 rounded border p-3 text-left transition-colors',
        variant === 'overdue' && 'border-l-4 border-l-[color:var(--accent-warm,#D4A574)]',
        pending ? 'opacity-60 pointer-events-none' : 'hover:bg-muted active:scale-[0.99]',
      )}
    >
      <span className="font-medium">{task.name}</span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {variant === 'overdue' ? `${Math.round(-daysDelta)}d late` : `in ${Math.round(daysDelta)}d`}
      </span>
    </button>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `useSWR` / `react-query` for optimistic updates | React 19 `useOptimistic` | React 19 (Dec 2024) | Built into React; no external dep; automatic rollback. |
| Emit custom events + refetch after mutation | Server Actions + `revalidatePath` + `router.refresh` | Next 14+ | Single call-site; cache layers coordinate automatically. |
| `@radix-ui/react-dialog` direct import | `radix-ui` umbrella package | shadcn 2024 "new-york" style v2 | One dep instead of per-primitive; matches Phase 2 project setup. |
| `react-toastify` | `sonner` | shadcn 2024 default | Smaller, modern, better a11y. Already wired. |
| Custom `next-pwa` / `workbox` | `serwist` (Phase 7 only) | next-pwa unmaintained | Not relevant to Phase 3; noted for future. |

**Deprecated / outdated:**
- `experimental_useFormState` — replaced by `useActionState` in React 19 (Phase 2 already uses this). No action for Phase 3.
- `window.innerWidth` for responsive Sheet positioning in the Sheet docs example — prefer CSS media queries or `useMediaQuery` hook to avoid SSR mismatches.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `completions` PB collection should cascadeDelete=true on task_id even though tasks archive (never hard-delete) | Pattern 1 | Low — archiving is the v1 path; cascade only matters if a future admin hard-deletes a task. Either value works for v1. |
| A2 | 13-month recency window (395 days) is sufficient for latest-completion-per-task reduction | Pattern 2 | Medium — if a task has `frequency_days = 365` and hasn't been completed in >13 months, the reduce misses its last completion and treats it as "never completed". SPEC caps frequency at 365; real-world edge case. Mitigation: always fall back to `computeNextDue(task, null, now)` = "due frequency_days after creation", which is correct for "never completed" AND "completed long ago and due again". |
| A3 | `completions` collection has no additional fields beyond the 5 listed in D-01 | Pattern 1 | Low — matches SPEC §7.1 + D-01 exactly. |
| A4 | Server Component can reliably compute `new Date()` once and pass as prop | BandView | Low — established pattern in Phase 2 (`TaskList` + `computeNextDue`). |
| A5 | React Compiler (Next 16 default) does NOT break `useOptimistic` reactivity | Pitfall 10 | Medium — Phase 2 already hit a compiler-RHF interaction (informational warning, no runtime bug). No guarantee until manually verified. Mitigation: visual smoke test during plan; opt out via `'use no memo'` directive if broken. |
| A6 | shadcn Sheet install uses existing `radix-ui` umbrella and adds no runtime deps | Standard Stack | Low — shadcn codegen uses the project's configured import style (`radix-ui` per components.json). Verify by inspecting the generated `components/ui/sheet.tsx` after `shadcn add sheet`. |
| A7 | Guard reference date for never-completed tasks is `task.created`, not `task.anchor_date` | Pattern 9 | Low — explicitly locked in D-07: "For tasks with NO prior completions, use `task.created` as the reference". |

**No claims in this research are tagged `[ASSUMED]` as unverified facts.** Every claim is either `[VERIFIED]` against the npm registry / Phase 2 code / PB docs, or `[CITED]` against official React/Next/PB/shadcn/date-fns-tz documentation. The Assumptions Log above lists assumptions about *project decisions*, not about technical facts.

## Open Questions

1. **Should archived tasks exclude from coverage formula, or count as 100% healthy?**
   - What we know: D-06 says "mean across non-archived tasks". Already answered.
   - What's unclear: Edge — if all tasks are archived, coverage = 100%. Is that the right UX, or should we show a different state?
   - Recommendation: Treat same as "empty home" — 100% + "Add your first task" CTA (or "All archived — restore some tasks"). Ask during plan-check.

2. **What's the anchor-date semantics for "never completed anchored tasks" in band classification?**
   - What we know: Phase 2's `computeNextDue` already handles this — returns the anchor if in future, else steps to next cycle.
   - What's unclear: If an anchored task's anchor is in the past and user has never completed, the guard uses `task.created` (not anchor). Is that intentional?
   - Recommendation: Yes — anchor affects next-due scheduling, `task.created` is the "when did this enter the system" reference for guard. D-07 is explicit.

3. **Should the horizon strip include tasks due THIS week?**
   - What we know: D-04 says horizon is `nextDue > addDays(now, 7)` — exclusive. Tasks due today through +6 days are in This Week.
   - What's unclear: Should the strip show a "This Week" column for completeness, or truly skip?
   - Recommendation: Skip (per D-04 exact boundary). This Week is in its own band above. The strip is "what's coming beyond this week". No action needed.

4. **Does the server action need rate limiting beyond PB's default?**
   - What we know: Phase 2 raised `*:authWithPassword` rate limit. No explicit rule for regular API calls.
   - What's unclear: A malicious client could spam `completeTaskAction` to DoS the completions table.
   - Recommendation: Defer to Phase 7 ops hardening. For a self-hosted single-home app (SPEC §16), not a real risk. Accept the risk; document in SUMMARY.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Build, test, server | ✓ | 22.22.0 (Phase 1 verified) | — |
| PocketBase binary | Server runtime + migrations | ✓ | 0.37.1 (Phase 1 Docker image) | — |
| npm | Package install | ✓ | bundled with Node 22 | — |
| shadcn CLI | `pnpm dlx shadcn@latest add sheet` | ✓ | latest via npx | Manually copy Sheet from shadcn docs if CLI unavailable |
| Playwright | E2E tests | ✓ | 1.59.1 (Phase 1 verified) | — |
| Vitest | Unit tests | ✓ | 4.1.4 (Phase 1 verified) | — |
| `date-fns-tz` | Timezone math | ✓ | 3.2.0 (Phase 2 installed) | — |
| `sonner` | Toasts | ✓ | 2.0.7 (Phase 2 installed + wired) | — |
| `radix-ui` umbrella | shadcn primitives | ✓ | 1.4.3 (Phase 2 installed) | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:**
- shadcn `Sheet` component — not yet codegenerated. Fallback: copy the template from ui.shadcn.com/docs/components/sheet manually into `components/ui/sheet.tsx`. Either path yields identical output.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.4 (unit) + Playwright 1.59.1 (E2E) |
| Config file | `vitest.config.ts` + `playwright.config.ts` (both exist from Phase 1) |
| Quick run command | `npm test -- lib/band-classification.test.ts lib/coverage.test.ts lib/early-completion-guard.test.ts lib/completions.test.ts` |
| Full suite command | `npm test && npm run test:e2e` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| COMP-01 | One-tap creates completion, row moves out of band | E2E | `npx playwright test tests/e2e/core-loop.spec.ts` | ❌ Wave 0 |
| COMP-02 | Guard triggers <25% elapsed, dialog confirm proceeds | Unit + E2E | `npm test -- lib/early-completion-guard.test.ts` + E2E | ❌ Wave 0 (both) |
| COMP-03 | Append-only — PB rejects PATCH/DELETE on completions | Integration (PB) | `npm test -- tests/unit/hooks-completions-append-only.test.ts` | ❌ Wave 0 |
| VIEW-01 | Three bands render correctly from mixed tasks | Unit | `npm test -- lib/band-classification.test.ts` | ❌ Wave 0 |
| VIEW-02 | Overdue band hidden when no overdue tasks | Unit + E2E | Same + E2E | ❌ Wave 0 (both) |
| VIEW-03 | This Week grouped by day when >5 items | Unit | Same as VIEW-01 (matrix case) | ❌ Wave 0 |
| VIEW-04 | Horizon shows 12 months with dot counts per task's month | Unit | `npm test -- components/horizon-strip.test.tsx` (or pure helper) | ❌ Wave 0 |
| VIEW-05 | Coverage ring percentage matches formula on 10+ scenarios | Unit | `npm test -- lib/coverage.test.ts` | ❌ Wave 0 |
| VIEW-06 | Tap row opens Sheet with task detail | E2E | `npx playwright test tests/e2e/core-loop.spec.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm test -- <affected module>.test.ts` (<5s)
- **Per wave merge:** `npm test && npm run test:e2e`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `tests/unit/band-classification.test.ts` — covers VIEW-01, VIEW-02, VIEW-03 (matrix: empty, all-overdue, boundary today, crossing week boundary, horizon-only, DST day, archived excluded)
- [ ] `tests/unit/coverage.test.ts` — covers VIEW-05 (10+ scenarios: empty=100, all-perfect=100, half-overdue-full-cycle≈50, one-task-archived ignored, mixed freq weights, just-completed, overdue-beyond-cycle clamps to 0, single task overdue by one day, leap-year freq=365, DST day)
- [ ] `tests/unit/early-completion-guard.test.ts` — covers COMP-02 (matrix: no completions + just-created = warn, no completions + 3d-old task freq=7 = warn, 1d-ago freq=7 = warn, 5d-ago freq=7 = no warn, exactly 25% boundary = no warn (strict-less), anchored task same rule, freq=1 daily edge)
- [ ] `tests/unit/completions-reducer.test.ts` — covers Pattern 2 reducer (empty, single task multiple completions, two tasks interleaved, clock-skew completion appears before older one)
- [ ] `tests/unit/hooks-completions-append-only.test.ts` — integration test spins up PB + applies migration + authed user creates completion + attempts PATCH/DELETE → expect 403 (mirrors 02-01 `hooks-whole-home.test.ts` shape)
- [ ] `tests/unit/schemas/completion.test.ts` — zod schema tests (required fields, max notes length, `via` enum)
- [ ] `tests/e2e/core-loop.spec.ts` — D-21 both scenarios: (a) create home + task freq=7 → tap → guard triggers → confirm → moves to horizon + coverage ticks; (b) stale task (10d old, freq=7) → overdue band → tap → no guard → moves out + coverage up

**Framework:** Both Vitest and Playwright are installed and configured in Phase 1. No Wave 0 install needed.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Phase 2's `pb.authStore.isValid` + proxy.ts gate — unchanged. |
| V3 Session Management | yes | Phase 2's HttpOnly `pb_auth` cookie — unchanged. |
| V4 Access Control | **yes** | PB rules on `completions` (listRule/viewRule/createRule scoped to `task_id.home_id.owner_id = auth.id`; updateRule/deleteRule = null). |
| V5 Input Validation | **yes** | `completionSchema` zod validation in `completeTaskAction`; server re-parses `taskId` + `force` param. |
| V6 Cryptography | no | No new crypto in Phase 3. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| T-03-01: User creates completion on another user's task | Elevation of Privilege | PB createRule enforces `task_id.home_id.owner_id = @request.auth.id`; server action does ownership preflight via `pb.collection('tasks').getOne(taskId)` (viewRule fires). |
| T-03-02: User forges `completed_by_id` in create payload | Spoofing | PB createRule has `@request.body.completed_by_id = @request.auth.id`; server action reads userId from `pb.authStore.record.id` and never from formData. |
| T-03-03: User attempts to edit/delete a completion | Tampering / Repudiation | PB `updateRule = null` + `deleteRule = null` — 403 for everyone except superuser. |
| T-03-04: Bypass client early-completion guard | Information disclosure / business-logic | Server action re-runs `shouldWarnEarly` when `force === false`; user-supplied `force=true` is acceptable (matches the "confirm dialog" flow). |
| T-03-05: Bypass archived-task check | Business logic | Server action checks `if (task.archived) return { ok: false, formError: 'Task is archived' }` after the ownership-preflight getOne. |
| T-03-06: XSS via completion `notes` | Injection | React auto-escapes text nodes; notes rendered as `{completion.notes}` in the detail sheet's last-5 list. No `dangerouslySetInnerHTML`. zod schema caps notes at 2000 chars. |
| T-03-07: DoS via rapid completion flood | DoS | PB rate limits from 02-01 (300/60s) remain in effect; per-authed-user rate limit deferred to Phase 7. |
| T-03-08: Filter-string injection via `task_id` in `getCompletionsForHome` | Injection | Current Pattern 2 uses template literals with trusted task-ids (fetched from the same PB query, never user input). Even so, prefer `pb.filter('task_id = {:id}', { id })` for defense-in-depth. |
| T-03-09: `nextDueFormatted` in toast reveals timezone | Information disclosure | Accepted — the user's own home timezone is not a secret. |

## Sources

### Primary (HIGH confidence)

- `react.dev/reference/react/useOptimistic` — useOptimistic signature, reducer vs updater, parent-reconciliation, rollback-on-throw. Verified 2026-04-20.
- `nextjs.org/docs/app/api-reference/functions/revalidatePath` — revalidatePath vs router.refresh semantics, type parameter. Last updated 2026-04-15 (per doc metadata).
- `pocketbase.io/docs/api-rules-and-filters/` — null vs "" rule semantics: null = locked to superusers, "" = everyone.
- `pocketbase.io/docs/api-records/` — SDK signatures (`getList(page, perPage, opts)`, `getFullList(opts)`, `getFirstListItem(filter, opts)`), default perPage=30, no native GROUP BY.
- `pocketbase.io/docs/collections/` — collection rule fields, JSVM migration pattern.
- `ui.shadcn.com/docs/components/sheet` — Sheet component API, `side` prop, install command, responsive example.
- `github.com/marnusw/date-fns-tz` — formatInTimeZone / toZonedTime / fromZonedTime signatures, UTC-vs-local Date semantics.
- Phase 2 summaries: `.planning/phases/02-auth-core-data/02-04-SUMMARY.md` (home/area patterns), `02-05-SUMMARY.md` (task CRUD + computeNextDue purity).
- Phase 2 code: `lib/task-scheduling.ts`, `lib/schemas/task.ts`, `lib/actions/tasks.ts`, `components/task-list.tsx`, `pocketbase/pb_migrations/1714780800_init_homekeep.js`.

### Secondary (MEDIUM confidence)

- `css-tricks.com/building-progress-ring-quickly/` — radius-16 stroke-dasharray trick, verified against multiple CodePen implementations.
- `nikitahl.com/svg-circle-progress` — full formulas (offset = circumference × (100-progress)/100; rotate -90deg to start at top).
- `dev.to/a1guy/react-19-useoptimistic-deep-dive` — reducer vs updater nuances; confirmed against react.dev primary source.
- `npm view <pkg> version` — all pinned versions verified current as of 2026-04-20.

### Tertiary (LOW confidence)

- None — all claims in this document are backed by primary or secondary sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every version verified against npm registry 2026-04-20.
- Architecture: HIGH — patterns verified against Phase 2 precedent + official React 19 / Next 16 docs.
- Pitfalls: HIGH — pitfalls 1, 2, 4, 6, 8, 9 verified against official docs; pitfalls 3, 5, 7, 10, 11, 12, 13 are concrete technical facts derived from code review and docs.
- Completions query pattern: MEDIUM-HIGH — PB's lack of GROUP BY is documented; the bounded-reduce pattern is the standard workaround.
- Coverage formula: HIGH — exactly matches D-06 pseudocode in CONTEXT and SPEC §8.1.

**Research date:** 2026-04-20
**Valid until:** 2026-05-20 (30 days — React 19 / Next 16 / PB 0.26 all stable releases).

---

*Phase: 03-core-loop*
*Research completed: 2026-04-20*
