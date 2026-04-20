# Roadmap: HomeKeep

## Overview

HomeKeep delivers a self-hosted household maintenance PWA in 7 phases, starting with Docker infrastructure, building single-user task management, adding the differentiating three-band UI, enabling household collaboration, layering secondary views and onboarding, adding notifications and gamification, and finishing with PWA polish and release tooling. Each phase delivers a coherent, verifiable capability that builds on the previous.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Scaffold & Infrastructure** - Docker container with Next.js + PocketBase running, dev environment, compose files, health endpoint
- [ ] **Phase 2: Auth & Core Data** - Single user can sign up, create homes/areas/tasks, and manage their data
- [ ] **Phase 3: Core Loop** - Three-band main view with task completion, coverage ring, and early-completion guard
- [ ] **Phase 4: Collaboration** - Share homes via invite links, manage members, cascading task assignment
- [ ] **Phase 5: Views & Onboarding** - By Area, Person, and History views plus seed task library wizard
- [ ] **Phase 6: Notifications & Gamification** - ntfy push notifications, scheduler, streaks, and celebrations
- [ ] **Phase 7: PWA & Release** - PWA manifest, HTTPS compose variants, graceful degradation, CI/CD publish

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
- [ ] 01-07-PLAN.md — Public-polish README.md covering quickstart, first-boot PB setup, dev workflow, caveats, MIT license

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
**Plans**: TBD
**UI hint**: yes

Plans:
- [ ] 02-01: TBD
- [ ] 02-02: TBD
- [ ] 02-03: TBD

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
**Plans**: TBD
**UI hint**: yes

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD
- [ ] 03-03: TBD

### Phase 4: Collaboration
**Goal**: A household can share a home, manage members, and tasks resolve their effective assignee through cascading logic
**Depends on**: Phase 3
**Requirements**: HOME-05, HOME-06, HOME-07, TASK-02, TASK-03, TASK-04
**Success Criteria** (what must be TRUE):
  1. User can generate a shareable invite link and a second user can join the home via that link
  2. Home owner can view members and remove a member from the home
  3. Tasks show their effective assignee (task-level, area-default, or "Anyone") with a visual indicator distinguishing inherited vs overridden assignment
  4. Assigning a member to a task overrides the area default; unassigning falls back to cascade
**Plans**: TBD
**UI hint**: yes

Plans:
- [ ] 04-01: TBD
- [ ] 04-02: TBD

### Phase 5: Views & Onboarding
**Goal**: Users can explore tasks by area, view personal history, and new households get a guided first-run experience with seed tasks
**Depends on**: Phase 4
**Requirements**: AREA-V-01, AREA-V-02, AREA-V-03, PERS-01, PERS-02, PERS-03, PERS-04, HIST-01, HIST-02, HIST-03, ONBD-01, ONBD-02, ONBD-03, ONBD-04
**Success Criteria** (what must be TRUE):
  1. By Area view shows cards per area with coverage %, overdue/due/upcoming counts, and "Whole Home" pinned to top
  2. Person view shows the user's assigned tasks, completion history, and personal stats
  3. History view shows a filterable timeline of household completions (by person, area, time range)
  4. First-run wizard offers seed tasks organized by area, and user can accept/reject/customize each one
**Plans**: TBD
**UI hint**: yes

Plans:
- [ ] 05-01: TBD
- [ ] 05-02: TBD
- [ ] 05-03: TBD

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
**Plans**: TBD
**UI hint**: yes

Plans:
- [ ] 06-01: TBD
- [ ] 06-02: TBD
- [ ] 06-03: TBD

### Phase 7: PWA & Release
**Goal**: The app is installable as a PWA on HTTPS deployments, ships with production compose variants, and publishes via CI/CD
**Depends on**: Phase 6
**Requirements**: INFR-07, INFR-08, INFR-09
**Success Criteria** (what must be TRUE):
  1. On HTTPS deployments, the app is installable as a PWA with offline read caching
  2. On LAN-only (HTTP) deployments, the app informs users what features are unavailable without breaking functionality
  3. GitHub Actions builds multi-arch images and publishes to GHCR on tagged releases
**Plans**: TBD

Plans:
- [ ] 07-01: TBD
- [ ] 07-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Scaffold & Infrastructure | 5/7 | In progress | - |
| 2. Auth & Core Data | 0/3 | Not started | - |
| 3. Core Loop | 0/3 | Not started | - |
| 4. Collaboration | 0/2 | Not started | - |
| 5. Views & Onboarding | 0/3 | Not started | - |
| 6. Notifications & Gamification | 0/3 | Not started | - |
| 7. PWA & Release | 0/2 | Not started | - |
