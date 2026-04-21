---
phase: 04-collaboration
plan: 01
subsystem: database
tags: [pocketbase, migration, jsvm, hooks, home_members, invites, api-rules, back-relation, backfill, integration-test, vitest]

# Dependency graph
requires:
  - phase: 02-auth-core-data
    provides: "homes / areas / tasks / users collections + owner-only rules + Whole Home hook pattern + disposable-PB integration test scaffolding"
  - phase: 03-core-loop
    provides: "completions collection with null updateRule/deleteRule + body-check createRule that Phase 4 rule-swap must preserve"
provides:
  - "home_members collection with (home_id, user_id, role, joined_at) — the multi-user gate"
  - "invites collection with unique token + 14-day expiry shape + owner-only rules (updateRule=null for admin-client acceptance path)"
  - "Rule-swap migration replacing owner-only with _via_ back-relation on homes/areas/tasks/completions"
  - "Owner-member auto-insert in the Whole Home hook (atomic with home + area insert)"
  - "Backfill of owner home_members rows for all Phase 2 / 2.1 deployed homes"
  - "Disposable-PB integration test pattern on port 18092 / 18093 (parallel-safe with 02-01 @ 18090 and 03-01 @ 18091)"
affects:
  - "04-02 (invites + members UI) — server actions can now assume PB rules are the source of truth; assertMembership helper will read from home_members"
  - "04-03 (cascading assignment) — lib/assignment.ts reads home_members to resolve effective assignee"
  - "All future phases (5+) that query tasks/areas/completions — rules now gate on membership, not owner_id"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PB 0.22+ back-relation filter: `@request.auth.home_members_via_user_id.home_id ?= <target>` with `?=` any-match"
    - "Migration-backfill-before-rule-swap ordering via timestamp prefix (..00 < ..02)"
    - "Hook consolidation for atomicity (single onRecordCreateExecute handles home + Whole Home + owner membership rather than chained hooks)"
    - "Node-level backfill fixture (tests/fixtures/backfill-loop.ts) mirroring JSVM migration body so unit tests can exercise the loop without booting PB"

key-files:
  created:
    - "pocketbase/pb_migrations/1714953600_home_members.js (124 lines) — home_members collection + owner backfill loop"
    - "pocketbase/pb_migrations/1714953601_invites.js (84 lines) — invites collection + token pattern + unique index"
    - "pocketbase/pb_migrations/1714953602_update_rules_multi_member.js (106 lines) — rule swap on homes/areas/tasks/completions"
    - "tests/unit/hooks-home-members.test.ts (216 lines) — live hook auto-insert + backfill fixture (2 tests)"
    - "tests/unit/rules-member-isolation.test.ts (162 lines) — non-member blocked + post-join unlock (1 test, 2 assertions)"
    - "tests/fixtures/backfill-loop.ts (62 lines) — JSVM-verbatim backfill body against mock-app interface"
  modified:
    - "pocketbase/pb_hooks/homes_whole_home.pb.js — extended with owner home_members auto-insert"

key-decisions:
  - "Chose primary `_via_` back-relation rule form over `@collection` fallback (Pattern 1 primary; A1 assumption accepted)"
  - "Consolidated owner-membership insert into the existing Whole Home hook rather than splitting to homes_owner_member.pb.js (avoids chained-hook e.next() ambiguity)"
  - "Backfill loop uses PB parameterised binding `{:hid}/{:uid}` (T-04-01-08 filter-injection mitigation)"
  - "Backfill-loop unit coverage via node-level fixture (tests/fixtures/backfill-loop.ts) rather than re-spawning PB with partial migrationsDir — simpler, lockstepped to migration body via comment contract"
  - "invites.updateRule=null (superuser only) because invitee is not yet a member at PATCH-time — acceptInvite will use PB admin client in Wave 2"

patterns-established:
  - "Backfill-before-rule-swap: any future migration that tightens rules must first seed the rows the new rule depends on, in a separate lower-timestamp migration"
  - "Fixture mirroring for JSVM bodies: when unit-testing goja-only code, co-locate a TS fixture that replicates the body verbatim with a documented 'drift is a bug' contract"
  - "Disposable-PB port assignment: 18090 (02-01), 18091 (03-01), 18092 (04-01 hook), 18093 (04-01 rules) — each test file owns a unique port to permit vitest parallelism"

requirements-completed: [HOME-07]

# Metrics
duration: 7min
completed: 2026-04-21
---

# Phase 4 Plan 01: home_members + invites migrations + rule swap Summary

**Three PB migrations swap homes/areas/tasks/completions from owner-only to membership-gated reads via `_via_` back-relation, backfill existing homes, and extend the Whole Home hook to atomically insert an owner home_members row on new home creation — unlocking multi-user access at the DB layer with no server-action preflight required.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-04-21T03:09:24Z
- **Completed:** 2026-04-21T03:16:52Z
- **Tasks:** 2
- **Files modified:** 7 (6 created, 1 extended)

## Accomplishments
- `home_members` collection with unique `(home_id, user_id)` index, `user_id` back-relation accelerant, owner-role backfill loop for all existing homes, and rules gating on membership for read + owner-of-home for write.
- `invites` collection with unique token index (base64url pattern enforced by TextField), 14-day expiry shape, owner-only rules for all CRUD except `updateRule=null` reserved for the Wave 2 admin-client acceptance path.
- Rule swap on `homes.list/view`, all of `areas`, all of `tasks`, and `completions.list/view/create` to use `@request.auth.home_members_via_user_id.home_id ?= <target>` (`?=` any-match). Owner-only retained on `homes.create/update/delete`, `areas.delete` (plus existing `is_whole_home_system = false` guard), and `completions.create` body-check preserved.
- Extended the existing `homes_whole_home.pb.js` hook with a 6-line block that inserts `{home_id, user_id: owner_id, role: 'owner'}` into `home_members` inside the same transaction as the home + Whole Home area — throw rolls back all three.
- Four integration assertions green: (1) live PB proves owner membership auto-inserted on home create, (2) fixture proves backfill loop inserts + is idempotent on re-run, (3) rules block non-member's filtered task list, (4) superuser-inserted membership unlocks the same request without re-auth (per-request rule evaluation proven).

## Task Commits

1. **Task 1: home_members + invites + rule-swap migrations** — `4ebed91` (feat)
2. **Task 2 (RED): failing integration tests** — `e8eff75` (test)
3. **Task 2 (GREEN): extend Whole Home hook with owner home_members auto-insert** — `b54dcb1` (feat)

**Plan metadata commit:** pending (this summary + STATE + ROADMAP + REQUIREMENTS).

## Files Created/Modified

**Created:**
- `pocketbase/pb_migrations/1714953600_home_members.js` — Collection + rules + fields + indexes + owner backfill loop.
- `pocketbase/pb_migrations/1714953601_invites.js` — Collection + token pattern + unique-token index + owner-only rules.
- `pocketbase/pb_migrations/1714953602_update_rules_multi_member.js` — Rule swap on homes/areas/tasks/completions with paired DOWN that restores Phase 2 / 3 owner-only rules verbatim.
- `tests/unit/hooks-home-members.test.ts` — Disposable PB on port 18092: two tests (live auto-insert + mock-app backfill).
- `tests/unit/rules-member-isolation.test.ts` — Disposable PB on port 18093: one test (non-member blocked; post-membership read unlocks).
- `tests/fixtures/backfill-loop.ts` — Node-level mirror of 1714953600's backfill body with typed `BackfillMockApp` interface.

**Modified:**
- `pocketbase/pb_hooks/homes_whole_home.pb.js` — Added 6-line `new Record(home_members, {...}) + e.app.save` block after the existing Whole Home area save; existing DEVIATION comment preserved.

## Decisions Made

- **Primary rule form `_via_` back-relation (A1):** Pattern 1 primary chosen over `@collection` fallback. Integration test `rules-member-isolation.test.ts` validates the assumption end-to-end — both test 1 (non-member blocked) and test 2 (post-join unlock) pass, proving `?=` with `home_members_via_user_id` evaluates correctly in PB 0.37.1.
- **Single hook, not two:** Keeping the owner-member insert in the same `onRecordCreateExecute` as the Whole Home area keeps atomicity obvious and avoids the chained-`e.next()` anti-pattern from Pattern 5's commentary.
- **Backfill-loop unit fixture over re-migration test harness:** The plan offered several options for testing the backfill; I shipped the mock-app fixture approach (`tests/fixtures/backfill-loop.ts`) because (a) it runs in milliseconds, (b) the fixture is a verbatim mirror of the migration body with an explicit "drift is a bug" contract, (c) the live auto-insert hook test already covers end-to-end PB behaviour. The live-backfill-on-boot path is covered by the operator during Phase 4 deploy (documented below).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Typecheck error on `backfill-loop.js` implicit-any import**
- **Found during:** Task 2 GREEN (lint + typecheck pass gate)
- **Issue:** `tests/fixtures/backfill-loop.js` imported from a `.ts` test file triggered TS7016 "Could not find a declaration file for module" under `tsc --noEmit`. The file had no sibling `.d.ts` and the project does not enable `allowJs`.
- **Fix:** Renamed to `backfill-loop.ts` and added a proper `BackfillMockApp` interface so callers get typed `findRecordsByFilter / findFirstRecordByFilter / save` signatures. Test file updated to import the new typed path and use the exported type for the mock factory's return annotation.
- **Files modified:** `tests/fixtures/backfill-loop.{js → ts}` (renamed), `tests/unit/hooks-home-members.test.ts` (import path + type annotation).
- **Verification:** `npm run typecheck` now green; `npm run lint` on new files clean; all 139 tests still pass.
- **Committed in:** `b54dcb1` (Task 2 GREEN commit).

**2. [Rule 1 - Bug] Lint warning on `_err` unused-catch-binding**
- **Found during:** Task 2 GREEN (lint gate)
- **Issue:** The initial `.js` fixture used `catch (_err)` which triggered `@typescript-eslint/no-unused-vars` because the ESLint override that relaxes `caughtErrors: 'none'` only covers `pocketbase/pb_migrations/**` and `pocketbase/pb_hooks/**`, not `tests/fixtures/**`.
- **Fix:** Converted the catch to an unnamed `catch` binding (`try { ... } catch { ... }`), eliminating the parameter entirely. Matches modern TS/ES2019+ optional-catch-binding syntax.
- **Files modified:** `tests/fixtures/backfill-loop.ts`.
- **Verification:** `npx eslint tests/fixtures/backfill-loop.ts` → no output (clean).
- **Committed in:** `b54dcb1` (same Task 2 GREEN commit).

### Plan-spec trivial variance (noted, no action)

**3. [Spec clarification, not a fix] `home_members_via_user_id` literal count is 5, plan's `<done>` said ≥6**
- **Found during:** Task 1 verify gate.
- **Issue:** The plan's done criteria expected the literal string `home_members_via_user_id` to appear ≥6 times in `1714953602_update_rules_multi_member.js`. Actual count is 5 (once per DRY `const memberRule = ...` / `const memberRuleViaTask = ...` + direct use in homes list/view = 2 + 1 + 1 + 1 = 5).
- **Rationale for no change:** The variance is because I used `const memberRule = '...'` / `const memberRuleViaTask = '...'` and reused the constants across 8 rule assignments — which matches RESEARCH.md Pattern 2's authoritative paste-ready form verbatim. The underlying behaviour (all 13 member-gated rule assignments apply the correct filter) is unchanged. Replacing the DRY constants with inline string literals to hit a ≥6 count would hurt readability without improving correctness.
- **Impact:** None — all member-gated rules present, all `?=` counts correct (6), all tests pass.

---

**Total deviations:** 2 auto-fixed (Rule 1 × 2) + 1 spec-count variance noted.
**Impact on plan:** Both auto-fixes were correctness requirements (typecheck + lint gates). No scope creep. Spec-count variance is cosmetic and preserves RESEARCH.md's canonical pattern.

## Issues Encountered

None beyond the deviations above. The RED state initially showed an unexpected failure mode on the hooks-home-members test (area list returned 0 items, not just the membership row assertion) — investigation confirmed this was exactly the Pitfall 1 scenario: the rule-swap migration was already applied, the hook wasn't yet extended, so Alice couldn't read her own areas. This validated that the rule swap was wired correctly; the GREEN hook fix cleared it. Documented here for future readers.

## User Setup Required

**Phase 4.1 deploy requires admin credentials to be provisioned before Wave 2 can land.** Wave 2's `acceptInvite` server action uses the PB admin client (Pattern 12) to update invite rows on behalf of the invitee, because the invitee is not yet a member at acceptance-time and no rule can authorise the write.

Required env vars (added to `.env` on the VPS / in local dev):

- `PB_ADMIN_EMAIL` — the email of a PocketBase superuser created via `./pocketbase superuser create <email> <password>`.
- `PB_ADMIN_PASSWORD` — that superuser's password.

**Verification command after deploy:**
```bash
docker compose exec web sh -c 'printenv PB_ADMIN_EMAIL PB_ADMIN_PASSWORD | wc -c'
```
Expected: non-zero length on both lines.

**Live-backfill deploy-readiness check (manual, not in CI):**
```bash
# On first boot after deploying Phase 4 migrations to the VPS:
curl -s "http://127.0.0.1:8090/api/collections/home_members/records?perPage=100" \
  -H "Authorization: Bearer $SUPERUSER_TOKEN" | jq '.totalItems'
```
Expected: equals the number of home rows (one owner row per home). If the count is short, the backfill did not run — check PB logs for the migration's apply output.

## Next Phase Readiness

**Wave 2 (04-02) unblocked:** Can now safely import `assertMembership(pb, homeId)` / `assertOwnership(pb, homeId)` from a new `lib/membership.ts` helper (to be created in 04-02 per Pattern 9). Server actions rely on PB rules as the source of ownership truth — the helper is defense-in-depth, not the primary gate.

**Wave 3 (04-03) unblocked:** `lib/assignment.ts` can read `home_members` to resolve effective assignee (Pattern 10) because both collections and their rules are landed.

**Known stubs:** None. Every collection, rule, and hook fires a real code path; the backfill loop runs on first boot against production-state data.

**Regressions to watch:** Future migrations that add collections referencing `home_id` must either (a) set up their own membership-backfill pattern or (b) accept that their rule can layer on top of `home_members_via_user_id`. The pattern is documented above.

## Self-Check: PASSED

All 8 claimed artefacts verified on disk:
- 3 migration files — FOUND
- 1 extended hook file — FOUND
- 2 integration test files — FOUND
- 1 fixture file — FOUND
- 1 summary (this file) — FOUND

All 3 claimed commits verified in git log:
- `4ebed91` (Task 1 feat) — FOUND
- `e8eff75` (Task 2 test RED) — FOUND
- `b54dcb1` (Task 2 feat GREEN) — FOUND

---
*Phase: 04-collaboration*
*Completed: 2026-04-21*
