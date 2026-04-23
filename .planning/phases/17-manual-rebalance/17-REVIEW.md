---
phase: 17-manual-rebalance
reviewed: 2026-04-22T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - app/(app)/h/[homeId]/settings/page.tsx
  - app/(app)/h/[homeId]/settings/scheduling/page.tsx
  - components/rebalance-card.tsx
  - components/rebalance-dialog.tsx
  - lib/actions/rebalance.ts
  - lib/rebalance.ts
findings:
  critical: 0
  warning: 2
  info: 5
  total: 7
status: issues_found
---

# Phase 17: Code Review Report

**Reviewed:** 2026-04-22
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Phase 17 manual-rebalance implementation is solid. The core focus areas are all correct:

- **Classifier bucket priority** (`lib/rebalance.ts:96-145`) — D-02 exclusions first (archived/OOFT), then strict first-match-wins ordering (anchored → active_snooze → from_now_on → rebalanceable with dormancy gate). Each branch uses `continue` so buckets are disjoint.
- **Forward-only apply** — Writes only touch `tasks.next_due_smoothed` (rebalanceable) and `tasks.reschedule_marker = null` (from_now_on). No sibling-task mutations, no writes to other collections.
- **Atomic batch** — Both `next_due_smoothed` updates and `reschedule_marker` clears are appended to the same `pb.createBatch()` object and shipped in one `batch.send()` call (`lib/actions/rebalance.ts:346-366`). PB rolls back the full batch on any op failure.
- **Ascending ideal-date sort** — `ranked.sort((a,b) => a.naturalIdeal.getTime() - b.naturalIdeal.getTime())` at line 289-291. V8's Array.prototype.sort is stable (ES2019+), so deterministic given deterministic input order.
- **Membership/ownership gates** — Both pages use `assertOwnership`; actions use `assertMembership` (design: any member can rebalance, only owners can open settings). Server Components gate before render — URL bypass impossible.
- **PB filter parameterisation** — `lib/actions/rebalance.ts:135` uses `pb.filter('{:hid}', { hid: homeId })` binding. Safe.
- **Apply error handling** — Outer try/catch at line 262/375 wraps the batch and returns sanitised `'Could not apply rebalance'` formError. No stack/PB leak.
- **router.refresh after apply** — `components/rebalance-dialog.tsx:96` calls it after `setOpen(false)` on success.
- **Second-run idempotency** — Sort key derives from `lastCompletion?.completed_at ?? task.created`, not from `next_due_smoothed`, so a previous apply's output does not feed the next run's ordering. Markers cleared on apply so from_now_on drains to empty on run 2; those tasks route to rebalanceable. Algorithm stays deterministic modulo real-world time/completion drift.

598 tests passing confirms behavioural correctness. Findings below are code-quality and defence-in-depth observations, not bugs.

## Warnings

### WR-01: Pre-existing unparameterised PB filter in settings page

**File:** `app/(app)/h/[homeId]/settings/page.tsx:59`
**Issue:** The pending-invites query uses template-literal concatenation rather than `pb.filter(..., { hid: homeId })`:

```ts
filter: `home_id = "${homeId}" && accepted_at = ""`,
```

This is not Phase 17 code (the file was edited to add the Scheduling card at lines 124-144, not this block), and `homeId` comes from a typed `params` promise that ultimately traces to Next.js routing — not raw user input. However, it's inconsistent with the `pb.filter()` parameter-binding pattern used everywhere else in Phase 17 (`lib/actions/rebalance.ts:135`, `lib/membership.ts:37`) and flagged as "safe filter" convention (02-04 anti-SQLi).

**Fix:** When next touching this file, migrate to:
```ts
filter: pb.filter('home_id = {:hid} && accepted_at = ""', { hid: homeId }),
```
Non-blocking for Phase 17 since the Phase 17 diff did not introduce this pattern, but worth tracking. No fix required in this phase.

### WR-02: Empty-batch edge case can still report success with updated=0

**File:** `lib/actions/rebalance.ts:300-334, 364-374`
**Issue:** If every placement inside the `for (const { task } of ranked)` loop throws and gets swallowed by the `console.warn` branch (line 326-334), `placedDates` stays empty and `updateCount` stays at 0. If additionally `buckets.from_now_on.length === 0`, the `batch.send()` is skipped (line 364 guard), and the function returns `{ ok: true, updated: 0 }`. The Dialog's toast then reads "Rebalanced 0 tasks" — technically truthful but misleading, since the Dialog hid the Apply button only when `preview.update_count === 0` at preview time; by apply time every placement could have failed.

The reverse case (some placements fail, some succeed) is already the documented D-06 best-effort semantics — partial success is fine and `updated: N` reports the actual count.

**Fix:** Two options, pick one:
```ts
// Option A — surface total-failure as a formError
if (ranked.length > 0 && placedDates.size === 0) {
  return { ok: false, formError: 'Could not apply rebalance' };
}

// Option B — accept the edge case but adjust the toast copy
// in rebalance-dialog.tsx to handle updated === 0 specifically:
toast.success(
  r.updated === 0
    ? 'Rebalance complete (no placements changed)'
    : `Rebalanced ${r.updated} task${r.updated === 1 ? '' : 's'}`,
);
```
Probability of hitting this is vanishingly low in production (every placeNextDue would have to throw), but the current UX is confusing if it ever fires.

## Info

### IN-01: Redundant createServerClient call in apply

**File:** `lib/actions/rebalance.ts:345`
**Issue:** `fetchAndClassify` already creates a server client at line 112 (internal to the helper). `rebalanceApplyAction` then creates a second one at line 345 to build the batch. Both calls return semantically equivalent clients (server-side, cookie-authed), so this is not a correctness issue — just an extra PocketBase SDK construction per apply.

**Fix:** Have `fetchAndClassify` return the `pb` client in the `PreambleSuccess` payload so callers can reuse it:
```ts
type PreambleSuccess = {
  pb: PocketBase;
  homeId: string;
  // ...
};
```
Minor; ~1ms saved per apply.

### IN-02: Timezone fallback misses empty-string case

**File:** `lib/actions/rebalance.ts:130`, `app/(app)/h/[homeId]/settings/scheduling/page.tsx:47`, `app/(app)/h/[homeId]/settings/page.tsx:70,95`
**Issue:** Pattern `(home.timezone as string) ?? 'UTC'` — the `??` nullish-coalescing only falls through for `null`/`undefined`. If `timezone` is ever an empty string (`''`), the assertion succeeds and the empty string flows forward. `formatInTimeZone('', ...)` in `isoDateKey` would throw.

Schema-level: homes creation validation should ensure `timezone` is non-empty. In practice this is never triggered. Still, the fallback is weaker than it reads.

**Fix:** Use a truthy fallback for defence in depth:
```ts
const homeTz = (home.timezone as string) || 'UTC';
```
Low priority — not a production issue given home-creation validation, but the defensive intent of the fallback isn't matched by the operator chosen.

### IN-03: `frequency_days as number` cast leans on classifier invariant

**File:** `lib/actions/rebalance.ts:285`
**Issue:** `const freq = task.frequency_days as number;` — `Task.frequency_days` is typed `number | null`. The cast is safe because OOFT (frequency_days null or 0) is excluded by the classifier's `isOoftTask(task)` check at `lib/rebalance.ts:99`. However, the invariant isn't documented at the cast site.

**Fix:** Add a 1-line comment or runtime assert:
```ts
// Classifier excluded OOFT (freq null | 0) — safe positive int here.
const freq = task.frequency_days as number;
```
Or with a defensive assert:
```ts
if (!Number.isInteger(task.frequency_days) || task.frequency_days! <= 0) {
  continue; // should never happen — classifier invariant
}
const freq = task.frequency_days;
```

### IN-04: Dialog guard admits a re-fetch path that is effectively dead

**File:** `components/rebalance-dialog.tsx:66-78`
**Issue:** The open-handler guards fetch with `nextOpen && preview === null && !isPending`. On a prior failed fetch, `error` is set, `preview` is null, and `isPending` is false. The close handler (line 80-85) resets both. So in practice re-opening after an error triggers a clean re-fetch (desired). However, the guard does not also check `error === null`, meaning if the close reset were ever removed/reordered, we would re-fetch on reopen even if `error` was still set. The current behaviour is correct; the guard just has an implicit dependency on the reset.

**Fix:** Either inline a comment near line 68 noting the dependency on the close-reset, or make the guard self-sufficient:
```ts
if (nextOpen && preview === null && error === null && !isPending) { ... }
```
No behavioural change today; future-proofing only.

### IN-05: `home.name as string ?? 'Home'` parenthesisation reads ambiguously

**File:** `app/(app)/h/[homeId]/settings/page.tsx:70,93`, `app/(app)/h/[homeId]/settings/scheduling/page.tsx:47`
**Issue:** `(home.name as string) ?? 'Home'` — the parentheses make it unambiguous, but the nullish-coalesce only fires for null/undefined. If `name` is ever an empty string (PB may coerce missing string field to ''), the UI would render "Home" in the header and `{homeName}` in back-button text would appear blank. Matches the same empty-string-vs-nullish concern as IN-02.

**Fix:** Consistent with IN-02:
```ts
const homeName = (home.name as string) || 'Home';
```
Cosmetic only — homes always have a name after form validation.

---

_Reviewed: 2026-04-22_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
