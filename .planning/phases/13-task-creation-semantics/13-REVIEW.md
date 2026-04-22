---
phase: 13-task-creation-semantics
reviewed: 2026-04-22T00:00:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - components/forms/task-form.tsx
  - components/ui/collapsible.tsx
  - lib/actions/seed.ts
  - lib/actions/tasks.ts
  - lib/load-smoothing.ts
  - lib/schemas/task.ts
  - lib/task-scheduling.ts
  - tests/unit/actions/seed-tcsem.test.ts
  - tests/unit/actions/tasks-tcsem.test.ts
  - tests/unit/load-smoothing.test.ts
  - tests/unit/tcsem-integration.test.ts
findings:
  critical: 0
  warning: 2
  info: 5
  total: 7
status: issues_found
---

# Phase 13: Code Review Report

**Reviewed:** 2026-04-22
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found (2 warnings, 5 info — no critical)

## Summary

Phase 13 (TCSEM — task-creation semantics) implements three concrete deliverables across 11 files:

1. `computeFirstIdealDate` pure helper with exact 7/90 boundary branching (verified).
2. `createTaskAction` + `batchCreateSeedTasks` extended with placement, using a synthetic-`lastCompletion` bridge that correctly routes through Phase 12's `placeNextDue` contract without short-circuiting.
3. TaskForm gains an "Advanced" collapsible with a `last_done` field, cycle-mode only.

**What's correct and worth calling out:**

- TCSEM-03 smart-default branch formulas are exact at the plan-specified boundaries: freq=7 → now+1, freq=8 → now+2 (floor(8/4)), freq=90 → now+22 (floor(90/4)), freq=91 → now+30 (floor(91/3)). Verified arithmetically against `lib/load-smoothing.ts:118-121`.
- The synthetic-`lastCompletion` bridge (tasks.ts:217-219, seed.ts:179-181) correctly reverses `placeNextDue`'s internal `addDays(baseIso, freq)` math via `addDays(firstIdeal, -freq)`. This preserves Phase 12's `placeNextDue` contract — the helper is NOT short-circuited, and the naturalIdeal inside `placeNextDue` equals `firstIdeal` as intended.
- Seed load-map threading (seed.ts:204-205) is forward-only — `householdLoad.set(key, ...)` mutates the Map after each placement so seed `i+1` sees seed `i`'s slot, with no sibling re-shifting. Matches the plan's D-08 contract.
- PB filter parameterization is correct in both new sibling fetches (tasks.ts:157, seed.ts:131) — both use `pb.filter('home_id = {:hid} && archived = false', { hid: ... })`, no string concatenation of user input.
- Placement error fallback (tasks.ts:242-251, seed.ts:208-215) swallows to `console.warn` with `next_due_smoothed=null`/`''` — createTask never fails on placement error, preserving v1.0 natural-cadence read behavior. Tests 5+6 in `tasks-tcsem.test.ts` and Test 5 in `seed-tcsem.test.ts` cover this.
- Atomic single-op create in `createTask` (tasks.ts:255-277) — `next_due_smoothed` is in the same tasks.create body as the rest of the fields. Not a 2-op batch. Scenario 1 in `tcsem-integration.test.ts` validates atomicity via a single read.
- `last_done` field is cycle-mode-only in the form (task-form.tsx:344 — `{scheduleMode === 'cycle' && ...}`).
- SDST audit (seed-tcsem.test.ts Test 6 + tcsem-integration.test.ts Scenario 3): manual verification via grep confirms zero matches for `seed-stagger|SDST|seed_stagger` in production code dirs (`lib/`, `components/`, `pocketbase/`, `app/`).

## Warnings

### WR-01: `last_done` raw string passed to `new Date(...)` without date-shape validation

**File:** `lib/actions/tasks.ts:200-204`
**Issue:** The schema at `lib/schemas/task.ts:92` declares `last_done: z.string().nullable().optional()` — no regex, no `z.string().datetime()`, no date-shape validation. Any non-empty string reaches `new Date(parsed.data.last_done)` verbatim. For a valid HTML `<input type="date">` submission this is always `YYYY-MM-DD` (safe), but a crafted form POST can submit `last_done: "not-a-date"`. That yields `Invalid Date`, which propagates through `addDays(firstIdeal, -freq)` → `Invalid Date` → `.toISOString()` throws `RangeError: Invalid time value`. The outer try/catch (tasks.ts:242) catches it and `nextDueSmoothed` stays null, so nothing crashes — but the failure is silent and the user gets a successful task creation with `next_due_smoothed=''` while their intent (explicit last_done) was dropped. This is a UX correctness gap disguised as "works": a typo in a custom form integration or a UA autofill quirk produces a silent smart-default instead of a field error.

**Fix:** Tighten the schema to reject non-ISO-date strings so the user sees a real fieldError, AND clamp in the action as defense in depth.

```ts
// lib/schemas/task.ts — replace line 92
last_done: z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/, 'Invalid last-done date')
  .nullable()
  .optional(),
```

```ts
// lib/actions/tasks.ts — tasks.ts:200-204, defense in depth
const lastDoneDate: Date | null =
  typeof parsed.data.last_done === 'string' &&
  parsed.data.last_done.length > 0
    ? new Date(parsed.data.last_done)
    : null;
if (lastDoneDate && Number.isNaN(lastDoneDate.getTime())) {
  return { ok: false, fieldErrors: { last_done: ['Invalid date'] } };
}
```

### WR-02: `updateTask` reads `last_done` from formData but silently ignores it

**File:** `lib/actions/tasks.ts:302-324`
**Issue:** `updateTask` reads `rawLastDone` and includes it in the zod-parsed `raw` object (tasks.ts:324) so the edit form can post without tripping the schema — but the `pb.collection('tasks').update(...)` body at tasks.ts:359-376 does NOT consume it. The Advanced collapsible is rendered in edit mode when `scheduleMode === 'cycle'` (task-form.tsx:344), so a user editing an existing task sees the "Last done (optional)" input, can type a date, press Save, get a success response — and their input is silently discarded. The code comment (tasks.ts:302-305) explicitly acknowledges "DO NOT consume it. D-07 scope is task CREATION only" but the form surfaces the field regardless. This is a lying UI.

**Fix:** Two paths:

Option A (lowest-churn, matches D-07 scope) — hide the Advanced collapsible in edit mode:

```tsx
// components/forms/task-form.tsx:344 — add mode guard
{mode === 'create' && scheduleMode === 'cycle' && (
  <Collapsible className="space-y-3">
    ...
```

Option B — still show in edit mode but render with a muted note explaining the field only applies at creation:

```tsx
{mode === 'edit' && (
  <p className="text-xs text-muted-foreground">
    Last-done applies only at task creation. Use "Mark done" or a schedule override to adjust an existing task.
  </p>
)}
```

Recommended: Option A. The comment at `tasks.ts:302-305` already states the field is creation-scope — matching the form to that scope avoids the lying-UI issue.

## Info

### IN-01: Test 2 in `tasks-tcsem.test.ts` has unused mockImplementation parameters

**File:** `tests/unit/actions/tasks-tcsem.test.ts:192-197`
**Issue:** `mockComputeFirstIdealDate.mockReset().mockImplementation((mode, freq, lastDone, now) => ...)` declares `mode`, `freq`, `lastDone` but only reads `now`. Under strict unused-parameter lint this would flag.
**Fix:** Prefix unused params with `_`:
```ts
(_mode, _freq, _lastDone, now: Date) => new Date(now.getTime() + 1 * 86400000)
```

### IN-02: Dead `call` counter in `seed-tcsem.test.ts` beforeEach

**File:** `tests/unit/actions/seed-tcsem.test.ts:181-198`
**Issue:** `let call = 0;` is declared at line 181, incremented at line 196 (`call += 1;`), and `void now;` is also present — but `call` is never read anywhere inside the callback. `spread = load.size` is what actually drives the distribution (line 192), not `call`. Dead local.
**Fix:** Remove `let call = 0;` and `call += 1;`. The test's distribution relies on `load.size` which already grows as the production code threads entries into the Map.

### IN-03: Edit-form `TaskForm` invocation doesn't pass `task.last_done`

**File:** `app/(app)/h/[homeId]/tasks/[taskId]/page.tsx:122-147`
**Issue:** The edit page's `TaskForm task={{...}}` prop omits `last_done`, so the edit-form always seeds `last_done: null` (task-form.tsx:139 default). This is consistent with the design — `last_done` is a creation-time synthetic input, not a stored DB column — but future contributors may mistake the omission for a bug and add a PB `last_done` field. Related to WR-02; addressing WR-02 Option A (hide in edit mode) makes this moot.
**Fix:** If WR-02 Option A is accepted, no change needed. Otherwise, add a code comment at the page invocation site:
```tsx
// Phase 13: last_done is creation-only (D-07). Not persisted; edit-mode
// hides the Advanced collapsible. See lib/actions/tasks.ts:302-305.
```

### IN-04: `tests/unit/actions/seed-tcsem.test.ts` Test 6 shells out to `grep` via `execSync`

**File:** `tests/unit/actions/seed-tcsem.test.ts:379-399`
**Issue:** Test 6 runs a child-process `grep -rn ...` against `lib/`, `components/`, `pocketbase/`, `app/` and asserts zero matches. This is an integration-style audit dressed as a unit test. It depends on:
- `grep` being installed on the test host (usually fine; fails on minimal docker images).
- Relative paths resolving correctly (assumes cwd is repo root).
- The escape/OR-pattern `\|` working under the host's grep dialect (BSD grep on macOS vs GNU grep on Linux handle `\|` differently — on BSD it wouldn't interpret the alternation without `-E`).

The integration test `tcsem-integration.test.ts` Scenario 3 already covers the runtime "no via='seed-stagger' rows" invariant. This unit test's static-audit angle is valuable but belongs in a lint rule or a pre-commit hook, not a vitest unit test that may be skipped in CI.
**Fix:** Either (a) accept as-is — works on Linux CI, grep is ubiquitous in the project env — or (b) replace with a readdir/readFile walk via `fs.promises.readdir` recursive for portability and deterministic pattern matching.

### IN-05: `collapsible.tsx` does not forward `ref` on any of the three wrappers

**File:** `components/ui/collapsible.tsx:26-52`
**Issue:** The shadcn-style wrappers (Collapsible, CollapsibleTrigger, CollapsibleContent) don't forward refs. Radix's underlying primitives expect ref forwarding for focus management (e.g. opening → focus the content). The task-form.tsx usage doesn't currently consume a ref, so this is latent. If any future consumer wants to programmatically focus the "Last done" input when the collapsible opens, they'll hit a dead end.
**Fix:** Wrap each with `React.forwardRef` if a future consumer needs ref access. Not blocking for v1.1 Phase 13 (no current consumer needs it). Matches the existing shadcn pattern in this repo — check `dialog.tsx` / `dropdown-menu.tsx` to confirm convention. If those also skip forwardRef this is consistent with the project style and can be ignored.

---

_Reviewed: 2026-04-22_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
