# Roadmap: HomeKeep

## Overview

HomeKeep delivers a self-hosted household maintenance PWA in 7 phases, starting with Docker infrastructure, building single-user task management, adding the differentiating three-band UI, enabling household collaboration, layering secondary views and onboarding, adding notifications and gamification, and finishing with PWA polish and release tooling. Each phase delivers a coherent, verifiable capability that builds on the previous.

**v1.1 (Scheduling & Flexibility)** extends the v1.0 foundation with one-off tasks, preferred-weekday constraints, seasonal dormancy, manual reschedule via action sheet, first-run seed-stagger, and a documentation refresh — all via additive, backward-compatible migrations.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)
- Phases 8 and 9 are post-v1.0.0-rc1 UX polish passes (retroactively logged after-the-fact)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Scaffold & Infrastructure** - Docker container with Next.js + PocketBase running, dev environment, compose files, health endpoint (completed 2026-04-20)
- [x] **Phase 2: Auth & Core Data** - Single user can sign up, create homes/areas/tasks, and manage their data (completed 2026-04-21)
- [x] **Phase 2.1: Deploy Checkpoint** (INSERTED) - Build local image + docker compose up on VPS port 3000 for live preview at http://46.62.151.57:3000/ (completed 2026-04-21)
- [x] **Phase 3: Core Loop** - Three-band main view with task completion, coverage ring, and early-completion guard (completed 2026-04-21)
- [x] **Phase 4: Collaboration** - Share homes via invite links, manage members, cascading task assignment (completed 2026-04-21)
- [x] **Phase 5: Views & Onboarding** - By Area, Person, and History views plus seed task library wizard (completed 2026-04-21)
- [x] **Phase 6: Notifications & Gamification** - ntfy push notifications, scheduler, streaks, and celebrations (completed 2026-04-21)
- [x] **Phase 7: PWA & Release** - PWA manifest, HTTPS compose variants, graceful degradation, CI/CD publish (completed 2026-04-21)
- [x] **Phase 8: UX Polish** - Lora display serif, typography hierarchy, horizon scannability, canary provenance markers, fresh screenshots (completed 2026-04-21)
- [x] **Phase 9: UX Audit Fix** - Warm-only palette tightening, accessibility fixes, button hierarchy, avatar/streak visual separation (completed 2026-04-21)

## v1.1: Scheduling & Flexibility

v1.1 extends v1.0 with finer scheduling control. All migrations are additive; v1.0.0 installs upgrading via `:1` or `:latest` lose nothing. The milestone ends by cutting `v1.1.0-rc1` per the GHCR tiered tag strategy.

- [ ] **Phase 10: Schedule Override Foundation** - `schedule_overrides` PB collection + `computeNextDue` signature extension threaded through every caller (coverage, scheduler, horizon, band classification)
- [ ] **Phase 11: Task Model Extensions** - Nullable `frequency_days`, `preferred_days`, `active_from_month`/`active_to_month`, `completions.via='seed-stagger'` enum value, and all scheduler logic for one-off / preferred-days / seasonal behaviors
- [ ] **Phase 12: Seasonal UI & Seed Library** - Task form "Active months" section, dimmed + "Sleeps until" rendering in By Area / Person / dashboard, anchored-mode warning, seasonal seed pairs
- [ ] **Phase 13: One-Off & Reschedule UI** - Task form one-off toggle, Reschedule action sheet with date picker and "Just this time" / "From now on" radio, ExtendWindowDialog for cross-window snoozes
- [ ] **Phase 14: Seed-Stagger & History/Stats Filters** - `batchCreateSeedTasks` writes synthetic `via='seed-stagger'` completions with cohort-distribution + season-aware offsets; History, personal stats, and notifications skip those rows
- [ ] **Phase 15: SPEC v0.3, AGPL Drift Fix & v1.1 Changelog** - SPEC.md bump, three MIT→AGPL corrections, full v1.1 changelog, PROJECT.md INFR-12 correction

## Phase Details

### Phase 1: Scaffold & Infrastructure
**Goal**: A working Docker container runs both Next.js and PocketBase, with a functional dev environment and deployment scaffolding
**Depends on**: Nothing (first phase)
**Requirements**: INFR-01, INFR-02, INFR-03, INFR-04, INFR-05, INFR-06, INFR-10, INFR-11, INFR-12
**Success Criteria** (what must be TRUE):
  1. Running `docker compose up` starts the app and both Next.js and PocketBase respond to requests
  2. The `/api/health` endpoint returns a success response confirming both services are alive
  3. All persistent data lives in a single `./data` volume that survives container restarts
  4. The image builds successfully for both amd64 and arm64 architectures
  5. A `.env.example` file documents all configuration, and no secrets are hardcoded
**Plans**: 7 plans

Plans:
- [x] 01-01-PLAN.md — Next.js 16 + TS + Tailwind 4 + Vitest + Playwright scaffold with health route, PB client factory, LICENSE, .env.example
- [x] 01-02-PLAN.md — Multi-stage Dockerfile with s6-overlay + Caddy + PocketBase, .dockerignore, image-size and multi-arch helper scripts
- [x] 01-03-PLAN.md — s6-overlay v3 service tree (caddy, pocketbase, nextjs longruns) with user-bundle registration
- [x] 01-04-PLAN.md — Caddyfile with path-ordered routing (/api/health -> Next.js, /api/* and /_/* -> PocketBase with SSE-safe flush_interval)
- [x] 01-05-PLAN.md — docker-compose.yml (LAN variant) + scripts/dev-pb.js for native dev workflow
- [x] 01-06-PLAN.md — GitHub Actions ci.yml (lint/test/build/e2e + image-size + NEXT_PUBLIC_ guard) and release.yml (multi-arch GHCR push on v* tag)
- [x] 01-07-PLAN.md — Public-polish README.md covering quickstart, first-boot PB setup, dev workflow, caveats, MIT license

### Phase 2: Auth & Core Data
**Goal**: A single user can create an account, manage homes with areas, and define tasks with frequencies and schedule modes
**Depends on**: Phase 1
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, HOME-01, HOME-02, HOME-03, HOME-04, AREA-01, AREA-02, AREA-03, AREA-04, AREA-05, TASK-01, TASK-05, TASK-06, TASK-07, TASK-08
**Success Criteria** (what must be TRUE):
  1. User can sign up, log in, and stay logged in across browser refreshes
  2. User can create a home and see a "Whole Home" area auto-created within it
  3. User can create, edit, and reorder areas with names, icons, and colors
  4. User can create tasks with name, frequency, area, schedule mode, and see computed next-due dates
  5. User can switch between multiple homes and lands on last-viewed home by default
**Plans**: 5 plans
**UI hint**: yes

Plans:
- [x] 02-01-PLAN.md — PocketBase migration (homes/areas/tasks + users.last_viewed_home_id) + pb_hooks (Whole Home auto-create, SMTP bootstrap, rate limits) + dev-pb.js --hooksDir + Whole Home integration test
- [x] 02-02-PLAN.md — shadcn/ui init + Tailwind 4 warm-accent theme + SSR cookie bridge (lib/pocketbase-server.ts + lib/pocketbase-browser.ts) + new-deps install (react-hook-form, @dnd-kit, date-fns-tz, sonner, lucide-react)
- [x] 02-03-PLAN.md — Auth pages + server actions + proxy.ts (Next 16) + zod schemas + account menu + Playwright auth happy-path E2E
- [x] 02-04-PLAN.md — Homes + Areas CRUD (HomeSwitcher, SortableAreaList, IconPicker, ColorPicker, area palette) + last-viewed persistence + Whole Home delete guard E2E
- [x] 02-05-PLAN.md — Tasks CRUD + computeNextDue pure function (13-case matrix) + TaskForm (cycle/anchored, freq quick-select) + NextDueDisplay (date-fns-tz) + D-21 full happy-path E2E

### Phase 2.1: Deploy Checkpoint (INSERTED)
**Goal**: Build the current HomeKeep image locally and deploy via docker compose on VPS port 80 so the user can hit http://46.62.151.57/ and see the live Phase 2 state.
**Depends on**: Phase 2
**Requirements**: (no new REQ-IDs — deploy infra only)
**Success Criteria** (what must be TRUE):
  1. `docker buildx build --platform linux/amd64 --load -t homekeep:phase-2 -t homekeep:latest .` succeeds
  2. `docker compose up -d` (via the dev override) serves the app on VPS port 80
  3. `curl http://46.62.151.57/api/health` returns `{"status":"ok","nextjs":"ok","pocketbase":"ok"}` from the open internet
  4. `./data` is bind-mounted and survives container restart (HOME records persist)
  5. README documents the "one-line refresh" command for the user to redeploy after any `git pull`
**Plans**: TBD

Plans:
- [ ] 02.1-01: TBD

### Phase 3: Core Loop
**Goal**: Users experience the differentiating three-band task view, can complete tasks, and see household coverage at a glance
**Depends on**: Phase 2
**Requirements**: COMP-01, COMP-02, COMP-03, VIEW-01, VIEW-02, VIEW-03, VIEW-04, VIEW-05, VIEW-06
**Success Criteria** (what must be TRUE):
  1. Default screen shows Overdue, This Week, and Horizon bands with tasks sorted appropriately
  2. User can complete a task with one tap and sees it move out of the overdue/due bands
  3. Early-completion guard prompts the user when completing a task less than 25% into its cycle
  4. Coverage ring at the top reflects the household's overall maintenance health
  5. Year-view horizon shows a 12-month calendar strip with upcoming task distribution
**Plans**: 3 plans
**UI hint**: yes

Plans:
- [x] 03-01-PLAN.md — Completions collection migration + pure band/coverage/guard functions + completeTaskAction server action
- [x] 03-02-PLAN.md — Three-band UI: CoverageRing, TaskBand, TaskRow, HorizonStrip, BandView + rewritten /h/[homeId] page
- [x] 03-03-PLAN.md — Wire tap-to-complete + EarlyCompletionDialog + TaskDetailSheet + D-21 Playwright E2E

### Phase 4: Collaboration
**Goal**: A household can share a home, manage members, and tasks resolve their effective assignee through cascading logic
**Depends on**: Phase 3
**Requirements**: HOME-05, HOME-06, HOME-07, TASK-02, TASK-03, TASK-04
**Success Criteria** (what must be TRUE):
  1. User can generate a shareable invite link and a second user can join the home via that link
  2. Home owner can view members and remove a member from the home
  3. Tasks show their effective assignee (task-level, area-default, or "Anyone") with a visual indicator distinguishing inherited vs overridden assignment
  4. Assigning a member to a task overrides the area default; unassigning falls back to cascade
**Plans**: 3 plans
**UI hint**: yes

Plans:
- [x] 04-01-PLAN.md — home_members + invites PB migrations with owner backfill + rule-update to member-gated access + Whole Home hook extension + integration tests
- [x] 04-02-PLAN.md — invite/member server actions (createInvite, acceptInvite, revokeInvite, removeMember, leaveHome) + admin client + membership helpers + signup-next thread-through + /invite/[token] route + ownership→membership preflight swap
- [x] 04-03-PLAN.md — resolveAssignee pure fn + avatar primitives + AssigneeDisplay + HomeSwitcher home_members swap + Settings/Members/Leave routes + InviteLinkCard + MembersList + Playwright E2E (invite roundtrip + cascade + owner gating)

### Phase 5: Views & Onboarding
**Goal**: Users can explore tasks by area, view personal history, and new households get a guided first-run experience with seed tasks
**Depends on**: Phase 4
**Requirements**: AREA-V-01, AREA-V-02, AREA-V-03, PERS-01, PERS-02, PERS-03, PERS-04, HIST-01, HIST-02, HIST-03, ONBD-01, ONBD-02, ONBD-03, ONBD-04
**Success Criteria** (what must be TRUE):
  1. By Area view shows cards per area with coverage %, overdue/due/upcoming counts, and "Whole Home" pinned to top
  2. Person view shows the user's assigned tasks, completion history, and personal stats
  3. History view shows a filterable timeline of household completions (by person, area, time range)
  4. First-run wizard offers seed tasks organized by area, and user can accept/reject/customize each one
**Plans**: 3 plans
**UI hint**: yes

Plans:
- [x] 05-01-PLAN.md — homes.onboarded migration + seed library + pure helpers (streak / area-coverage / history-filter) + nav shell (bottom nav + top tabs) + per-home layout
- [x] 05-02-PLAN.md — By Area view (grid + pinned Whole Home) + Person view (assigned tasks + history + stats + prefs stub) + History view (timeline + URL-param filters) + E2E Suites B/C/D
- [x] 05-03-PLAN.md — Onboarding wizard (SeedTaskCard + OnboardingWizard) + batchCreateSeedTasks / skipOnboarding actions + dashboard redirect + E2E Suite A + backward-compat skip helper

### Phase 6: Notifications & Gamification
**Goal**: The app proactively reminds users of overdue tasks via ntfy and provides gentle motivation through streaks and celebrations
**Depends on**: Phase 5
**Requirements**: NOTF-01, NOTF-02, NOTF-03, NOTF-04, NOTF-05, NOTF-06, NOTF-07, GAME-01, GAME-02, GAME-03, GAME-04, GAME-05
**Success Criteria** (what must be TRUE):
  1. User can configure a personal ntfy topic and receives a push notification when a task becomes overdue
  2. Hourly scheduler detects newly-overdue tasks and sends notifications (once per task per overdue cycle)
  3. Household streak increments each week with at least one completion and displays on the main view
  4. A celebration animation plays when an area first hits 100% coverage
  5. Weekly summary notification reports household maintenance status to opted-in users
**Plans**: 3 plans
**UI hint**: yes

Plans:
- [x] 06-01-PLAN.md — PB migrations (users prefs + notifications collection) + pure fns (sendNtfy, computeHouseholdStreak, computeWeeklySummary, detectAreaCelebration, notification ref-cycle builders) + idempotency integration test
- [x] 06-02-PLAN.md — node-cron scheduler + instrumentation.ts boot hook + /api/admin/run-scheduler route + sync notification hooks in updateTask/completeTask + updateNotificationPrefs action + .env.example updates
- [x] 06-03-PLAN.md — NotificationPrefsForm (replaces Phase 5 placeholder) + HouseholdStreakBadge in dashboard header + MostNeglectedCard between Overdue and This Week + AreaCelebration animation + E2E Suite E (topic → overdue → scheduler → notifications row)

### Phase 7: PWA & Release
**Goal**: The app is installable as a PWA on HTTPS deployments, ships with production compose variants, and publishes via CI/CD
**Depends on**: Phase 6
**Requirements**: INFR-07, INFR-08, INFR-09
**Success Criteria** (what must be TRUE):
  1. On HTTPS deployments, the app is installable as a PWA with offline read caching
  2. On LAN-only (HTTP) deployments, the app informs users what features are unavailable without breaking functionality
  3. GitHub Actions builds multi-arch images and publishes to GHCR on tagged releases
**Plans**: 2 plans

Plans:
- [x] 07-01-PLAN.md — PWA manifest + Serwist service worker + secure-context detection + warm banner for HTTP deployments
- [x] 07-02-PLAN.md -- Caddy + Tailscale compose variants + deployment/PWA-install docs + INFR-09 release pipeline re-validation

### Phase 8: UX Polish
**Goal**: Typography hierarchy, horizon scannability, and provenance canaries across the shipped v1.0.0-rc1 surface
**Depends on**: Phase 7
**Requirements**: (no new REQ-IDs — UX polish post-v1.0.0-rc1)
**Success Criteria** (what must be TRUE):
  1. HomeKeep wordmark and page headings render in Lora display serif across landing, dashboard, By Area, Person, and Settings
  2. Horizon strip's empty months are visually subordinate while the current month is clearly highlighted
  3. Dashboard zero-task state renders a warm, two-line empty panel instead of sprawling whitespace
  4. A deployed HomeKeep instance exposes at least a dozen passive provenance markers (meta tags, SPDX headers, manifest hints) with zero outbound telemetry
**Plans**: 1 plan (completed inline; ~9 atomic commits)

Plans:
- [x] 08-SUMMARY.md — Lora font wiring, typography hierarchy, mobile header density, horizon scannability, empty-band polish, most-neglected polish, canary SPDX + manifest, Docker rebuild + redeploy, screenshot refresh

### Phase 9: UX Audit Fix
**Goal**: Post-launch UX audit fix pass — warm-only palette, accessibility contrast, button hierarchy, avatar/streak visual separation — driven by screenshot review
**Depends on**: Phase 8
**Requirements**: (no new REQ-IDs — UX audit fix post-v1.0.0-rc1)
**Success Criteria** (what must be TRUE):
  1. Every surface (dashboard, By Area, Person, History, Settings, auth, landing) renders only warm-palette colors — no sage green, no pure red siren
  2. Area card counter rows never orphan-wrap mid-phrase on narrow viewports
  3. Single-home users do not see a useless HomeSwitcher dropdown
  4. Dashboard AvatarStack and Streak pill read as distinct weights (soft avatar variant vs solid streak) rather than competing warm dots
**Plans**: 1 plan (completed inline; 14 atomic fix commits + screenshot refresh)

Plans:
- [x] 09-SUMMARY.md — 11 audit fixes (area counter wrap, palette tightening, Whole Home pill removal, HomeSwitcher single-home hide, danger-zone warm brick, landing presence, Person stat height equalization, History range equal-width, soft avatar variant, Settings button hierarchy, horizon empty-month opacity + auth link contrast) + palette backfill hook + rebuild + screenshots

### Phase 10: Schedule Override Foundation
**Goal**: A durable, history-preserving schedule-override primitive exists in the data layer and is consulted by every consumer of `computeNextDue`, so later UI phases can snooze tasks without surprising the scheduler, coverage ring, or notification dedup
**Depends on**: Phase 9
**Requirements**: SNZE-04, SNZE-05, SNZE-06, SNZE-09, SNZE-10
**Success Criteria** (what must be TRUE):
  1. A new `schedule_overrides` PocketBase collection exists with `(id, task_id, snooze_until, consumed_at, created)` and is queryable under the same member-gated access rules as `tasks`
  2. `computeNextDue` returns the latest active (unconsumed) override date instead of the natural next-due when one exists, and falls back to natural logic otherwise
  3. Writing a completion whose `completed_at` lands after an override marks that override consumed (never reused for a subsequent cycle)
  4. The coverage ring reads the snoozed (later) next-due — a snoozed task does not drag household health down while snoozed
  5. The ntfy scheduler's `ref_cycle` key resolves to the effective (post-override) next-due, so a snoozed task fires exactly one "now overdue" notification on the new date (idempotent re-firing preserved)
  6. All 311 unit + 23 E2E tests pass unchanged (signature extension is additive; default override-less behavior matches v1.0)
**Plans**: TBD (estimate 2-3)

Plans:
- [ ] 10-01: TBD

### Phase 11: Task Model Extensions
**Goal**: The task data model and `computeNextDue` absorb one-off semantics, preferred-weekday constraints, and seasonal-window dormancy in a single coherent schema pass — no UI work, all scheduler logic unit-tested before any surface shows it
**Depends on**: Phase 10
**Requirements**: OOFT-01, OOFT-02, OOFT-03, PREF-01, PREF-02, PREF-03, PREF-04, SEAS-01, SEAS-02, SEAS-03, SEAS-04, SEAS-05, SDST-01
**Success Criteria** (what must be TRUE):
  1. Creating a task with `frequency_days = null` succeeds; that task appears in Overdue from creation, and completing it archives it atomically (auto-removed from every view)
  2. Setting `preferred_days = weekend` on a 14-day task whose natural next-due lands on a Tuesday shifts the result forward to the next Saturday; natural weekend dates are never shifted earlier
  3. A task with `active_from_month = 10, active_to_month = 3` correctly reports dormant for April through September and returns start-of-October as its first next-due when the window opens
  4. The coverage ring excludes dormant tasks from its mean (identical treatment to archived tasks)
  5. A newly-added `completions.via` enum value `seed-stagger` exists and is writable; no existing completion rows are invalidated
  6. All 311 unit + 23 E2E tests still pass; a new unit suite of roughly 25-30 cases covers the one-off / preferred-days / seasonal / cross-year-wrap matrix
**Plans**: TBD (estimate 3-4)

Plans:
- [ ] 11-01: TBD

### Phase 12: Seasonal UI & Seed Library
**Goal**: Seasonal tasks are first-class in the UI — authors can set active months on the task form, dormant tasks render as distinct "sleeping" rows across By Area / Person / dashboard views, and the onboarding seed library ships two seasonal task pairs so a new household tastes the feature without custom work
**Depends on**: Phase 11
**Requirements**: SEAS-06, SEAS-07, SEAS-08, SEAS-09, SEAS-10
**Success Criteria** (what must be TRUE):
  1. Task form exposes an optional "Active months" section with from/to month selectors; leaving both blank keeps the task year-round
  2. A dormant task in By Area and Person views renders visually dimmed with a "Sleeps until Mon YYYY" badge and is not tap-completable from those views
  3. Saving an anchored task whose fired series would fall predominantly outside its active window surfaces a warning (does not block save)
  4. The onboarding seed library offers at least two seasonal task pairs (e.g. warm-season mow / cool-season mow; summer AC service / winter heater service)
  5. The History view continues to show completed-while-dormant rows regardless of the task's current dormancy state
**Plans**: TBD (estimate 2-3)
**UI hint**: yes

Plans:
- [ ] 12-01: TBD

### Phase 13: One-Off & Reschedule UI
**Goal**: Users can create one-off tasks and rearrange any task's next occurrence from any view via a mobile-friendly action sheet — snoozing or permanently shifting a task without needing to edit the task, and with a confirmation dialog when a snooze escapes the active season
**Depends on**: Phase 12
**Requirements**: OOFT-04, SNZE-01, SNZE-02, SNZE-03, SNZE-07, SNZE-08
**Success Criteria** (what must be TRUE):
  1. Task form cleanly distinguishes "Recurring" (frequency required) vs "One-off" (frequency disabled/null); anchored mode is disallowed for one-off tasks
  2. Tapping a "Reschedule" affordance on any task (in BandView, PersonTaskList, TaskDetailSheet, By Area) opens an action sheet with a date picker defaulting to the natural next-due and a "Just this time" / "From now on" radio (default: Just this time)
  3. Choosing "Just this time" writes a `schedule_overrides` row; choosing "From now on" mutates `tasks.anchor_date` directly (no override row written)
  4. Picking a date outside a seasonal task's active window surfaces an "Extend the active window?" confirmation dialog before any write happens — cancelling closes the sheet with no state change
  5. After a snooze lands, the task reappears on the chosen date across every view and the ntfy scheduler fires one overdue notification at that new date (not the original)
**Plans**: TBD (estimate 2-3)
**UI hint**: yes

Plans:
- [ ] 13-01: TBD

### Phase 14: Seed-Stagger & History/Stats Filters
**Goal**: New households no longer see their first-due dates clump — `batchCreateSeedTasks` writes synthetic `via='seed-stagger'` completions with a cohort-distribution offset that respects each task's active months, and those synthetic rows are invisible to History, personal stats, and partner-completed notifications
**Depends on**: Phase 13
**Requirements**: SDST-02, SDST-03, SDST-04, SDST-05, SDST-06, SDST-07
**Success Criteria** (what must be TRUE):
  1. A fresh household accepting all 30+ seed tasks sees those tasks' first-due dates spread across the cycle window (no two same-frequency tasks share a first-due date)
  2. A seasonal seed task's stagger offset never places its first-due inside a dormant month
  3. The History timeline shows zero entries immediately after onboarding — the synthetic seed-stagger completions are filtered out
  4. Personal stats counters do not inflate by the seed-batch size; a just-onboarded user shows zero completions on their profile
  5. No partner-completed or area-celebration notifications fire as a result of the seed batch (scheduler + notification hooks skip `via='seed-stagger'` rows)
**Plans**: TBD (estimate 2-3)
**UI hint**: yes

Plans:
- [ ] 14-01: TBD

### Phase 15: SPEC v0.3, AGPL Drift Fix & v1.1 Changelog
**Goal**: SPEC.md catches up to reality — bumped to v0.3, three stale MIT references corrected to AGPL-3.0, and a full v1.1 changelog documents every new field, collection, form control, and semantic introduced in phases 10-14 — leaving the milestone release-ready for `v1.1.0-rc1`
**Depends on**: Phase 14
**Requirements**: DOCS-01, DOCS-02, DOCS-03, DOCS-04, DOCS-05
**Success Criteria** (what must be TRUE):
  1. SPEC.md's frontmatter / version tag reads `v0.3` and every remaining reference to "MIT" in SPEC.md is corrected to AGPL-3.0
  2. SPEC.md contains a dedicated v1.1 changelog section listing the new task fields (`preferred_days`, `active_from_month`, `active_to_month`, nullable `frequency_days`), the `schedule_overrides` collection, the `completions.via='seed-stagger'` enum value, and the seed-stagger semantic
  3. PROJECT.md's INFR-12 entry reads AGPL-3.0 (not MIT)
  4. A new reader can understand — from SPEC.md alone — how to snooze a task, how a seasonal window wraps across year-end, and why History is empty immediately after onboarding
**Plans**: TBD (estimate 1-2)

Plans:
- [ ] 15-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10 -> 11 -> 12 -> 13 -> 14 -> 15

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Scaffold & Infrastructure | 7/7 | Complete    | 2026-04-20 |
| 2. Auth & Core Data | 4/5 | In progress | - |
| 3. Core Loop | 3/3 | Complete    | 2026-04-21 |
| 4. Collaboration | 3/3 | Complete    | 2026-04-21 |
| 5. Views & Onboarding | 3/3 | Complete    | 2026-04-21 |
| 6. Notifications & Gamification | 3/3 | Complete    | 2026-04-21 |
| 7. PWA & Release | 2/2 | Complete    | 2026-04-21 |
| 8. UX Polish | 1/1 | Complete    | 2026-04-21 |
| 9. UX Audit Fix | 1/1 | Complete    | 2026-04-21 |
| 10. Schedule Override Foundation | 0/3 | Not started | - |
| 11. Task Model Extensions | 0/4 | Not started | - |
| 12. Seasonal UI & Seed Library | 0/3 | Not started | - |
| 13. One-Off & Reschedule UI | 0/3 | Not started | - |
| 14. Seed-Stagger & History/Stats Filters | 0/3 | Not started | - |
| 15. SPEC v0.3, AGPL Drift Fix & v1.1 Changelog | 0/2 | Not started | - |
