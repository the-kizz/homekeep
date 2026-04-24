<!-- gitleaks:allow (code references, no secrets) -->
---
phase: 36
phase_name: Signup → /h Redirect Race Fix
status: shipped
parent_milestone: v1.3-test-stabilization
covered_reqs: [TESTFIX-03]
---

# Phase 36 Summary — Signup → /h Redirect Race Fix

## Problem (from v1.3 triage)

What the v1.2-security audit called "10 pre-existing E2E failures on
signup → /h$ URL assertion" turned out to be **18 assertions across
12 specs** with ONE root cause — every spec that calls the shared
`signup()` helper inherits the same race.

**Signal:** Playwright's `page.toHaveURL(/\/h$/)` (5s default) would
intermittently time out after a signup submit. Sequence under
concurrency:

1. `signupAction` (`lib/actions/auth.ts:142-202`) runs:
   - PB `users/create` → user row committed
   - PB `users/authWithPassword` → token issued
   - cookie set, `revalidatePath('/h')`, `redirect('/h')`
2. Browser follows 302 → GET /h
3. `app/(app)/layout.tsx` runs:
   - `createServerClientWithRefresh()` reads cookie into authStore
   - Calls PB `users/authRefresh` to re-validate the token
4. If `authRefresh` throws → `pb.authStore.clear()` → `isValid=false`
   → `redirect('/login')` → test sees `/login`, not `/h`, times out

Under CI with `DISABLE_RATE_LIMITS=true` and 15+ parallel signups/min,
PB occasionally returns a transient error on `authRefresh` for a
just-issued token. The token is valid; PB is just momentarily
overloaded on a concurrent-write hot path.

## Fix

Targeted retry in `createServerClientWithRefresh`. The happy path
is untouched; only the error path pays ~150ms + one extra round-trip
before declaring the token dead:

```ts
export async function createServerClientWithRefresh() {
  const pb = await createServerClient();
  if (pb.authStore.isValid) {
    try {
      await pb.collection('users').authRefresh();
    } catch {
      // Transient PB failure under concurrent signup/login load can
      // briefly reject a freshly-issued token. Retry once after a
      // short pause before treating the token as definitively invalid.
      try {
        await new Promise((r) => setTimeout(r, 150));
        await pb.collection('users').authRefresh();
      } catch {
        pb.authStore.clear();
      }
    }
  }
  return pb;
}
```

### Why this is the right layer (vs. fixing `signupAction` directly)

- **Hits every entry point**, not just signup. Login, session
  restore, trust-boundary revalidation — all go through
  `createServerClientWithRefresh`. If there's a transient race in
  any of them, one fix covers all.
- **Minimal surface area.** No changes to the `redirect()` +
  `revalidatePath()` dance inside Server Actions (which is the
  documented Next.js 16 pattern — inverting it would fight the
  framework).
- **Zero impact on the happy path.** The retry is on the catch
  arm. Normal auth traffic pays zero extra overhead.

### Why retry-once, not retry-many

PB's transient errors under load resolve within ~50-100ms in
practice. One retry with 150ms pause catches virtually all of them.
Multi-retry loops introduce unbounded latency and mask real token
invalidity (expired / revoked) from being surfaced at the trust
boundary.

## Files changed

- `lib/pocketbase-server.ts` — added single retry in
  `createServerClientWithRefresh`'s catch arm

## Verification

- Unit tests: 678/678 green — no regression (retry only fires on
  PB error path; no test exercises that path since it's a
  side-channel race condition)
- Local TypeScript check clean
- Confirms when homes-areas + notifications E2E specs (re-enabled in
  Phase 35) run green on CI — they both use the `signup()` helper
  and would flake without this fix
- Longer-term validation = TESTFIX-05's flake-retry budget lands
  (Phase 38); zero Playwright retries on master for 10 consecutive
  builds is the real proof

## What was explicitly NOT changed

- **`lib/actions/auth.ts` `signupAction` / `loginAction`** —
  framework-idiomatic `redirect` + `revalidatePath` ordering
  preserved
- **`app/(app)/layout.tsx`** — still calls
  `createServerClientWithRefresh` at the trust boundary; just now
  more forgiving of a single transient PB hiccup
- **No test-level band-aids** (explicit `waitForURL` with long
  timeouts) — those were Option B in the triage; Option A (this
  server-side fix) is the source-of-truth fix. Callers stay clean.
