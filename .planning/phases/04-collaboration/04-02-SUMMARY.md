---
phase: 04-collaboration
plan: 02
subsystem: server-actions
tags: [invites, members, pocketbase-admin-client, createBatch, membership-preflight, signup-next, zod-schemas, integration-test, bootstrap-batch]

# Dependency graph
requires:
  - phase: 04-collaboration
    plan: 01
    provides: "home_members + invites collections, rule swap to membership-gated, owner-member auto-insert hook"
  - phase: 02-auth-core-data
    provides: "homes/areas/tasks owner-preflight pattern, safeNext helper, zod schema style, disposable-PB test scaffolding"
  - phase: 03-core-loop
    provides: "completions lifecycle, pb.createBatch() as used in reorderAreas (now depends on batch-enabled bootstrap)"
provides:
  - "lib/pocketbase-admin.ts — superuser PB client with 30-min TTL cache (Pitfall 3)"
  - "lib/invite-tokens.ts — generateInviteToken via crypto.randomBytes(24).toString('base64url')"
  - "lib/membership.ts — assertMembership + assertOwnership helpers"
  - "lib/actions/invites.ts — createInvite / acceptInvite / revokeInvite"
  - "lib/actions/members.ts — removeMember / leaveHome"
  - "Public /invite/[token] route — landing page with signup-next thread-through"
  - "SignupForm + signupAction: next-param consumption"
  - "Phase 2/3 mutation actions swapped to member-gated preflight (D-13)"
  - "pocketbase/pb_hooks/bootstrap_batch.pb.js — enables PB batch API (Rule 3 blocking)"
affects:
  - "04-03 (cascading assignment) — can call createInvite/acceptInvite/removeMember/leaveHome/revokeInvite; TASK-02 assigned_to_id passthrough complete on create/updateTask"
  - "Phase 4.1 deploy — REQUIRES PB_ADMIN_EMAIL + PB_ADMIN_PASSWORD in .env before acceptInvite works"
  - "Phase 5+ — any future mutation must use assertMembership/assertOwnership instead of the old owner-implicit getOne pattern"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PB 0.23+ _superusers.authWithPassword (replaces pb.admins.authWithPassword)"
    - "pb.createBatch() with admin client for atomic cross-collection write (invites.update + home_members.create)"
    - "Module-level TTL cache (30-min) for admin-client auth — amortises authWithPassword rate limit"
    - "Next 16 async searchParams + async params contract"
    - "safeNext open-redirect guard threaded through signup → invite-acceptance"
    - "PB batch API bootstrap flag via onBootstrap hook (parallels bootstrap_ratelimits / bootstrap_smtp)"

key-files:
  created:
    - "lib/pocketbase-admin.ts (62 lines) — admin client factory + TTL cache + reset helper"
    - "lib/invite-tokens.ts (28 lines) — crypto.randomBytes → base64url generator"
    - "lib/membership.ts (52 lines) — assertMembership + assertOwnership"
    - "lib/schemas/invite.ts (33 lines) — createInviteSchema, acceptInviteSchema (20..64 base64url), revokeInviteSchema"
    - "lib/schemas/member.ts (22 lines) — removeMemberSchema, leaveHomeSchema"
    - "lib/actions/invites.ts (234 lines) — createInvite + acceptInvite (admin batch) + revokeInvite"
    - "lib/actions/members.ts (154 lines) — removeMember + leaveHome"
    - "app/(public)/invite/[token]/page.tsx (82 lines) — public landing + signup-next redirect + acceptInvite branching"
    - "tests/unit/invite-tokens.test.ts (33 lines) — length/alphabet/uniqueness"
    - "tests/unit/schemas/invite.test.ts (76 lines) — schema happy + edge cases"
    - "tests/unit/schemas/member.test.ts (57 lines) — schema happy + edge cases"
    - "tests/unit/actions/invites-roundtrip.test.ts (414 lines) — 9-scenario live-PB integration test"
    - "pocketbase/pb_hooks/bootstrap_batch.pb.js (43 lines) — enables PB batch API (Rule 3 blocking fix)"
  modified:
    - "lib/actions/auth.ts — signupAction consumes formData.next via safeNext; redirects accordingly"
    - "components/forms/signup-form.tsx — accepts next prop + renders hidden <input name='next'>"
    - "app/(public)/signup/page.tsx — Next 16 async searchParams contract; reads + threads next; Log-in link also threads next"
    - "lib/actions/areas.ts — createArea/updateArea/reorderAreas/deleteArea swap owner-preflight → assertMembership"
    - "lib/actions/tasks.ts — createTask/updateTask/archiveTask swap to assertMembership; adds assigned_to_id passthrough on create+update"
    - "lib/actions/completions.ts — completeTaskAction adds assertMembership after tasks.getOne, before archived check"
    - "lib/actions/homes.ts — updateHome/deleteHome use assertOwnership; switchHome silent assertMembership defense"
    - ".env.example — PB_ADMIN_EMAIL + PB_ADMIN_PASSWORD placeholders; no-trailing-slash note on SITE_URL"

key-decisions:
  - "Use pb.createBatch() via ADMIN client for acceptInvite (not the authed user's client) because invites.updateRule=null — only superuser can update invite rows; the user's authStore cannot authorise that write"
  - "TTL-cache admin client for 30 minutes (Pitfall 3) — balances rate-limit pressure against token-lifetime security; resetAdminClientCache() exposed for tests"
  - "assigned_to_id validation: trust-the-rule (PB relation field rejects invalid user ids) rather than explicit assertMembership-on-assignee helper — simpler, and Wave 3's resolveAssignee falls through to area/anyone when the assignee is no longer a member"
  - "Port 18094 for invites-roundtrip test — 18093 was already claimed by 04-01 rules-member-isolation.test.ts (plan spec said 18093 but it was a copy-paste)"
  - "switchHome gains silent assertMembership defense — prevents setting last_viewed_home_id to a home the user can't access (which would 404 the (app)/layout redirect)"
  - "Enable PB batch API via bootstrap hook (bootstrap_batch.pb.js) rather than migration — PB settings aren't a migratable collection; the onBootstrap pattern matches bootstrap_ratelimits.pb.js"

patterns-established:
  - "Admin client pattern: one factory, cached at module scope, never exported to client components"
  - "Discriminated-union AcceptInviteResult with typed `reason` strings — UI branches on string literal, no magic constants"
  - "signup-next threading: search param → hidden input → formData.next → safeNext → redirect"
  - "Disposable-PB port allocation: 18094 for 04-02 (new), following 18090/91/92/93 from Phases 2-4.1"
  - "Vitest mocking of createServerClient + createAdminClient so server-action integration tests run without spinning up Next.js"

requirements-completed: [HOME-05, HOME-06]

# Metrics
duration: 13min
completed: 2026-04-21
---

# Phase 4 Plan 02: invites + members server actions + /invite route + signup-next Summary

**Owner → invite-link → new-user signup → acceptInvite → shared-home round-trip is green end-to-end against a live PocketBase, with atomic home_members-plus-invites writes via the admin client's createBatch, signup-next open-redirect-safe thread-through, and all Phase 2/3 mutation actions swapped from owner-implicit getOne preflight to the explicit assertMembership / assertOwnership helper.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-04-21T03:21:51Z
- **Completed:** 2026-04-21T03:34:40Z
- **Tasks:** 3
- **Files created:** 13
- **Files modified:** 8

## Accomplishments

- **Admin client factory** (`lib/pocketbase-admin.ts`) with a 30-minute module-level TTL cache, reading `PB_ADMIN_EMAIL` / `PB_ADMIN_PASSWORD` from env and authing via PB 0.23+ `_superusers.authWithPassword`. Exposes `resetAdminClientCache()` for test teardown.
- **Invite token generator** (`lib/invite-tokens.ts`) via `crypto.randomBytes(24).toString('base64url')` = 192-bit entropy, 32-char URL-safe output. 20 unit-test assertions across length, alphabet, entropy (1000 unique), and type-guard checks.
- **Membership helpers** (`lib/membership.ts`) — `assertMembership` returns `{role}`, `assertOwnership` throws if role !== 'owner'. Both use `pb.filter` parameter binding (02-04 anti-SQLi pattern).
- **Zod schemas** — `createInviteSchema`, `acceptInviteSchema` (regex `^[A-Za-z0-9_-]{20,64}$` mirroring the PB `1714953601_invites.js` field constraint), `revokeInviteSchema`, `removeMemberSchema`, `leaveHomeSchema`. 15 unit-test assertions covering happy + edge.
- **Invite server actions** (`lib/actions/invites.ts`): `createInvite` (owner-only via `assertOwnership`, token + SITE_URL + 14-day expiry, returns `{ok, token, url, expiresAt}`), `acceptInvite` (admin-client reads the invite, atomic batch writes `home_members` + `invites.accepted_at`, idempotent for self-replay, typed `reason: 'expired'|'already-accepted'|'invalid'|'not-authed'|'error'`), `revokeInvite` (owner-only, refuses to revoke already-accepted invites).
- **Member server actions** (`lib/actions/members.ts`): `removeMember` (owner-only; refuses self-removal, refuses owner-row deletion, clears target's `last_viewed_home_id` if matched), `leaveHome` (non-owner only; clears own `last_viewed_home_id`).
- **Public /invite/[token] route**: shape-validates token, redirects unauthed to `/signup?next=/invite/TOKEN` (base64url URL-safe, no `encodeURIComponent` — T-04-02-10), runs `acceptInvite` when authed, branches on discriminated-union result (redirect to `/h/{homeId}` on success, friendly error card otherwise). `export const dynamic = 'force-dynamic'` to prevent accidental caching of per-token responses.
- **Signup-next flow**: `SignupForm` accepts `next?: string` prop and renders a hidden `<input name="next">`. `SignupPage` uses Next 16 async `searchParams` to read `?next=` and thread it through the form and the "Log in" link. `signupAction` now consumes `formData.get('next')` via the existing `safeNext` helper (02-03 T-02-03-08 open-redirect guard), defaulting to `/h` when absent.
- **Phase 2/3 preflight swap** (D-13): every mutation in `lib/actions/{areas,tasks,completions,homes}.ts` now uses `assertMembership` (member-permitted: createArea, updateArea, reorderAreas, deleteArea, createTask, updateTask, archiveTask, completeTaskAction) or `assertOwnership` (owner-only: updateHome, deleteHome). `createHome` unchanged (owner-bootstrap via hook); `switchHome` gains silent `assertMembership` defense to prevent `last_viewed_home_id` pointing at inaccessible homes. `createTask` / `updateTask` also gain `assigned_to_id` formData passthrough for TASK-02 (Wave 3's UI picker will drive it).
- **Integration test** (`tests/unit/actions/invites-roundtrip.test.ts`) — 9 scenarios green on port 18094 against a live disposable PB with all Phase 2/3/4 migrations: createInvite happy path + DB row shape, first-accept atomic batch, self-replay idempotency, already-accepted rejection, non-owner rejection, expired rejection, removeMember happy, owner-leaveHome refusal, member-leaveHome + last_viewed clearance.

## Task Commits

1. **Task 1 RED: zod schemas + invite-token unit matrix** — `111e157` (test)
2. **Task 1 GREEN: admin client + token gen + membership helpers + schemas** — `258e887` (feat)
3. **Task 2 RED: invites-members roundtrip on live PB** — `1037de6` (test)
4. **Task 2 GREEN: invites + members server actions + /invite route + signup-next** — `218c43b` (feat)
5. **Task 3: swap ownership preflight → assertMembership / assertOwnership in Phase 2/3 actions** — `992d855` (feat)

**Plan metadata commit:** pending (this summary + STATE + ROADMAP + REQUIREMENTS).

## Decisions Made

- **acceptInvite uses the admin client's createBatch for BOTH operations** (not a split: authed-user for `home_members.create` + admin for `invites.update`). Research Pattern 8 suggested the split for "attribution", but the `accepted_by_id` field on the invite record is set server-side from `pb.authStore.record.id` on the authed client, which provides the attribution; and the admin-only batch is cleaner atomically. Reviewed the security posture: the `role: 'member'` value is hardcoded, no client input flows into the batch, so the admin path is safe.
- **TTL cache 30 minutes** — balances PB's `*:authWithPassword` 20/60s rate limit (Pitfall 3) against admin-token security. 30m matches the PB default auth-token lifetime for non-superusers; superuser tokens in PB 0.37 default to a multi-hour window, so we have plenty of headroom.
- **`assigned_to_id` validation: trust the rule, not a helper**. The plan offered two options: (a) re-check via `assertMembership(pb, homeId, {userId: assigned_to_id})` by extending the helper to take an optional non-self user, or (b) rely on PB's relation field validation + Wave 3's `resolveAssignee` to gracefully fall through for orphaned assignees. Shipped (b): simpler, avoids over-engineering, and Wave 3 already owns the member-filtering logic. If a forged non-member id lands on a task, the UI just shows "Anyone" until the next edit — no data corruption, no security leak.
- **Port 18094 for the roundtrip test** (not 18093). The plan's `<behavior>` referenced 18093, but `tests/unit/rules-member-isolation.test.ts` from 04-01 already claims that port. Running them in parallel would collide. Documented in the RED test file header.
- **Enable PB batch API via bootstrap hook**. PB 0.37.1 ships `settings.batch.enabled = false` by default, which made every `pb.createBatch().send()` call return HTTP 403 `Batch requests are not allowed.`. The existing `reorderAreas` code path already called `pb.createBatch()` but had no tests exercising it (UI-only 02-04 behavior). Without this fix, both `acceptInvite` and `reorderAreas` would silently formError in production. The hook mirrors `bootstrap_ratelimits.pb.js` + `bootstrap_smtp.pb.js` and sets `maxRequests: 50` (generous — `acceptInvite` = 2 ops, `reorderAreas` = up to N areas per home).
- **`switchHome` silent assertMembership defense** — best-effort, no formError surface. If a user somehow clicks a stale HomeSwitcher option for a home they've been removed from, the action just no-ops rather than 404-ing their next login.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] PB batch API disabled by default in PB 0.37**
- **Found during:** Task 2 GREEN (running the 9-scenario integration test for the first time)
- **Issue:** `pb.createBatch().send()` in `acceptInvite` returned HTTP 403 `Batch requests are not allowed.` because PB 0.37 ships `settings.batch.enabled = false` by default. Additionally, the Phase 2 `reorderAreas` code in `lib/actions/areas.ts` already depended on batch but had never been live-tested (UI-only path). 5 of 9 test scenarios failed with `{ok:false, reason:'error'}`.
- **Fix:** Created `pocketbase/pb_hooks/bootstrap_batch.pb.js` that idempotently sets `settings.batch.enabled = true` + `maxRequests = 50` on every boot, following the `bootstrap_ratelimits.pb.js` pattern. All 9 scenarios now pass.
- **Files modified:** `pocketbase/pb_hooks/bootstrap_batch.pb.js` (created, 43 lines).
- **Verification:** `npx vitest run tests/unit/actions/invites-roundtrip.test.ts` — 9/9 pass.
- **Committed in:** `218c43b` (Task 2 GREEN commit).

**2. [Rule 1 - Bug] Test port conflict: plan said 18093 but that port is claimed by 04-01 rules-member-isolation.test.ts**
- **Found during:** Task 2 RED (reading 04-01 SUMMARY + plan spec)
- **Issue:** Plan `<behavior>` specified port 18093 for the new integration test, but `04-01-SUMMARY.md` documents that `rules-member-isolation.test.ts` already claims 18093. Vitest parallel runners would collide.
- **Fix:** Use port 18094. Documented in the test file header comment block + this summary.
- **Files modified:** `tests/unit/actions/invites-roundtrip.test.ts` (port constant).
- **Verification:** Tests run cleanly alongside 04-01's test suite (`npm test` green with 168/168 passing).
- **Committed in:** `1037de6` (Task 2 RED commit).

**3. [Rule 1 - Bug] Unused `aliceClient` helper in integration test**
- **Found during:** Task 2 GREEN (lint gate)
- **Issue:** A module-level `aliceClient = () => new PocketBase(...)` helper was carried from an early draft of the test; the final scenarios instantiate `PocketBase` inline per-test, so the helper was never called. ESLint flagged `@typescript-eslint/no-unused-vars`.
- **Fix:** Removed the dead helper.
- **Files modified:** `tests/unit/actions/invites-roundtrip.test.ts`.
- **Verification:** `npm run lint` — only the pre-existing 02-05 task-form warning remains.
- **Committed in:** `218c43b` (Task 2 GREEN commit).

### Plan-spec enhancements (noted, no correction needed)

**4. [Rule 2 - Auto-add missing critical functionality] `assigned_to_id` passthrough on createTask + updateTask**
- **Context:** The plan's Task 3 `<behavior>` noted "updateTask now accepts `assigned_to_id` from formData… createTask accepts it too". taskSchema already had the field (02-05). I added the formData parsing + PB-create-payload pipe-through for both actions.
- **Rationale:** Wave 3 (04-03) needs the field wired end-to-end before it can build the UI picker. Shipping it now avoids a 04-03 back-edit. Empty-string formData → `null` on the zod schema → empty string on the PB create payload = null relation in PB (Phase 2/5 established pattern).
- **Files modified:** `lib/actions/tasks.ts` (createTask + updateTask payload + raw-formData parsing).

---

**Total deviations:** 3 auto-fixed (Rule 1 × 2, Rule 3 × 1) + 1 Rule 2 plan-guided addition.
**Impact on plan:** All auto-fixes were correctness gates (batch-enable blocked the test suite; port collision blocked parallel tests; lint gate). No scope creep. Rule 2 is literal plan intent honored early.

## Issues Encountered

None beyond the deviations above. The `vi.mock` hoist + dynamic `import('@/lib/actions/invites')` pattern worked smoothly once `createServerClient` + `createAdminClient` were both mocked. The Next 16 async `searchParams` / `params` contract change from 15 was cleanly absorbed by the new route file.

## User Setup Required

**Phase 4.1 deploy REQUIRES the following env vars in `.env` before the invite flow works:**

- `PB_ADMIN_EMAIL` — email of a PocketBase superuser created via `./pocketbase superuser create <email> <password>` on first boot (s6-supervised PB persists the superuser across container restarts).
- `PB_ADMIN_PASSWORD` — that superuser's password.

If either is missing, `acceptInvite` will return `{ok:false, reason:'error'}` and the invite-landing page will show the generic "Something went wrong accepting this invite." card. Users never see the underlying error message (T-04-02-09 info-disclosure mitigation).

**Verification command after deploy:**
```bash
docker compose exec web sh -c 'printenv PB_ADMIN_EMAIL PB_ADMIN_PASSWORD | wc -c'
```
Expected: non-zero length on both lines.

**Also required:** `SITE_URL` should point at the public URL of the app (no trailing slash — though the invite-URL builder strips trailing slashes defensively). Without it, invite URLs are emitted as `/invite/TOKEN` (relative), which works for same-origin copy-paste but is confusing to share via messaging apps.

**Smoke test after deploy:**
```bash
# As an authed owner via browser:
#   1. Navigate to /h/<homeId>/settings (Wave 3 UI) — or invoke createInvite directly
#   2. Copy the invite URL.
#   3. Open in incognito. Redirects to /signup?next=/invite/TOKEN.
#   4. Sign up. Post-signup redirect lands on /invite/TOKEN.
#   5. acceptInvite runs server-side. Redirects to /h/<homeId>.
#   6. New user is a member — can see tasks, areas, can complete tasks.
```

## Next Phase Readiness

**Wave 3 (04-03) unblocked:** Can now import `createInvite`, `acceptInvite`, `revokeInvite` from `lib/actions/invites.ts`; `removeMember`, `leaveHome` from `lib/actions/members.ts`; `assertMembership`, `assertOwnership` from `lib/membership.ts`. Every member-permitted Phase 2/3 action now succeeds for any home member (not just owner) — the UI can show invite member / members list / leave-home controls and wire them to server actions without further DB-layer work. `createTask` + `updateTask` accept `assigned_to_id` from formData; Wave 3's TASK-02 picker just needs to populate the hidden input or form control.

**Known stubs:** None. Every new action path is exercised end-to-end by the integration test.

**Regressions to watch:** `bootstrap_batch.pb.js` must run on every PB container boot for `reorderAreas` and `acceptInvite` to work. If the hook file is accidentally excluded from the container build (04-01 Dockerfile already mounts `pocketbase/pb_hooks/` per 02-01), both features silently formError. A smoke-check for `settings.batch.enabled === true` after deploy would be a reasonable addition in Phase 4.1.

## Self-Check: PASSED

All 13 created + 8 modified files verified on disk via `git log` + `ls`:
- 7 lib/ modules FOUND
- 1 app route file FOUND
- 4 test files FOUND
- 1 PB hook FOUND
- 8 modified files (auth, signup-form, signup page, 4 actions, .env.example) FOUND

All 5 task commits verified in git log:
- `111e157` (Task 1 RED test) — FOUND
- `258e887` (Task 1 GREEN feat) — FOUND
- `1037de6` (Task 2 RED test) — FOUND
- `218c43b` (Task 2 GREEN feat) — FOUND
- `992d855` (Task 3 feat) — FOUND

Full test suite: 168/168 green (25 test files). Typecheck clean. Lint clean apart from pre-existing 02-05 task-form warning.

Grep gates:
- `assertMembership` appears in areas.ts (5), tasks.ts (5), completions.ts (3), homes.ts (2) — all 4 target files covered.
- `assertOwnership` appears in homes.ts (4), invites.ts (5), members.ts (3) — all 3 owner-gated files covered.
- `createAdminClient` in invites.ts (3) + pocketbase-admin.ts (1) — import + implementation.
- `randomBytes` in invite-tokens.ts (4 — import, JSDoc, body, related comment).
- `createBatch` in invites.ts (1) — acceptInvite's admin batch.

---

*Phase: 04-collaboration*
*Completed: 2026-04-21*
