# Roadmap: HomeKeep

## Overview

HomeKeep delivers a self-hosted household maintenance PWA in 7 phases, starting with Docker infrastructure, building single-user task management, adding the differentiating three-band UI, enabling household collaboration, layering secondary views and onboarding, adding notifications and gamification, and finishing with PWA polish and release tooling. Each phase delivers a coherent, verifiable capability that builds on the previous.

**v1.1 (Scheduling & Flexibility)** extends the v1.0 foundation with household load-aware scheduling (the SPEC thesis — "spread the year's work evenly across weeks"), per-task flexibility (one-off, preferred-days, seasonal, snooze, permanent reschedule), horizon density visualization, a manual rebalance escape hatch, and a documentation refresh — all via additive, backward-compatible migrations. Forward-only smoothing on existing v1.0 tasks (`tasks.next_due_smoothed = NULL` → natural fallback; adopts at next post-upgrade completion). Anchored-mode tasks byte-identical to v1.0.

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

v1.1 extends v1.0 with household-global load-aware scheduling (the SPEC thesis-deliverer), per-task flexibility (one-off, preferred-days, seasonal, snooze, permanent reschedule), horizon density visualization, and a manual rebalance escape hatch. All migrations are additive; v1.0.0 installs upgrading via `:1` or `:latest` lose nothing. Anchored-mode tasks remain byte-identical to v1.0 (explicit opt-out from smoothing). The milestone ends by cutting `v1.1.0-rc1` per the GHCR tiered tag strategy.

- [ ] **Phase 10: Schedule Override Foundation** - `schedule_overrides` PB collection + `computeNextDue` override branch threaded through every caller (coverage, scheduler, horizon, band classification)
- [x] **Phase 11: Task Model Extensions** - Nullable `frequency_days`, `preferred_days`, `active_from_month`/`active_to_month` fields + scheduler logic for OOFT / PREF / SEAS behaviors. OOFT-01..03 finalized here after `/gsd-discuss-phase 11` locks first-due semantics (rider 2)
- [x] **Phase 12: Load-Smoothing Engine** - `tasks.next_due_smoothed` field, `placeNextDue` + `computeHouseholdLoad` helpers, integration into `computeNextDue`; PREF/SEAS/SNZE/OOFT/anchored interactions. **Hard gate: branch-composition test matrix covers all 6 branches and meaningful interactions.**
- [ ] **Phase 13: Task Creation Semantics** - Task form "Last done" optional field (Advanced collapsible) + smart-default first-due + `batchCreateSeedTasks` rewrite calling TCSEM per seed with in-memory load map; SDST removal cleanup
- [ ] **Phase 14: Seasonal UI & Seed Library** - Task form "Active months" section, dimmed + "Sleeps until" rendering in By Area / Person / dashboard, anchored-mode warning, seasonal seed pairs
- [ ] **Phase 15: One-Off & Reschedule UI** - Task form one-off toggle, Reschedule action sheet with date picker and "Just this time" / "From now on" radio; ExtendWindowDialog for cross-window snoozes
- [ ] **Phase 16: Horizon Density Visualization** - HorizonStrip density indicators, ⚖️ badge on shifted tasks across BandView/By Area/Person, TaskDetailSheet ideal-vs-scheduled surface
- [ ] **Phase 17: Manual Rebalance** - Settings → Scheduling → "Rebalance schedule" button + counts-only preview modal (breakdown by preservation reason) + apply (respects anchored, active snoozes, "From now on" marker)
- [ ] **Phase 18: SPEC v0.4, AGPL Drift Fix & v1.1 Changelog** - SPEC.md bump to v0.4, three MIT→AGPL corrections, full v1.1 changelog (LOAD/LVIZ/TCSEM/REBAL/OOFT/PREF/SEAS/SNZE), PROJECT.md INFR-12 + SMTP nit corrections

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
  2. `computeNextDue` returns the latest active (unconsumed) override date BEFORE any smoothed-date or natural branch, and falls back to downstream logic when no active override exists
  3. Writing a completion whose `completed_at` lands after an override marks that override consumed (never reused for a subsequent cycle)
  4. The coverage ring reads the snoozed (later) next-due — a snoozed task does not drag household health down while snoozed
  5. The ntfy scheduler's `ref_cycle` key resolves to the effective (post-override) next-due, so a snoozed task fires exactly one "now overdue" notification on the new date (idempotent re-firing preserved)
  6. All 311 unit + 23 E2E tests pass unchanged (signature extension is additive; default override-less behavior matches v1.0)
**Plans**: 3 plans

Plans:
- [ ] 10-01-P01-PLAN.md — schedule_overrides migration + helpers (getActiveOverride + getActiveOverridesForHome) + zod schema + unit/integration tests (port 18098)
- [ ] 10-02-P01-PLAN.md — computeNextDue signature extension (override? param) + thread overridesByTask Map through coverage/band/weekly/area helpers + 3 pages + 2 components + 6 test-file fixture churn
- [ ] 10-03-P01-PLAN.md — atomic consumption in completeTaskAction via pb.createBatch() + SNZE-06 integration scenarios (happy path + no-op regression)

### Phase 11: Task Model Extensions
**Goal**: The task data model and `computeNextDue` absorb one-off semantics, preferred-weekday constraints (as hard narrowing constraint), and seasonal-window dormancy in a single coherent schema pass — no UI work, all scheduler logic unit-tested before any surface shows it. OOFT first-due semantics (OOFT-01..03) are locked by `/gsd-discuss-phase 11` BEFORE plans are written
**Depends on**: Phase 10
**Requirements**: OOFT-01, OOFT-02, OOFT-03, OOFT-05, PREF-01, PREF-02, PREF-03, PREF-04, SEAS-01, SEAS-02, SEAS-03, SEAS-04, SEAS-05
**Success Criteria** (what must be TRUE):
  1. Creating a task without a recurring frequency succeeds; that task appears in the appropriate surface per the locked-in first-due semantics, and completing it archives it atomically (auto-removed from every view)
  2. Setting `preferred_days = weekend` on a 14-day task whose natural next-due lands on a Tuesday narrows candidates to the next Saturday/Sunday BEFORE load scoring; natural weekend dates are never shifted earlier
  3. When `preferred_days` eliminates every day in the tolerance window, the scheduler searches forward in 1-day increments up to +6 days from natural ideal
  4. A task with `active_from_month = 10, active_to_month = 3` correctly reports dormant for April through September and returns start-of-October as its first next-due when the window opens (cross-year wrap supported)
  5. The coverage ring excludes dormant tasks from its mean (identical treatment to archived tasks)
  6. One-off tasks contribute `1` to the household load density on their due date but their own `next_due_smoothed` is never re-smoothed by LOAD (contract surfaced for Phase 12)
  7. All 311 unit + 23 E2E tests still pass; a new unit suite of roughly 25-30 cases covers the one-off / preferred-days / seasonal / cross-year-wrap matrix
**Plans**: 3 plans

> **Pre-planning gate (rider 2):** Before any Phase 11 plans are written, `/gsd-discuss-phase 11` must debate the three candidate shapes for one-off task first-due semantics — (a) explicit "do by" date required, (b) default `creation + 7 days` editable, (c) separate "To-do" list with promote-to-scheduled. User leans (a). Whichever shape locks into Phase 11 CONTEXT.md becomes the data model for OOFT-01..03.

Plans:
- [x] 11-01-P01-PLAN.md — Migration + zod schema + helper scaffolding (4 new nullable fields, frequency_days nullable, effectivePreferredDays/narrowToPreferredDays/isInActiveWindow/nextWindowOpenDate helpers, 31 unit tests, A1 resolved)
- [x] 11-02-P01-PLAN.md — computeNextDue seasonal-dormant/wakeup/OOFT branches (D-16 order), computeCoverage dormant filter, completeTaskAction OOFT auto-archive batch op, ~18 new unit tests
- [x] 11-03-P01-PLAN.md — Integration suite on port 18099: 4 scenarios (migration shape, OOFT lifecycle atomic archive, seasonal dormant/wakeup, D-17 override × dormant)

### Phase 12: Load-Smoothing Engine
**Goal**: Deliver the SPEC thesis — *"spread the year's work evenly across weeks"* — by making `computeNextDue` consult a stored `tasks.next_due_smoothed` that is chosen by a forward-only placement algorithm over a per-day household load map. All 6 branches (override, smoothed, anchored, seasonal, one-off, natural) short-circuit in a documented order; anchored tasks bypass smoothing entirely
**Depends on**: Phase 11
**Requirements**: LOAD-01, LOAD-02, LOAD-03, LOAD-04, LOAD-05, LOAD-06, LOAD-07, LOAD-08, LOAD-09, LOAD-10, LOAD-11, LOAD-12, LOAD-13, LOAD-14, LOAD-15
**Success Criteria** (what must be TRUE):
  1. Adding a new 7-day task to a household that already has 5 other 7-day tasks lands the new task on the day with the fewest existing tasks within ±5 days of the natural ideal date (closest-to-ideal tiebreak, earlier-wins second tiebreak)
  2. Completing a task writes its next cycle's `next_due_smoothed` in the same batch as the completion write; placing one task never modifies any other task's `next_due_smoothed` value (forward-only contract)
  3. An anchored-mode task's placement, next-due, and every observable behavior is byte-identical to v1.0 (LOAD-06): smoothing is bypassed, anchored tasks still contribute to the load map for other tasks' placement
  4. A single `placeNextDue` call for a household with 100 active tasks completes in under 100ms end-to-end (measured budget, asserted in tests)
  5. `computeNextDue` branch composition test matrix is complete: all 6 branches (override, smoothed, anchored, seasonal, one-off, natural) and every meaningful interaction between them are explicitly tested, no implicit fall-through assumptions — this matrix is a hard gate on phase completion (LOAD-15)
  6. v1.0 tasks with `next_due_smoothed = NULL` continue to read natural cadence until their next post-upgrade completion, at which point LOAD writes a smoothed date (TCSEM-07 precondition holds for Phase 13)
**Plans**: 4 plans

> **Hard gate (user-flagged, highest-risk code in v1.1):** Phase 12 plan must include a complete branch-composition test matrix covering every combination — this is the highest-risk code in v1.1. Any branch interaction not explicitly tested is a future bug. Phase is not complete until LOAD-15 is green.

> **Rider 1 — tolerance window validation:** Tolerance window ships at `min(0.15 * freq, 5)` initially. During Phase 12 verification, validate against a 30-task realistic test household (1 / 7 / 14 / 30 / 90 / 365-day frequencies). If annual-cycle clusters remain bunched, widen to `min(0.15 * freq, 14)` before phase complete. The default ±5 → upgrade ±14 decision may require updating LOAD-04 REQ text and tests.

Plans:
- [x] 12-01-P01-PLAN.md — Wave 1: additive migration (1745280002) + lib/load-smoothing.ts (placeNextDue + computeHouseholdLoad pure helpers) + isOoftTask helper export + zod schema extension + 18+ unit tests for helpers
- [x] 12-02-P01-PLAN.md — Wave 2: computeNextDue smoothed branch insertion (D-02 order with D-03 anchored bypass + D-15 seasonal-wakeup handshake + T-12-07 Invalid Date defense) + 21-case LOAD-15 branch composition matrix hard gate
- [x] 12-03-P01-PLAN.md — Wave 3: completeTaskAction step 7.5 batch extension (atomic placement op on cycle && !OOFT, D-13 error fallback) + 3 action-level bypass invariant unit tests
- [ ] 12-04-P01-PLAN.md — Wave 4: LOAD-13 perf benchmark (<100ms, 100-task) + 5-scenario disposable-PB integration suite on port 18100 (migration / completion flow / tz-drift / rider-1 validation / v1.0 upgrade) + Rider-1 tolerance decision checkpoint

### Phase 13: Task Creation Semantics
**Goal**: Every new task — whether custom or seed-batched — enters the system with a load-smoothed `next_due_smoothed` already populated, eliminating the v1.0 onboarding clumping problem at its source. "Last done" becomes an optional Advanced field; smart defaults handle the common case; SDST synthetic completions are fully removed
**Depends on**: Phase 12
**Requirements**: TCSEM-01, TCSEM-02, TCSEM-03, TCSEM-04, TCSEM-05, TCSEM-06, TCSEM-07
**Success Criteria** (what must be TRUE):
  1. The task form's Advanced collapsible (default collapsed) exposes an optional "Last done" date field; providing it sets `first_ideal = last_done + frequency_days`, then runs through the load smoother
  2. When "Last done" is blank in cycle mode, smart-default first-due resolves per cycle length (≤7d → tomorrow; 8-90d → cycle/4; >90d → cycle/3), then runs through the load smoother
  3. Accepting all 30+ seed tasks in onboarding produces a cohort whose first-due dates are naturally distributed — no two same-frequency seeds share a first-due day — and zero synthetic `via='seed-stagger'` completion rows are written (SDST gone)
  4. Every newly-created task (custom or seeded) has `next_due_smoothed` populated at write time; History view is empty immediately after onboarding; personal stats counters are zero for the just-onboarded user
  5. v1.0 tasks are untouched by this phase — their `next_due_smoothed` remains `NULL` until their own next post-upgrade completion (TCSEM-07)
**Plans**: 2 plans
**UI hint**: yes

Plans:
- [x] 13-01-P01-PLAN.md — Wave 1: computeFirstIdealDate helper (TCSEM-02/TCSEM-03 formulas) + createTask TCSEM placement (mirrors completeTaskAction step 7.5) + batchCreateSeedTasks in-memory load-map threading + SDST audit/removal (code-level ZERO matches)
- [ ] 13-02-P01-PLAN.md — Wave 2: shadcn Collapsible primitive + task-form Advanced collapsible with Last done date field (cycle-mode only) + 3-scenario disposable-PB integration suite on port 18101 (custom create atomicity / 5-seed cohort distribution / SDST runtime absence)

### Phase 14: Seasonal UI & Seed Library
**Goal**: Seasonal tasks are first-class in the UI — authors can set active months on the task form, dormant tasks render as distinct "sleeping" rows across By Area / Person / dashboard views, and the onboarding seed library ships two seasonal task pairs so a new household tastes the feature without custom work
**Depends on**: Phase 13
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
- [ ] 14-01: TBD

### Phase 15: One-Off & Reschedule UI
**Goal**: Users can create one-off tasks and rearrange any task's next occurrence from any view via a mobile-friendly action sheet — snoozing (one-off override) or permanently shifting ("From now on" mutates anchor / `next_due_smoothed` with a marker flag preserved by REBAL) without needing to edit the task, with a confirmation dialog when a snooze escapes the active season
**Depends on**: Phase 14
**Requirements**: OOFT-04, SNZE-01, SNZE-02, SNZE-03, SNZE-07, SNZE-08
**Success Criteria** (what must be TRUE):
  1. Task form cleanly distinguishes "Recurring" (frequency required) vs "One-off" (frequency disabled/null); anchored mode is disallowed for one-off tasks
  2. Tapping a "Reschedule" affordance on any task (in BandView, PersonTaskList, TaskDetailSheet, By Area) opens an action sheet with a date picker defaulting to the natural next-due and a "Just this time" / "From now on" radio (default: Just this time)
  3. Choosing "Just this time" writes a `schedule_overrides` row; choosing "From now on" mutates `tasks.anchor_date` (anchored mode) or `tasks.next_due_smoothed` with a marker flag (cycle mode) directly — no override row written, marker flag detectable by REBAL preservation rules
  4. Picking a date outside a seasonal task's active window surfaces an "Extend the active window?" confirmation dialog before any write happens — cancelling closes the sheet with no state change
  5. After a snooze lands, the task reappears on the chosen date across every view and the ntfy scheduler fires one overdue notification at that new date (not the original)
**Plans**: TBD (estimate 2-3)
**UI hint**: yes

Plans:
- [ ] 15-01: TBD

### Phase 16: Horizon Density Visualization
**Goal**: Give users an honest visual read of household load — the Horizon strip shows per-month density, and any task that LOAD shifted from its natural date wears a ⚖️ badge that users can inspect to see the ideal-vs-scheduled dates. This is the UI half of the LOAD thesis
**Depends on**: Phase 15
**Requirements**: LVIZ-01, LVIZ-02, LVIZ-03, LVIZ-04, LVIZ-05
**Success Criteria** (what must be TRUE):
  1. HorizonStrip month cells render a density indicator (e.g. background tint or dot count) that scales monotonically with the number of tasks due that month; tapping any cell opens the existing Sheet drawer with density-aware rendering
  2. A task whose `next_due_smoothed` differs from its natural ideal by more than zero days displays a ⚖️ badge in every view where it appears (BandView, By Area, Person, HorizonStrip sheet)
  3. Tasks whose scheduled date equals their natural ideal show no badge — the surface only signals when there's a story to tell
  4. Tapping a task with a ⚖️ badge opens TaskDetailSheet whose "Schedule" section shows both the ideal date and the scheduled date, with short copy explaining the shift
**Plans**: TBD (estimate 2)
**UI hint**: yes

Plans:
- [ ] 16-01: TBD

### Phase 17: Manual Rebalance
**Goal**: Ship the manual escape hatch for forward-only smoothing — users can open Settings → Scheduling → "Rebalance schedule", see a counts-only preview with preservation breakdown, and apply a re-placement that respects anchored tasks, active snoozes, and "From now on" user intent. This is the v1.1 minimal surface; per-task preview, undo, auto-trigger, and area-scoped rebalance are deferred to v1.2+
**Depends on**: Phase 16
**Requirements**: REBAL-01, REBAL-02, REBAL-03, REBAL-04, REBAL-05, REBAL-06, REBAL-07
**Success Criteria** (what must be TRUE):
  1. Settings → Scheduling surfaces a "Rebalance schedule" button that opens a preview modal before any write
  2. The preview modal shows counts only — e.g. "Will update: 18 / Will preserve: 7 (3 anchored, 2 active snoozes, 2 from-now-on shifts)" — with the breakdown attributing each preserved task to exactly one reason
  3. Anchored-mode tasks, tasks with an unconsumed `schedule_overrides` row, and tasks whose `next_due_smoothed` carries the "From now on" marker flag (set by SNZE-07) are never re-placed by rebalance
  4. Applying the rebalance re-runs `placeNextDue` against a fresh `computeHouseholdLoad` map for every non-preserved task in ascending ideal-date order, updating the in-memory load map between placements (deterministic; matches TCSEM batch pattern)
  5. After Apply, the main view reflects the new distribution on next render; running rebalance a second time immediately after is a no-op (load map is already smooth)
**Plans**: TBD (estimate 2-3)
**UI hint**: yes

Plans:
- [ ] 17-01: TBD

### Phase 18: SPEC v0.4, AGPL Drift Fix & v1.1 Changelog
**Goal**: SPEC.md catches up to reality — bumped to v0.4 (not v0.3, because the addendum changes the spec materially), three stale MIT references corrected to AGPL-3.0, full v1.1 changelog documents every new field, collection, algorithm, and UI surface introduced in phases 10-17, PROJECT.md INFR-12 + SMTP nit corrected — leaving the milestone release-ready for `v1.1.0-rc1`
**Depends on**: Phase 17
**Requirements**: DOCS-01, DOCS-02, DOCS-03, DOCS-04, DOCS-05, DOCS-06
**Success Criteria** (what must be TRUE):
  1. SPEC.md's frontmatter / version tag reads `v0.4` and every remaining reference to "MIT" in SPEC.md is corrected to AGPL-3.0
  2. SPEC.md contains a dedicated v1.1 changelog section listing the new task fields (`next_due_smoothed`, `preferred_days`, `active_from_month`, `active_to_month`, nullable `frequency_days`), the `schedule_overrides` collection, the LOAD placement algorithm (tolerance window, tiebreakers, forward-only), and REBAL semantics
  3. PROJECT.md's INFR-12 entry reads AGPL-3.0 (not MIT) and the SMTP constraint reads "SMTP optional, never required"
  4. A new reader can understand — from SPEC.md alone — how to snooze a task, how LOAD picks a smoothed date, why anchored tasks bypass smoothing, how a seasonal window wraps across year-end, and how to trigger a manual rebalance
**Plans**: TBD (estimate 1-2)

Plans:
- [ ] 18-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10 -> 11 -> 12 -> 13 -> 14 -> 15 -> 16 -> 17 -> 18

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
| 12. Load-Smoothing Engine | 4/4 | Complete    | 2026-04-22 |
| 13. Task Creation Semantics | 0/3 | Not started | - |
| 14. Seasonal UI & Seed Library | 0/3 | Not started | - |
| 15. One-Off & Reschedule UI | 0/3 | Not started | - |
| 16. Horizon Density Visualization | 0/2 | Not started | - |
| 17. Manual Rebalance | 0/3 | Not started | - |
| 18. SPEC v0.4, AGPL Drift Fix & v1.1 Changelog | 0/2 | Not started | - |
