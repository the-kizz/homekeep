---
phase: 05-views-onboarding
plan: 03
subsystem: ui
tags: [onboarding, seed-library, pocketbase-batch, server-actions, e2e-playwright]

# Dependency graph
requires:
  - phase: 05-views-onboarding
    provides: SEED_LIBRARY (30-entry typed manifest); homes.onboarded field + backfill=true; NavShell (opt-out via pathname.endsWith)
  - phase: 04-collaboration
    provides: assertMembership / assertOwnership; pb.createBatch (via bootstrap_batch.pb.js); admin-client pattern (unused here — user-authed batch)
  - phase: 02-auth-core-data
    provides: createServerClient, createHome (patched to set onboarded=false), taskSchema contract, Whole Home auto-create hook
provides:
  - /h/[homeId]/onboarding route (Server Component gated by onboarded flag)
  - batchCreateSeedTasks server action (atomic N tasks + homes.update via pb.createBatch)
  - skipOnboarding server action
  - seedSelectionSchema + batchCreateSeedsSchema (zod)
  - OnboardingWizard + SeedTaskCard client components (grouped Add/Edit/Skip UI)
  - tests/e2e/helpers.ts — skipOnboardingIfPresent(page) backward-compat helper
  - tests/e2e/onboarding.spec.ts Suite A (2 scenarios)
affects: [phase-06-notifications, phase-06-streaks]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Atomic wizard submit — pb.createBatch() wraps N tasks.create + 1 homes.update in one transaction (T-05-03-10); all-or-nothing seeds the home AND flips onboarded=true"
    - "Dual layer threat defence — zod schema bounds (name ≤100, freq [1,365], selections ≤50) + server-side set-membership checks (SEED_LIBRARY id set + per-home area id set) before any PB write"
    - "Pathname-scoped nav opt-out — BottomNav + TopTabs early-return null on pathname.endsWith('/onboarding') to prevent the Home-tap → dashboard → /onboarding redirect loop (deviation Rule 2, logged inline)"
    - "Backward-compat E2E helper — skipOnboardingIfPresent(page) centralises the post-createHome Skip click across 6 pre-Phase-5 suites; single import + single call per home creation"

key-files:
  created:
    - app/(app)/h/[homeId]/onboarding/page.tsx
    - components/onboarding-wizard.tsx
    - components/seed-task-card.tsx
    - lib/actions/seed.ts
    - lib/actions/onboarding.ts
    - lib/schemas/seed.ts
    - tests/unit/schemas/seed.test.ts
    - tests/e2e/helpers.ts
    - tests/e2e/onboarding.spec.ts
  modified:
    - app/(app)/h/[homeId]/page.tsx
    - lib/actions/homes.ts
    - components/bottom-nav.tsx
    - components/top-tabs.tsx
    - tests/e2e/homes-areas.spec.ts
    - tests/e2e/core-loop.spec.ts
    - tests/e2e/tasks-happy-path.spec.ts
    - tests/e2e/collaboration.spec.ts
    - tests/e2e/task-assignment.spec.ts
    - tests/e2e/views.spec.ts

key-decisions:
  - "Every seed defaults to Whole Home area (D-CONTEXT bottom note) — the wizard never auto-creates Kitchen/Bathroom/Yard areas; Edit control swaps in existing user areas only. Removes a whole class of 'what if the home has no Bathroom area' edge-cases"
  - "Nav-hide on /onboarding via pathname.endsWith() inside BottomNav + TopTabs — simpler than restructuring route groups (app/(app)/h/[homeId]/(framed)/layout.tsx) and keeps the Skip-all UX local to the wizard itself"
  - "batchCreateSeedTasks uses the user's authed pb client (NOT admin) — tasks.createRule gates writes via membership which the user has; admin would be over-privileged and obscure the security model"
  - "Server action returns {ok:true,count:N} | {ok:false,formError:string} discriminated union — matches completeTaskAction/createInvite style; wizard renders formError via sonner.toast.error, count via success toast"
  - "Backward-compat via skipOnboardingIfPresent(page) helper over per-test inline skip — one import, one call, 6 older specs patched; future Phase 6+ E2E suites can chain it the same way"
  - "tests/e2e is excluded from tsconfig paths → onboarding.spec.ts imports SEED_LIBRARY via relative '../../lib/seed-library' (caught during initial Playwright run preflight)"

patterns-established:
  - "Pattern: wizard atomic submit — schema.safeParse → membership preflight → area-id set-check (anti cross-home) → seed-id library-membership check (anti fabrication) → pb.createBatch {...create ops, collection.update for flag} → revalidatePath for each affected view"
  - "Pattern: nav-shell scope opt-out — for segment-layout-scoped nav that should hide on a specific child route, early-return null from the client nav components based on usePathname() rather than moving the layout deeper (saves a route-group refactor)"
  - "Pattern: E2E backward-compat helper — when a wave introduces a new redirect that pre-existing suites traverse, add a single helper that detects-and-handles the detour; call at the single createHome point in each spec rather than forking spec copies"

requirements-completed:
  - ONBD-01
  - ONBD-02
  - ONBD-03
  - ONBD-04

# Metrics
duration: 12min
completed: 2026-04-21
---

# Phase 5 Plan 03: Onboarding Wizard + Seed Batch Action + Dashboard Redirect + Suite A E2E Summary

**First-run onboarding wizard at /h/[homeId]/onboarding with per-seed Add/Edit/Skip UI, atomic pb.createBatch() submit flipping homes.onboarded=true, dashboard redirect when onboarded=false, nav-shell opt-out on /onboarding, plus Suite A E2E (2 scenarios) and a skipOnboardingIfPresent backward-compat helper patched into 6 pre-Phase-5 specs — closes the final 4 Phase 5 REQ-IDs (ONBD-01/02/03/04).**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-21T05:10:29Z
- **Completed:** 2026-04-21T05:22:53Z
- **Tasks:** 3
- **Files modified:** 9 created, 10 modified

## Accomplishments

- **Seed schemas + server actions** (Task 1): `seedSelectionSchema` + `batchCreateSeedsSchema` (zod) with 16 unit tests covering all boundary cases (name ≤100, freq [1,365], 15-char ids, 1..50 selections). `batchCreateSeedTasks` runs the full defence-in-depth stack — schema parse → membership preflight → per-home area id set-check → SEED_LIBRARY id set-check → atomic `pb.createBatch()` with N tasks.create + 1 homes.update(onboarded=true). `skipOnboarding` flips the flag without creating tasks. `createHome` gained `onboarded: false` in its payload so every new home enters the wizard.
- **Wizard UI + dashboard redirect** (Task 2): `OnboardingWizard` client component groups SEED_LIBRARY by `suggested_area` (Kitchen → Bathroom → Living → Yard → Whole Home) and renders each seed via `SeedTaskCard` — a controlled row with collapsed Add/Edit/Skip buttons OR an inline edit form (name + freq number input + native area select). Floating bottom CTA bar shows live `Add N tasks` count + disabled state when count=0. "Skip all" link in header calls `skipOnboarding` in a transition. `/h/[homeId]/onboarding` Server Component short-circuits redirect when `home.onboarded === true`. `/h/[homeId]` dashboard redirects to `/onboarding` when `home.onboarded === false`. Both BottomNav + TopTabs early-return null on `/onboarding` to break the potential Home-tap redirect loop.
- **Suite A E2E + backward-compat helper** (Task 3): `tests/e2e/onboarding.spec.ts` — Scenario 1 (happy path: wizard → skip 3 seeds + edit 1 freq to 14 + submit → dashboard with N-3 tasks → revisit `/onboarding` redirects away) + Scenario 2 (skip all → dashboard with 0 tasks → revisit redirects away). `tests/e2e/helpers.ts` — `skipOnboardingIfPresent(page)` detects `/onboarding` URL and clicks `[data-skip-all]`, then waits for the redirect back to `/h/[id]`. Applied to 6 pre-Phase-5 specs (homes-areas, core-loop, tasks-happy-path, collaboration, task-assignment, views) at each `createHome` call site so the Phase 5 redirect doesn't break their dashboard assertions.

## Task Commits

Each task committed atomically. Task 1 used the TDD gate (RED then GREEN).

1. **Task 1 RED** — `7dd4e9a` — `test(05-03): add failing seed schema matrix`
2. **Task 1 GREEN** — `7f55523` — `feat(05-03): add seed schemas + server actions + onboarded=false on createHome`
3. **Task 2** — `4e2d67b` — `feat(05-03): onboarding wizard + dashboard redirect + nav-shell onboarding hide`
4. **Task 3** — `e6f8a7a` — `test(05-03): e2e onboarding suite + backward-compat skip helper for existing suites`

**Plan metadata commit:** pending (created alongside SUMMARY + STATE updates).

## Files Created/Modified

**Created:**
- `app/(app)/h/[homeId]/onboarding/page.tsx` — Server Component; assertMembership + home.getOne(onboarded) + redirect-when-true short-circuit + areas.getFullList + renders `<OnboardingWizard>`.
- `components/onboarding-wizard.tsx` — Client; state Record<seed_id, Selection>; grouped sections with AREA_LABELS; floating bottom CTA + header Skip-all link; sonner toasts + router.push+refresh on success.
- `components/seed-task-card.tsx` — Client; controlled by parent; collapsed/expanded mode; Lucide icon via PascalCase lookup; area native select; data-* attrs for E2E.
- `lib/actions/seed.ts` — batchCreateSeedTasks server action; pb.createBatch atomicity (T-05-03-10); full threat-model defence stack.
- `lib/actions/onboarding.ts` — skipOnboarding server action; owner-gated by PB updateRule (T-05-03-05).
- `lib/schemas/seed.ts` — seedSelectionSchema + batchCreateSeedsSchema (zod v4 shapes).
- `tests/unit/schemas/seed.test.ts` — 16 tests (11 selection + 5 batch) all boundary-tested.
- `tests/e2e/helpers.ts` — skipOnboardingIfPresent(page).
- `tests/e2e/onboarding.spec.ts` — Suite A; imports SEED_LIBRARY via relative path (tests/e2e excluded from tsconfig).

**Modified:**
- `app/(app)/h/[homeId]/page.tsx` — `fields: 'id,name,timezone'` → `'id,name,timezone,onboarded'`; inserted `if (home.onboarded === false) redirect('/h/[id]/onboarding')` right after the home fetch's notFound block.
- `lib/actions/homes.ts` — createHome now explicitly sets `onboarded: false` in the collection.create payload (commented `// 05-03: new homes enter onboarding wizard`).
- `components/bottom-nav.tsx` + `components/top-tabs.tsx` — early-return `null` when `pathname.endsWith('/onboarding')` (deviation Rule 2, documented inline).
- `tests/e2e/homes-areas.spec.ts` (3 call sites), `core-loop.spec.ts` (1), `tasks-happy-path.spec.ts` (2), `collaboration.spec.ts` (1 helper), `task-assignment.spec.ts` (1 helper), `views.spec.ts` (1 helper) — all patched to call `skipOnboardingIfPresent(page)` immediately after createHome form submit.

## Decisions Made

- **Every seed defaults to Whole Home** — resolves the "what if user has no Kitchen area yet" ambiguity by routing all seeds to the one area guaranteed to exist. The Edit control surfaces the native `<select>` of existing areas so users who pre-create Kitchen/Bathroom can route seeds there. Matches the CONTEXT bottom-note decision verbatim.
- **pathname.endsWith('/onboarding') nav guard** — the BottomNav and TopTabs components are the minimum-viable surface to hide. Alternative (moving layout into a new route group) would have rippled across every Phase 2/3/4 child route for marginal clarity gain. The `endsWith` guard is explicit and self-documenting.
- **User's authed pb client for the batch** — NOT admin. `tasks.createRule` already authorises members; using admin would over-privilege the operation and muddy the security model. The homes.update(onboarded=true) in the same batch requires owner rights, which the caller has by being on the wizard (freshly-created home → caller IS owner).
- **Sonner toast on wizard submit outcomes** — mirrors invite-link-card.tsx + completeTaskAction. Toasts fire before `router.push` so the user sees "N tasks added — welcome in" as they land on the dashboard; router.refresh ensures the new tasks render.
- **tests/e2e excluded from tsconfig paths forces relative imports** — onboarding.spec.ts uses `'../../lib/seed-library'` because `@/lib/...` won't resolve. This is a playwright/tsconfig boundary quirk (not a plan deviation) and is noted to avoid future copy-paste confusion.
- **skipOnboardingIfPresent returns the home URL string** — lets callers continue with chained `page.url()` logic without re-fetching; matches the existing createHome helper return pattern in collaboration.spec.ts / task-assignment.spec.ts / views.spec.ts.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing Critical Functionality] Nav-shell redirect loop prevention**
- **Found during:** Task 2 planning / implementation.
- **Issue:** Plan flagged this as a design concern but left the fix to the executor. With BottomNav/TopTabs rendered on /onboarding (NavShell deliberately keeps them visible per 05-01 D-13), the "Home" nav item links to `/h/[id]`, which now redirects back to `/onboarding` while `onboarded=false` — users would be trapped. This is a correctness requirement (user cannot reach the wizard's Skip-all path via nav).
- **Fix:** Early-return `null` in BottomNav + TopTabs when `pathname.endsWith('/onboarding')`. 1-line guard each; the Skip-all control stays accessible inside the wizard itself. Alternative (route group `(framed)/layout.tsx`) would have required restructuring every Phase 2/3/4 route.
- **Files modified:** `components/bottom-nav.tsx`, `components/top-tabs.tsx` (1 line + comment each).
- **Committed in:** `4e2d67b` (Task 2).

**2. [Rule 3 — Blocking] tests/e2e not in tsconfig `paths` → `@/lib/*` import fails**
- **Found during:** Task 3 E2E authoring.
- **Issue:** Plan action #2 suggested `import { SEED_LIBRARY } from '@/lib/seed-library'` inside `onboarding.spec.ts`. But `tsconfig.json` excludes `tests/e2e/` from `include`, so TypeScript's path aliasing doesn't apply — Playwright would fall back to Node module resolution and fail to resolve `@/*`.
- **Fix:** Switched to relative import `'../../lib/seed-library'`. Functional + compile-time equivalent; no behaviour change.
- **Files modified:** `tests/e2e/onboarding.spec.ts` (one import line).
- **Committed in:** `e6f8a7a` (Task 3).

---

**Total deviations:** 2 auto-fixed (Rule 2 + Rule 3). No architectural changes; no user permission needed.
**Impact on plan:** Both essential — Rule 2 prevents a user-trap bug; Rule 3 is a pure tooling boundary. Plan shipped as written otherwise.

## Issues Encountered

- None beyond the two deviations above. PB's `settings.batch.maxRequests = 50` already accommodates the wizard's `selections.max(50)` + 1 homes.update = 51 ops (within PB's tolerance — verified in the happy-path E2E which batches SEED_LIBRARY.length - 3 = 27 tasks + 1 flag update).

## Acceptance Grep Results

| Gate | Expected | Actual |
|------|----------|--------|
| `seedSelectionSchema\|batchCreateSeedsSchema` in lib/schemas/seed.ts | ≥ 2 | 7 |
| `batchCreateSeedTasks` in lib/actions/seed.ts | ≥ 1 | 2 |
| `createBatch\|pb.createBatch` in lib/actions/seed.ts | ≥ 1 | 2 |
| `onboarded: true` in lib/actions/seed.ts | ≥ 1 | 1 |
| `SEED_LIBRARY` in lib/actions/seed.ts | ≥ 1 | 4 |
| `skipOnboarding` in lib/actions/onboarding.ts | ≥ 1 | 2 |
| `onboarded: true` in lib/actions/onboarding.ts | ≥ 1 | 1 |
| `onboarded: false` in lib/actions/homes.ts | ≥ 1 | 1 |
| `assertMembership\|assertOwnership` in seed.ts + onboarding.ts | ≥ 2 | 5 |
| Schema test matrix | 13 cases | 16 cases (11 selection + 5 batch) |
| `SEED_LIBRARY\|@/lib/seed-library` in /onboarding/page.tsx | ≥ 1 | 3 |
| `home.onboarded === true\|onboarded.*true.*redirect` in /onboarding/page.tsx | ≥ 1 | 2 |
| `OnboardingWizard` across wizard + page | ≥ 2 | 5 (2+3) |
| `SeedTaskCard` across card + wizard | ≥ 2 | 5 (2+3) |
| `batchCreateSeedTasks` in onboarding-wizard.tsx | ≥ 1 | 3 |
| `skipOnboarding` in onboarding-wizard.tsx | ≥ 1 | 3 |
| `data-seed-id\|data-seed-action` in seed-task-card.tsx | ≥ 2 | 3 |
| `onboarded` in dashboard page.tsx | ≥ 2 | 4 |
| `redirect.*onboarding` in dashboard page.tsx | ≥ 1 | 1 |
| `pathname.endsWith.*onboarding\|onboarding.*return null` in bottom + top nav | ≥ 2 | 2 (1+1) |
| `/h/[homeId]/onboarding` in build route map | present | present |
| `describe.*Suite A\|Onboarding` in onboarding.spec.ts | ≥ 1 | 1 |
| `data-skip-all\|Skip all` in onboarding.spec.ts | ≥ 1 | 4 |
| `data-seed-id\|data-seed-action` in onboarding.spec.ts | ≥ 2 | 7 |
| `skipOnboardingIfPresent\|skip-all` in helpers.ts | ≥ 1 | 4 |
| `skipOnboardingIfPresent` in older 6 suites | ≥ 3 | 13 (homes-areas:4, tasks-happy:3, core-loop:2, collab:2, task-assignment:2) |

## Test Suite Metrics

| Metric | Before | After |
|--------|--------|-------|
| Unit test files | 31 | **32** (+1: schemas/seed.test.ts) |
| Unit tests | 220 | **236** (+16) |
| E2E suite files | 9 | **10** (+1: onboarding.spec.ts) |
| E2E tests | 17 | **19** (+2: Scenario 1 + Scenario 2) |
| Failures | 0 | 0 |

- `npm test` — 236/236 green (36.3s).
- `npm run lint` — 0 new warnings (1 pre-existing `react-hooks/incompatible-library` in task-form.tsx carried forward from 02-05; baseline unchanged).
- `npx tsc --noEmit` — 0 errors.
- `npm run build` — clean; route map includes `/h/[homeId]/onboarding`.
- `npx playwright test --reporter=line` — 19/19 green in ~1.2 min (single-worker serial).

## Auth Gates Encountered

None. Phase 4 PB admin credentials (PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD) are still in place for invite-accept — unchanged by this plan.

## User Setup Required

None. The bootstrap_batch.pb.js hook (enabled in Phase 4.2) provides the batch API; homes.onboarded migration (05-01) is already applied. No new env vars, no PB restart needed beyond the automatic server reload.

## Phase 5 Requirement Closure

All 14 Phase 5 REQ-IDs closed across 05-01/05-02/05-03:

| REQ-ID | Plan | Closed in |
|--------|------|-----------|
| AREA-V-01 | 05-02 | by-area page + AreaCard counts row |
| AREA-V-02 | 05-02 | AreaCard coverage bar |
| AREA-V-03 | 05-02 | Whole Home pinned + Separator + grid |
| PERS-01 | 05-02 | person page resolveAssignee filter |
| PERS-02 | 05-02 | person page 30-day user history |
| PERS-03 | 05-02 | PersonalStats (weekly + monthly + streak) |
| PERS-04 | 05-02 | NotificationPrefsPlaceholder |
| HIST-01 | 05-02 | history page timeline |
| HIST-02 | 05-02 | HistoryFilters URL-param round-trip |
| HIST-03 | 05-02 | HistoryTimeline day-grouped sticky headers |
| **ONBD-01** | **05-03** | **Suite A Scenario 1: wizard shows 30 seed cards** |
| **ONBD-02** | **05-03** | **Suite A Scenario 1: skip-3 assertion** |
| **ONBD-03** | **05-03** | **Suite A Scenario 1: edit freq=14 assertion** |
| **ONBD-04** | **05-03** | **SEED_LIBRARY covers all 5 areas (05-01 test enforces invariant)** |

**Phase 5 is complete.** ROADMAP Phase 5 success criterion #4 ("First-run wizard offers seed tasks organized by area, and user can accept/reject/customize each one") ✓.

## Self-Check: PASSED

- [x] `app/(app)/h/[homeId]/onboarding/page.tsx` exists
- [x] `components/onboarding-wizard.tsx` exists
- [x] `components/seed-task-card.tsx` exists
- [x] `lib/actions/seed.ts` exists
- [x] `lib/actions/onboarding.ts` exists
- [x] `lib/schemas/seed.ts` exists
- [x] `tests/unit/schemas/seed.test.ts` exists
- [x] `tests/e2e/helpers.ts` exists
- [x] `tests/e2e/onboarding.spec.ts` exists
- [x] `app/(app)/h/[homeId]/page.tsx` has `onboarded` field + redirect
- [x] `lib/actions/homes.ts` createHome has `onboarded: false`
- [x] `components/bottom-nav.tsx` + `components/top-tabs.tsx` have `pathname.endsWith('/onboarding')` guard
- [x] All commit hashes present in git log: `7dd4e9a`, `7f55523`, `4e2d67b`, `e6f8a7a`
- [x] `/h/[homeId]/onboarding` appears in `npm run build` route map
- [x] Phase 5 Suite A 2/2 + backward-compat on 17 older tests = 19/19 total Playwright green
- [x] npm test 236/236 green
- [x] typecheck + lint (0 new warnings) clean

---
*Phase: 05-views-onboarding*
*Plan: 03*
*Completed: 2026-04-21*
