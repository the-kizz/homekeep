---
phase: 32
phase_name: Configurable Password Policy
status: shipped
covered_reqs: [PATCH2-05, PATCH2-06, PATCH2-07]
---

# Phase 32 Summary — Configurable Password Policy + Task-Tap UX

## Trigger

User feedback during v1.2.1 fix round surfaced three UX concerns while
re-testing auth and task flows:

1. **"Sometimes the form says 8 char min and sometimes 12 char min."** —
   After Phase 23 SEC-06 raised the signup/reset-confirm floor 8 → 12,
   login-schema stayed at 8 for back-compat. Users signing up + logging
   in see both messages within the same session. For a self-hosted LAN
   instance the 12-char bar is also friction with no threat-model
   justification. → **PATCH2-05 — configurable password policy.**

2. **"Click on a task defaults to marking it complete, not opening
   details."** — The 03-02 design chose tap = complete (primary) with
   long-press / right-click = detail. The user prefers the iOS-style
   tap = view, explicit-button = action pattern. → **PATCH2-06 — flip
   primary tap to detail.**

3. **"Early-completion dialog fires on a task I just created."** — The
   03-01 guard used `task.created` as a fallback reference when no
   prior completion existed. For a task created 3 minutes ago, any
   completion "today" was flagged as too soon. That's a false positive
   — the common case is "I added this task today, and I did the chore
   today." → **PATCH2-07 — never-completed tasks bypass the guard.**

The three changes shipped together because they all affect the same
day-one self-host feel.

## PATCH2-05 — PASSWORD_POLICY env flag

**File:** `lib/schemas/auth.ts`, `.env.example`, `docs/deployment-hardening.md`

Introduced `isStrongPolicy()` that reads `NEXT_PUBLIC_PASSWORD_POLICY`
(preferred, client-inlined at build) then `PASSWORD_POLICY` (server
runtime fallback). Default: `simple` (8-char floor). Opt-in: `strong`
(12-char floor, Phase 23 SEC-06 behavior).

Implementation switched from static `z.string().min(N)` to
`z.string().superRefine()` so the min is read at parse time, not at
module load — tests can stub env with `vi.stubEnv` and each parse
reflects the current value.

Login schema stays at 8 always so pre-strong accounts keep logging in.

`.env.example` documents both env vars. `docs/deployment-hardening.md`
adds item 12b: "Set PASSWORD_POLICY=strong for public exposure" with
command + verify steps. Summary table updated.

## PATCH2-06 — Task-tap opens detail

**Files:** `components/task-row.tsx`, `components/task-band.tsx`,
`components/person-task-list.tsx`

`TaskRow` gains a `primaryTap?: 'complete' | 'detail'` prop. When
`onDetail` is provided, default becomes `'detail'` (tap opens the
detail sheet; completion lives behind its Complete button). When
`onDetail` is absent, default stays `'complete'` (legacy call sites
unaffected).

`TaskBand` passes `primaryTap` through to the row. `PersonTaskList`
explicitly sets `primaryTap="complete"` — its `onDetail` opens a
reschedule sheet (not a detail view), so tap = complete is still the
right semantics there.

## PATCH2-07 — Never-completed bypass on guard

**File:** `lib/early-completion-guard.ts`

`shouldWarnEarly` now short-circuits `return false` when
`lastCompletion === null`. The `task.created` fallback is removed
from the hot path.

The rationale shift: the guard is for "you double-tapped / forgot you
already did this today" accidents, which requires a prior completion
to be relative to. A first-ever completion can't be double-done, so
the guard has nothing to protect against. Keeping `task` in the
signature for API compatibility.

## Files changed

- `lib/schemas/auth.ts` — `isStrongPolicy()`, `signupPasswordMin()`, superRefine-based schemas
- `.env.example` — PASSWORD_POLICY + NEXT_PUBLIC_PASSWORD_POLICY documented
- `docs/deployment-hardening.md` — new item 12b + summary row
- `components/task-row.tsx` — `primaryTap` prop + handler rewrite
- `components/task-band.tsx` — forward `primaryTap` to rows
- `components/person-task-list.tsx` — explicit `primaryTap="complete"` opt-out
- `lib/early-completion-guard.ts` — never-completed short-circuit
- `tests/unit/schemas/auth.test.ts` — rewrote to cover simple default + strong opt-in
- `tests/unit/early-completion-guard.test.ts` — flipped "never completed → warn" cases to expect NO warn
- `tests/unit/task-row.test.tsx` — added PATCH2-06 tap-default + primaryTap="complete" cases
- `tests/e2e/v1.2-live-smoke.spec.ts` — tap opens detail, Complete button inside sheet, no guard on first completion

## Verification

- Full unit suite: **678/678 green** (6 new tests across PATCH2-05/06/07)
- Integration: load-smoothing + schedule-overrides integration tests untouched (their completion setups back-date completions, unaffected)

## REQ-IDs

- **PATCH2-05** ✓ — PASSWORD_POLICY env flag (simple default / strong opt-in)
- **PATCH2-06** ✓ — Task tap opens detail sheet; completion behind Complete button
- **PATCH2-07** ✓ — Never-completed tasks bypass early-completion guard
