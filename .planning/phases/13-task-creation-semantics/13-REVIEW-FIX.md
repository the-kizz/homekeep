---
phase: 13-task-creation-semantics
fixed_at: 2026-04-22T12:55:00Z
review_path: .planning/phases/13-task-creation-semantics/13-REVIEW.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 13: Code Review Fix Report

**Fixed at:** 2026-04-22
**Source review:** `.planning/phases/13-task-creation-semantics/13-REVIEW.md`
**Iteration:** 1

**Summary:**

- Findings in scope: 2 (both warnings; IN-01..IN-05 deferred per scope)
- Fixed: 2
- Skipped: 0

Baseline verification: `npm test` → **54 test files / 492 tests passed**. No regression.

## Fixed Issues

### WR-01: `last_done` raw string passed to `new Date(...)` without date-shape validation

**Files modified:** `lib/schemas/task.ts`, `lib/actions/tasks.ts`
**Commit:** `01efd05`
**Applied fix:**

- `lib/schemas/task.ts` — tightened `last_done` from `z.string().nullable().optional()` to require the ISO date prefix via `.regex(/^\d{4}-\d{2}-\d{2}/, 'Last done must be a valid date')`. Crafted-form garbage (`"not-a-date"`) now trips zod `safeParse` and surfaces as a real `fieldErrors.last_done` response instead of silently falling through to `new Date(...)` → Invalid Date → swallowed RangeError. Kept `.nullable().optional()` so the form may omit the field entirely and still route to TCSEM-03 smart-default.
- `lib/actions/tasks.ts` — added a defense-in-depth `Number.isNaN(new Date(v).getTime())` check BEFORE the inner placement try/catch. Catches regex-passing-but-semantically-invalid dates (e.g. `"9999-99-99"`) and returns `{ ok: false, fieldErrors: { last_done: [...] } }`. Crucially positioned outside the inner try so the early return is NOT swallowed by the placement catch. The duplicated body-level comment/check was collapsed to reference the upstream validation.

TypeScript: `npx tsc --noEmit` exit 0.
Tests: 492/492 pass.

### WR-02: `updateTask` reads `last_done` from formData but silently ignores it

**Files modified:** `components/forms/task-form.tsx`
**Commit:** `aed5e9c`
**Applied fix:** Option A (recommended) — hide the Advanced collapsible in edit mode. Changed `{scheduleMode === 'cycle' && (...)}` to `{mode === 'create' && scheduleMode === 'cycle' && (...)}` at the Advanced collapsible render site. Users editing a task no longer see the "Last done" input, so they cannot type a value, save, and be surprised that nothing changed. Matches the creation-only scope acknowledged in the `updateTask` comment at `tasks.ts:302-305`.

TypeScript: `npx tsc --noEmit` exit 0.
Tests: 492/492 pass.

## Skipped Issues

None in scope. IN-01..IN-05 (info-level) were explicitly deferred by the fix scope and are documented in `13-REVIEW.md` for a future pass.

---

_Fixed: 2026-04-22_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
