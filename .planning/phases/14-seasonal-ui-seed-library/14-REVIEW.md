---
phase: 14-seasonal-ui-seed-library
reviewed: 2026-04-22T14:20:00Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - app/(app)/h/[homeId]/by-area/page.tsx
  - app/(app)/h/[homeId]/page.tsx
  - app/(app)/h/[homeId]/person/page.tsx
  - components/band-view.tsx
  - components/dormant-task-row.tsx
  - components/forms/task-form.tsx
  - components/person-task-list.tsx
  - lib/actions/seed.ts
  - lib/actions/tasks.ts
  - lib/schemas/seed.ts
  - lib/seasonal-rendering.ts
  - lib/seed-library.ts
findings:
  critical: 0
  warning: 1
  info: 4
  total: 5
status: issues_found
---

# Phase 14: Code Review Report

**Reviewed:** 2026-04-22T14:20:00Z
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Summary

Phase 14 delivers seasonal UI surfaces (dormant-task rendering across three views, task-form "Active months" + anchored-warning, seasonal seed library entries). The implementation is well-structured: `classifyDormantTasks` is pure and null-safe, `DormantTaskRow` enforces inertness through three independent mechanisms (no `onComplete` prop, empty inline `onClick`, `pointer-events-none`), and the anchored-warning threshold is correctly implemented as `ratio > 0.5` (strict). Seed-library seasonal fields are server-authoritative (read from `SEED_LIBRARY` by id, never trusted from the client payload), and the Phase 14 schema validators (`taskSchema` refine 2 + `seedSelectionSchema`) enforce paired-or-null correctly.

**Focus-area verdicts:**

1. `classifyDormantTasks` null-safety on missing `active_from/to` — **Clean**. Explicit `from == null || to == null` guard at `lib/seasonal-rendering.ts:74` short-circuits year-round tasks before any date math. Archived guard precedes the window check.
2. Badge timezone rendering — **Clean**. `DormantTaskRow` uses `formatInTimeZone(task.nextOpenDate, timezone, 'MMM yyyy')` at `components/dormant-task-row.tsx:47`, and every caller (`by-area/page.tsx:240`, `band-view.tsx:444`, `person-task-list.tsx:256`) threads the home's `timezone` prop. No UTC fallback on the badge path.
3. Anchored-warning projection math — **Clean** (with a latent WR-01 edge case around NaN frequency). Uses `ratio <= 0.5 return null` / renders when `ratio > 0.5` — matches D-04 "STRICTLY greater than 50%" (4+/6). 6-iteration bound matches the spec.
4. No-op click on dormant rows — **Clean**. Three independent guards: no `onComplete` prop in the component signature (T-14-06 mitigation by construction), empty inline `onClick` handler, `pointer-events-none` class.
5. Zod validation for seed entries — **Clean**. `seedSelectionSchema` accepts `active_from_month`/`active_to_month` as `z.number().int().min(1).max(12).nullable().optional()`. Server action at `lib/actions/seed.ts:108` reads them from `SEED_LIBRARY` by seed_id (not from client payload) — T-14-02 mitigation by construction.
6. PB filter parameterization — **No Phase-14 regressions**. The two NEW queries introduced in Phase 14 (`lib/actions/seed.ts:138` and `lib/actions/tasks.ts:196`) both use `pb.filter('home_id = {:hid} && archived = false', { hid: ... })`. Pre-existing interpolated filters in `by-area/page.tsx`, `person/page.tsx`, and `page.tsx` predate Phase 14 and are out of scope for this review; noted in IN-04 only.

514 tests pass, aligning with the cleanliness of this review.

## Warnings

### WR-01: Anchored-warning can render spuriously when frequency input is momentarily NaN

**File:** `components/forms/task-form.tsx:573-582`
**Issue:** The guard inside `AnchoredWarningAlert` only rejects `typeof freq !== 'number' || freq <= 0`. RHF's `register('frequency_days', { valueAsNumber: true })` yields `NaN` when the user clears the numeric input (a transient state that occurs during edits, e.g. between deleting the old value and typing a new one). `NaN` satisfies `typeof x === 'number'`, and `NaN <= 0` is `false`, so the guard falls through. Downstream, `k * NaN * 86400000` produces `NaN`, `new Date(anchor.getTime() + NaN)` yields an Invalid Date, `projected.getUTCMonth()` returns `NaN`, and `isInActiveWindow(NaN, from, to)` evaluates the wrap branch `NaN >= from || NaN <= to` → both `false` → returns `false` → every iteration increments `dormantCount` → ratio = 1.0 → warning renders. A user who momentarily clears the frequency field (e.g., to retype) will see the amber alert flash on screen before typing their new number.

Low user-visible blast radius (the warning is advisory, not gating), but the visual flicker during normal editing is a polish issue and risks a false-positive warning being momentarily captured in a screenshot / bug report.

**Fix:**
```ts
// Add Number.isFinite guard alongside the type + positivity checks.
if (
  typeof anchorDate !== 'string' ||
  anchorDate.length === 0 ||
  fromMonth == null ||
  toMonth == null ||
  typeof freq !== 'number' ||
  !Number.isFinite(freq) ||
  freq <= 0
) {
  return null;
}
```

`Number.isFinite` rejects `NaN`, `Infinity`, and `-Infinity` in one check, and covers non-number inputs without the separate `typeof` (though keeping both is belt-and-braces).

## Info

### IN-01: `page.tsx` uses `as number` cast while `by-area/page.tsx` and `person/page.tsx` use `as number | null`

**File:** `app/(app)/h/[homeId]/page.tsx:160-161`
**Issue:** Inconsistent TS cast for Phase 14 seasonal fields across the three dashboards:

- `app/(app)/h/[homeId]/page.tsx:160-161` — `(t.active_from_month as number) ?? null`
- `app/(app)/h/[homeId]/by-area/page.tsx:108-109, 167-168` — `(t.active_from_month as number | null) ?? null`
- `app/(app)/h/[homeId]/person/page.tsx:157-158` — `(t.active_from_month as number | null) ?? null`

Functionally equivalent today (the `?? null` coalesces either way), but the `as number` cast lies to the type system about what PB may return on these nullable fields. If someone later adds logic that reads the value before the coalesce (e.g., a destructured `const from = t.active_from_month as number`), the two sites would behave differently under a null read. Inconsistency-only — no current bug.

**Fix:**
```ts
// app/(app)/h/[homeId]/page.tsx:160-161
active_from_month: (t.active_from_month as number | null) ?? null,
active_to_month: (t.active_to_month as number | null) ?? null,
```

### IN-02: Anchored-warning uses `getUTCMonth()` while badge uses `formatInTimeZone(home-tz)`

**File:** `components/forms/task-form.tsx:589-590`
**Issue:** The warning's projection math extracts month via `projected.getUTCMonth() + 1`, while the dormant badge at `DormantTaskRow` renders in the home's IANA timezone via `formatInTimeZone`. For the common case (anchor entered via `<input type="date">` = UTC midnight, stepped by whole days = still UTC midnight) the UTC calendar month aligns with any common western-hemisphere local calendar. But for a household in UTC-5 through UTC-10, an anchor of `2026-10-01` is locally `2026-09-30` (late evening) / `2026-09-30` (morning) — `getUTCMonth()` reports October while a home-tz read would report September. The active-window check then treats a September-local cycle as October for threshold counting. Impact is small (advisory warning, ±1 month drift at the boundary) but inconsistent with the badge's home-tz posture and with the Phase 11 seasonal-dormant branch which uses `toZonedTime(... , timezone).getMonth() + 1`.

**Fix (if tightening is desired):**
```ts
// Thread `home_timezone` into TaskForm props or lift from a context; then:
import { toZonedTime } from 'date-fns-tz';
const projected = new Date(anchor.getTime() + k * freq * 86400000);
const zoned = toZonedTime(projected, timezone);
const month = zoned.getMonth() + 1;
```

Alternatively, document the UTC-month approximation as deliberate in the JSDoc and leave as-is — the warning is non-blocking and advisory.

### IN-03: `AnchoredWarningAlert` watch inside a `render` callback

**File:** `components/forms/task-form.tsx:460`
**Issue:** Inside the `Controller` render callback for `active_to_month`, the body calls `watch('active_from_month')`:

```tsx
render={({ field }) => {
  const fromValue = watch('active_from_month');
  return (
    <select ... disabled={fromValue == null} ...>
```

Calling `watch()` inside a `Controller` render subscribes that render pass but doesn't pin it as a dependency. For the disabled-until-from-set hint this works because `Controller` already re-renders on any form state change — but the pattern is subtly fragile. If someone later refactors to memoize the `Controller` render, the `fromValue` subscription would go stale. Prefer lifting the watch to the top-level component and passing the value as a prop to the `Controller`:

**Fix:**
```ts
// At the top of TaskForm, alongside `scheduleMode = watch('schedule_mode')`:
const fromMonthValue = watch('active_from_month');

// Then in the Controller render, use the closure:
render={({ field }) => (
  <select
    ...
    disabled={fromMonthValue == null}
    ...
```

No user-visible bug today — just hardening.

### IN-04: Pre-existing interpolated PB filters in reviewed pages (not introduced by Phase 14)

**File:** `app/(app)/h/[homeId]/by-area/page.tsx:66,72`, `app/(app)/h/[homeId]/page.tsx:66,89,103`, `app/(app)/h/[homeId]/person/page.tsx:76,100,118`, `lib/actions/seed.ts:79`
**Issue:** Several `getFullList` calls in the three page.tsx files and one in `seed.ts` (the areas lookup) interpolate `homeId` directly into the filter string: `filter: \`home_id = "${homeId}"\``. These all predate Phase 14 (traced in git log — they were present in Phases 3, 5, and 10), and Phase 14's NEW queries at `lib/actions/seed.ts:138` and `lib/actions/tasks.ts:196` correctly use `pb.filter('home_id = {:hid}', { hid: ... })`. The pre-existing sites are defence-in-depth-safe because (a) `homeId` comes from Next.js route params (not user-supplied strings in a form body), (b) PB's `viewRule` on the collection re-gates by membership, and (c) `assertMembership` runs first. Still, inconsistency with the parameterized idiom adopted in Phase 10+ is worth flagging for a future sweep — not a Phase 14 regression, and not in-scope for this review.

**Fix (optional future cleanup):**
```ts
// Example for by-area/page.tsx:66
filter: pb.filter('home_id = {:hid}', { hid: homeId }),
```

---

_Reviewed: 2026-04-22T14:20:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
