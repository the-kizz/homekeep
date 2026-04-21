---
phase: 06-notifications-gamification
plan: 02
subsystem: notifications
tags:
  - scheduler
  - node-cron
  - instrumentation
  - server-actions
  - ntfy-hooks
  - idempotency
  - admin-debug-route

# Dependency graph
requires:
  - phase: 06-01
    provides: "sendNtfy, hasNotified/recordNotification, ref_cycle builders, computeWeeklySummary, detectAreaCelebration, notifications collection + unique index"
  - phase: 04-02
    provides: "createAdminClient pattern (admin-authed PB for bypassing rules)"
  - phase: 03-01
    provides: "getCompletionsForHome, reduceLatestByTask, CompletionRecord type"

provides:
  - "lib/scheduler.ts — start/stop/runOnce + processOverdueNotifications + processWeeklySummaries + sendAssignedNotification + sendPartnerCompletedNotifications"
  - "instrumentation.ts — Next.js 16 server-boot hook that starts the scheduler when NEXT_RUNTIME='nodejs' and DISABLE_SCHEDULER != 'true'"
  - "app/api/admin/run-scheduler/route.ts — POST endpoint gated by ADMIN_SCHEDULER_TOKEN (≥32 chars)"
  - "lib/schemas/notification-prefs.ts — zod notificationPrefsSchema + NotificationPrefs type"
  - "lib/actions/notification-prefs.ts — updateNotificationPrefsAction for Wave 3 Person-view form"
  - "CompleteResult.ok variant extended with optional celebration:{kind:'area-100',areaId,areaName}"
  - ".env.example NTFY_URL + DISABLE_SCHEDULER + ADMIN_SCHEDULER_TOKEN plumbing"
  - "Port 18097 claimed for scheduler integration test"

affects:
  - 06-03 (Wave 3 UI — consumes celebration flag in BandView + renders notification prefs form)

# Tech tracking
tech-stack:
  added:
    - "node-cron@3.0.3 (exact-pinned per 02-02 invariant)"
    - "@types/node-cron@3.0.11 (exact-pinned)"
  patterns:
    - "In-process cron with module-level started flag + idempotent start()/stop()"
    - "Pre-written notifications row regardless of ntfy POST success — idempotency drives next-tick dedupe (D-03 + D-05)"
    - "Dynamic-import of lib/scheduler from instrumentation.ts + server actions — keeps node-cron out of edge bundles"
    - "Assignee-change detection via getOne(taskId) BEFORE update to capture previous assigned_to_id"
    - "Before/after coverage snapshot via latestBefore Map overlay (avoids extra PB roundtrip)"

key-files:
  created:
    - "lib/scheduler.ts"
    - "instrumentation.ts"
    - "app/api/admin/run-scheduler/route.ts"
    - "lib/schemas/notification-prefs.ts"
    - "lib/actions/notification-prefs.ts"
    - "tests/unit/scheduler.test.ts"
    - "tests/unit/actions/notification-prefs.test.ts"
  modified:
    - "lib/actions/tasks.ts (updateTask)"
    - "lib/actions/completions.ts (completeTaskAction)"
    - ".env.example"
    - "README.md"
    - "package.json"
    - "package-lock.json"
    - "playwright.config.ts"

key-decisions:
  - "06-02: node-cron pinned to v3.0.3 to match @types/node-cron@3.0.11 (v4 API is breaking — async task.start/stop; types package still at v3 level)"
  - "06-02: scheduler integration test seeds a prior completion 5 days ago rather than fighting PB's server-controlled `created` AutoDate field — cycle-mode next_due = completion + freq is naturally overdue, which is the 'real' overdue pattern for v1 homes"
  - "06-02: admin-client fetchHomeMembers drops the `fields` whitelist and relies on default expand payload — the whitelist syntax `expand.user_id.*` dropped the expanded payload silently (debug revealed empty member records); default expand returns the full user row which the mapper then narrows"
  - "06-02: celebration computation reuses the tasksInArea getFullList + getCompletionsForHome fetch pair, building latestAfter via Map overlay — saves a second roundtrip while keeping the pure-fn contract intact"
  - "06-02: E2E env gains DISABLE_SCHEDULER=true to silence the hourly cron start logs during `npm run test:e2e` (synchronous hooks still run but test users have empty topics → zero outbound ntfy)"
  - "06-02: Disposable-PB port 18097 claimed; allocation log now 18090..18097"
  - "06-02: admin-trigger route fail-closed when ADMIN_SCHEDULER_TOKEN unset OR length < 32 (401 returned for both conditions identically to avoid signal leakage)"

patterns-established:
  - "Notification fan-out per home: iterate homes → members → tasks → (eligible members × overdue tasks). Cron runs hourly UTC; weekly summary self-filters on per-home timezone + member's weekly_summary_day"
  - "Server-action hook pattern: fetch admin client + dynamic-import scheduler helper + try/catch to never block on ntfy failure"
  - "CompleteResult optional field extension: adding `celebration?:` to the ok variant leaves existing `if (result.ok)` narrows valid — non-breaking change"

requirements-completed:
  - NOTF-01
  - NOTF-02
  - NOTF-03
  - NOTF-04
  - NOTF-05
  - NOTF-06
  - NOTF-07

# Metrics
duration: 18min
completed: 2026-04-21
---

# Phase 6 Plan 2: Notifications Scheduler + Sync Hooks Summary

**In-process node-cron scheduler (hourly overdue + Sunday-09:00-local weekly summary) + instrumentation.ts boot hook + admin-trigger route + synchronous ntfy fires in updateTask/completeTask + updateNotificationPrefs server action — the complete Phase 6 notification engine wired to the Wave 1 primitives.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-04-21T06:00:00Z
- **Completed:** 2026-04-21T06:18:13Z
- **Tasks:** 2 (both TDD)
- **Files created:** 7 (lib/scheduler.ts, instrumentation.ts, run-scheduler route, 2 notification-prefs modules, 2 test files)
- **Files modified:** 7 (2 actions, .env.example, README.md, package.json, package-lock.json, playwright.config.ts)

## Accomplishments

- **node-cron scheduler** module with 5 exports: `start` / `stop` (idempotent lifecycle), `runOnce` (admin-trigger + E2E entry), and 4 pass functions (`processOverdueNotifications`, `processWeeklySummaries`, `sendAssignedNotification`, `sendPartnerCompletedNotifications`). Hourly `0 * * * *` UTC cron; weekly job self-gates on per-home timezone + member's weekly_summary_day so it only fires at 09:00 local on Sunday/Monday.
- **Next.js 16 `instrumentation.ts`** at project root — triple-guarded (`NEXT_RUNTIME === 'nodejs'`, `DISABLE_SCHEDULER !== 'true'`, dynamic-import of scheduler) so node-cron never loads into the edge bundle and tests/CI can silence the cron entirely.
- **Manual trigger route** `POST /api/admin/run-scheduler` with `x-admin-token` header auth against `ADMIN_SCHEDULER_TOKEN` (≥32 chars, fail-closed); body `{kind:'overdue'|'weekly'|'both'}` optional. Used by ops + Wave 3 E2E.
- **Synchronous ntfy hooks** wired into:
  - `updateTaskAction` — captures previous `assigned_to_id` via `pb.collection('tasks').getOne()` BEFORE update, fires `sendAssignedNotification` via admin client when the new assignee is a different non-null user. `try/catch` so ntfy failure never blocks the response (D-03).
  - `completeTaskAction` — before/after area-coverage snapshot via `latestBefore` Map + overlay to build `latestAfter`, calls `detectAreaCelebration`, fetches area.name only when crossover fires, returns `celebration: {kind:'area-100', areaId, areaName}` in the action response. Also fires `sendPartnerCompletedNotifications` to OTHER home members who opted in (completer filtered out explicitly).
- **`updateNotificationPrefsAction`** — zod-validated via `notificationPrefsSchema`, writes the 6 fields (`ntfy_topic`, 4 boolean toggles, `weekly_summary_day`) back to `users` via the existing self-update rule; normalises boolean checkbox serialisations ('on' / 'true' / '1') for shadcn+RHF compatibility.
- **Integration test** on port 18097 proves 4 contract cases: (A) single overdue task fires exactly 1 ntfy + writes 1 notifications row, (B) second run is fully idempotent (0 POSTs, row count unchanged), (C) `notify_overdue=false` opt-out respected, (D) member with empty `ntfy_topic` silently skipped.
- **Zod schema matrix** — 8 unit cases for `notificationPrefsSchema` (valid payload, short/too-long/slash/percent-encoded topics all rejected, empty topic allowed, `weekly_summary_day` enum, missing boolean rejected).
- **env plumbing** — `.env.example` now documents `NTFY_URL`, `DISABLE_SCHEDULER`, `ADMIN_SCHEDULER_TOKEN` with inline guidance + a `curl` smoke-test pointer.
- **README Notifications section** — 6-line "how to set up ntfy" walk-through inserted before the License section (idempotent; replaces any prior stub).
- **Test count growth:** 281 → 293 (+12 — 4 scheduler + 8 notification-prefs schema). 0 regressions.

## Task Commits

Each task used full RED → GREEN TDD gating:

1. **Task 1 RED: failing scheduler integration test + node-cron install** — `7e58c3c` (test)
2. **Task 1 GREEN: scheduler module + instrumentation + admin route + env + README** — `89ea95b` (feat)
3. **Task 2 RED: failing notification-prefs zod tests** — `932c188` (test)
4. **Task 2 GREEN: schema + action + updateTask/completeTask hooks + celebration return** — `bdb2fae` (feat)

## Files Created/Modified

**Created:**

- `lib/scheduler.ts` — 5 scheduler exports; hourly overdue + Sunday-09:00-local weekly passes; admin-client sourced for home/task iteration
- `instrumentation.ts` — Next 16 register hook with runtime + DISABLE_SCHEDULER guards
- `app/api/admin/run-scheduler/route.ts` — POST token-gated manual trigger
- `lib/schemas/notification-prefs.ts` — zod schema + NotificationPrefs type
- `lib/actions/notification-prefs.ts` — updateNotificationPrefsAction
- `tests/unit/scheduler.test.ts` — 4-scenario integration test on port 18097
- `tests/unit/actions/notification-prefs.test.ts` — 8 zod unit cases

**Modified:**

- `lib/actions/tasks.ts` (updateTask) — capture previousAssignedToId + fire sendAssignedNotification on change
- `lib/actions/completions.ts` (completeTaskAction) — before/after area snapshot → celebration; sendPartnerCompletedNotifications fire; CompleteResult.ok extended with optional celebration
- `.env.example` — Phase 6 env block (NTFY_URL, DISABLE_SCHEDULER, ADMIN_SCHEDULER_TOKEN)
- `README.md` — "Notifications (Phase 6)" section before License
- `package.json` + `package-lock.json` — node-cron@3.0.3 + @types/node-cron@3.0.11 exact-pinned
- `playwright.config.ts` — DISABLE_SCHEDULER=true injected into the E2E Next.js server env

## Decisions Made

- **Pinned to node-cron v3 (not v4):** v4 introduces a breaking async API (`task.start()` returns Promise, adds `destroy()`, etc.) but `@types/node-cron` is still at v3 level (3.0.11). Aligning with the types package avoids hand-rolling declarations. Revisit in Phase 7 if ops demands the v4 observability features.
- **Test fixture uses cycle + past-completion not anchored + past-anchor:** the plan's spec suggested "task whose nextDue < now" but `computeNextDue` for anchored mode always steps PAST `now` by construction (`floor(elapsed/freq)+1 cycles` is the invariant that makes the dashboard display DST-safe). A cycle-mode task with a seeded `completed_at` 5 days ago is the shortest path to a past `nextDue`, and it matches the real overdue-scenario shape for an active household.
- **fetchHomeMembers drops the `fields` whitelist:** the PB `fields: 'id,role,user_id,expand.user_id.ntfy_topic,...'` syntax I tried first silently dropped the expanded sub-fields (debug showed empty `expand.user_id` objects). Switching to `expand: 'user_id'` alone returns the full expanded record which the mapper then narrows to `MemberLite`. Small over-fetch, zero correctness risk.
- **Celebration detection via Map overlay, not a second PB query:** `latestAfter = new Map(latestBefore); latestAfter.set(taskId, afterCompletion)` produces the post-write state without re-fetching completions. detectAreaCelebration's pure-fn contract doesn't care whether the map came from DB or an overlay.
- **Disabled scheduler in E2E env:** synchronous hooks still fire from the actions, but test users have empty ntfy_topic so zero outbound POSTs — the env flag just quiets the `[scheduler] started` log noise and avoids any risk of a real hourly tick during a long-running test.
- **Admin-route fail-closed on token-length check:** 401 is returned identically for "token unset" and "token too short" — same response shape avoids giving an attacker a signal about which condition failed.

## Deviations from Plan

Only minor adjustments — no Rule 4 architectural decisions needed. All were Rule 1/2/3 auto-fixes inside the task:

### Auto-fixed Issues

**1. [Rule 1 - Bug] Scheduler integration test used anchored mode with past anchor**
- **Found during:** Task 1 first green-pass
- **Issue:** `computeNextDue` in anchored mode advances `cycles = floor(elapsed/freq)+1` past `now`, so a task anchored 2 days ago with 1-day frequency has `nextDue = tomorrow` and is NOT flagged overdue by the scheduler's `nextDue > now skip` guard. Initial test set up 0 ntfys sent (expected 1).
- **Fix:** Switched test seeding to cycle mode + `completions.create({completed_at: fiveDaysAgo})`. PB's `completions.completed_at` is a regular DateField (not AutoDate), so past values are settable. Cycle-mode next_due = completion + freq = 4 days ago → naturally overdue.
- **Files modified:** `tests/unit/scheduler.test.ts` (all 3 task seeds — T1, T2, T3)
- **Commit:** `89ea95b`

**2. [Rule 1 - Bug] fetchHomeMembers field-whitelist dropped expand payload**
- **Found during:** Task 1 first green-pass (same run as #1)
- **Issue:** The plan spec suggested `fields: 'id,role,user_id,expand.user_id.id,expand.user_id.ntfy_topic,...'`. PB's field-filter applied that literally and returned `expand.user_id = {}` — empty. Members dropped to 0 eligible → 0 ntfys sent.
- **Fix:** Simplified the call to `getFullList({ filter, expand: 'user_id' })` — the full expanded user record comes back and the mapper narrows to `MemberLite`.
- **Files modified:** `lib/scheduler.ts`
- **Commit:** `89ea95b`

**3. [Rule 3 - Blocking] `@ts-expect-error` directive didn't trigger**
- **Found during:** Task 2 typecheck after GREEN
- **Issue:** `weekly_summary_day: 'tuesday'` in the test passed as a plain string (no error to suppress). `tsc --noEmit` flagged TS2578 "unused directive".
- **Fix:** Replaced the directive with an explicit cast `'tuesday' as 'sunday' | 'monday'`. Same runtime behaviour; typecheck clean.
- **Files modified:** `tests/unit/actions/notification-prefs.test.ts`
- **Commit:** `bdb2fae`

**4. [Rule 2 - Critical] DISABLE_SCHEDULER not set for E2E**
- **Found during:** Task 2 review of playwright.config.ts
- **Issue:** E2E spins up Next.js with real PB_ADMIN creds, so `instrumentation.register()` would unconditionally start the cron. Hourly tick wouldn't fire during E2E (tests run <5 min), but the startup log line adds noise and there's a theoretical risk of spawning a cron during a slow CI run.
- **Fix:** Added `DISABLE_SCHEDULER: 'true'` to the webServer env in `playwright.config.ts`. Synchronous action hooks still fire — E2E users have empty ntfy_topic so zero POSTs land on ntfy.sh.
- **Files modified:** `playwright.config.ts`
- **Commit:** `bdb2fae`

## Issues Encountered

- **PB AutoDate `created` is server-controlled**: attempted to set `created: twoDaysAgo` on task create; PB silently ignored. Resolved by switching to the past-completion seeding pattern (see Deviation #1).
- **PB `fields` + `expand` interaction**: the `expand.user_id.<field>` syntax did not work as documented for `getFullList`. Simpler `expand: 'user_id'` (no fields filter) worked correctly. Logged as Decision above for Phase 7 codebase-wide review.

## Authentication Gates

None — no external services touched. `NTFY_URL` defaults to public ntfy.sh in env plumbing; the integration test intercepts `globalThis.fetch` so no real ntfy.sh calls fire. Admin-trigger route uses static pre-shared token (not an OAuth flow).

## TDD Gate Compliance

Both tasks executed the full RED → GREEN cycle:

- **Task 1:**
  - RED: `7e58c3c test(06-02): add failing scheduler integration test` — 4/4 tests fail with `Cannot find package '@/lib/scheduler'`.
  - GREEN: `89ea95b feat(06-02): add scheduler module + instrumentation + admin route` — 4/4 tests pass; full suite 285/285.

- **Task 2:**
  - RED: `932c188 test(06-02): add failing notification-prefs schema test` — 8/8 tests fail via vite resolution error on the missing schema module.
  - GREEN: `bdb2fae feat(06-02): wire sync ntfy hooks + updateNotificationPrefs` — 8/8 zod tests pass; full suite 293/293; typecheck clean; build green with `/api/admin/run-scheduler` in the route manifest.

No REFACTOR commits were needed — each GREEN landed clean.

## User Setup Required

For live deployment:

1. **Set `NTFY_URL`** — defaults to `https://ntfy.sh` (public) if unset. Self-hosted ntfy: `NTFY_URL=https://ntfy.your-domain.com`.
2. **Generate `ADMIN_SCHEDULER_TOKEN`** — at least 32 URL-safe chars, e.g.
   ```bash
   openssl rand -hex 24
   ```
   Paste into `.env`. Token is REQUIRED for the manual-trigger route; route returns 401 identically for "unset" and "too-short" conditions.
3. **Verify `PB_ADMIN_EMAIL` + `PB_ADMIN_PASSWORD`** are set (scheduler uses the same admin client the Phase 4 acceptInvite flow depends on; same credentials).
4. **Leave `DISABLE_SCHEDULER` unset** in production; the in-process cron starts on Next.js boot.

Manual verification checklist:

- [ ] Sign in, open `/h/<home>/person`, paste ntfy topic, save. (Wave 3 ships the form.)
- [ ] Subscribe to the topic in the ntfy mobile/web app.
- [ ] Create or locate an overdue task.
- [ ] `curl -X POST -H "x-admin-token: $ADMIN_SCHEDULER_TOKEN" https://your-host/api/admin/run-scheduler` — expect `{"ok":true,"result":{"overdueSent":N,...}}`.
- [ ] Subscriber app shows the push within seconds.
- [ ] Re-run the curl; `overdueSent=0` confirms idempotency.

## Threat Model Adherence

All `mitigate` dispositions in the plan's `<threat_model>` are implemented:

- **T-06-02-01** (elevation via admin client): scheduler's `createAdminClient()` reads `PB_ADMIN_EMAIL`/`PB_ADMIN_PASSWORD` from env only. Never exposed to client. Module dynamic-imported from server-only entry points (instrumentation, server actions, admin route).
- **T-06-02-02** (updateTask assigned-notification spoofing): `previousAssignedToId` captured via `pb.collection('tasks').getOne(taskId)` which enforces the tasks.viewRule. Assignee id validated by PB's relation-field rule before the update commits; client cannot forge.
- **T-06-02-05** (admin route token bypass): route returns 401 when `ADMIN_SCHEDULER_TOKEN` unset OR length < 32 OR header mismatch. Fail-closed verified inline.
- **T-06-02-06** (token leak via logs): route handler never logs `req.headers` or `process.env.ADMIN_SCHEDULER_TOKEN`. `console.error` on runOnce failure logs only the exception object (scheduler-internal, never the inbound token).
- **T-06-02-07** (celebration flag spoofing): `celebration` is server-computed inside `completeTaskAction` via `detectAreaCelebration` — client cannot set it via formData.
- **T-06-02-08** (synchronous ntfy latency): `sendNtfy` inherits the 5s AbortController timeout from Wave 1. `sendPartnerCompletedNotifications` awaits each recipient serially but for a typical household (≤4 members), the worst case is ~20s — acceptable for v1; Phase 7 can background-queue if metrics show a problem.
- **T-06-02-09** (notifications deletion): inherited from Wave 1 — `notifications.deleteRule = null`, superuser-only.

`accept`-disposition threats (T-06-02-03 task name in push bodies, T-06-02-04 unbounded home iteration at scale) remain as documented — single-container v1, household scale.

## Next Phase Readiness

**Wave 3 (plan 06-03) consumes from this plan:**

- **`updateNotificationPrefsAction`** — bind to a react-hook-form + zodResolver form in `app/(app)/h/[homeId]/person/...`. Plan 05-02 left the Notifications section stubbed; Wave 3 replaces the stub with the real form using this action.
- **`notificationPrefsSchema`** — client-side validation via zodResolver; server-side validation already in place.
- **`CompleteResult.celebration`** — when `result.ok && result.celebration?.kind === 'area-100'`, the client handler in BandView (or the shared optimistic-update wrapper) should trigger a confetti/slide-in animation keyed on `result.celebration.areaName`. Optional + non-breaking: existing callers are unchanged.
- **`POST /api/admin/run-scheduler`** — Wave 3 E2E for notifications should `fetch(...)` this with the token to deterministically fire the scheduler after seeding an overdue task.

**Blockers for Wave 3:**

- None. All backend surfaces for NOTF-01..07 are delivered; Wave 3 is a pure-UI plan.

## Self-Check: PASSED

Verified (via `test -f` and `git log`):

- FOUND: `lib/scheduler.ts` (exports `start`, `stop`, `runOnce`, `processOverdueNotifications`, `processWeeklySummaries`, `sendAssignedNotification`, `sendPartnerCompletedNotifications`)
- FOUND: `instrumentation.ts` (exports `register`; contains `NEXT_RUNTIME` + `import('./lib/scheduler')`)
- FOUND: `app/api/admin/run-scheduler/route.ts` (contains `ADMIN_SCHEDULER_TOKEN`, `runtime = 'nodejs'`, POST export)
- FOUND: `lib/schemas/notification-prefs.ts` (exports `notificationPrefsSchema`)
- FOUND: `lib/actions/notification-prefs.ts` (exports `updateNotificationPrefsAction`)
- FOUND: `tests/unit/scheduler.test.ts` (references port `18097`, covers 4 scenarios)
- FOUND: `tests/unit/actions/notification-prefs.test.ts` (8 zod cases)
- FOUND: `.env.example` contains `NTFY_URL=`, `DISABLE_SCHEDULER=`, `ADMIN_SCHEDULER_TOKEN=` (all present)
- FOUND: `package.json` has `"node-cron": "3.0.3"` (no caret) and `"@types/node-cron": "3.0.11"` (no caret)
- FOUND: commits `7e58c3c`, `89ea95b`, `932c188`, `bdb2fae` in git log
- FOUND: lib/actions/tasks.ts contains `previousAssignedToId`, `sendAssignedNotification`, `newAssignedToId !== previousAssignedToId`
- FOUND: lib/actions/completions.ts contains `detectAreaCelebration`, `tasksInArea`, `sendPartnerCompletedNotifications`, `celebration`
- FULL SUITE: 293/293 vitest passing; typecheck clean; `npm run build` green with `/api/admin/run-scheduler` in route manifest.

---

*Phase: 06-notifications-gamification*
*Plan: 02*
*Completed: 2026-04-21*
