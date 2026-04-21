# Requirements: HomeKeep

**Defined:** 2026-04-20
**Core Value:** The household's recurring maintenance is visible, evenly distributed, and nothing falls through the cracks — without creating anxiety or guilt.

## v1 Requirements

### Authentication

- [x] **AUTH-01
**: User can sign up with email and password
- [x] **AUTH-02
**: User can log in and session persists across browser refresh
- [x] **AUTH-03
**: User can log out from any page
- [x] **AUTH-04
**: User can reset password via email link (PocketBase built-in)

### Homes

- [x] **HOME-01
**: User can create a home with name and optional address
- [x] **HOME-02
**: User can have multiple homes
- [x] **HOME-03
**: User lands on last-viewed home by default after login
- [x] **HOME-04
**: User can switch between homes via nav
- [x] **HOME-05
**: User can share a home via shareable invite link
- [x] **HOME-06
**: Invited user can accept invite and join a home
- [x] **HOME-07
**: Home owner can manage members (view, remove)

### Areas

- [x] **AREA-01
**: User can create areas within a home (location or whole_home scope)
- [x] **AREA-02
**: Each home auto-creates one "Whole Home" area that cannot be deleted
- [x] **AREA-03
**: User can set a default assignee per area
- [x] **AREA-04
**: Areas have name, icon, color, sort order
- [x] **AREA-05
**: User can edit and reorder areas

### Tasks

- [x] **TASK-01
**: User can create a task with name, frequency (days), area, optional notes
- [x] **TASK-02
**: User can assign a task to a specific member (overrides area default)
- [x] **TASK-03
**: Cascading assignment resolves: task assignee → area default → "Anyone"
- [x] **TASK-04
**: UI shows effective assignee with icon distinguishing inherited vs overridden
- [x] **TASK-05
**: User can set schedule mode per task (cycle or anchored, default: cycle)
- [x] **TASK-06
**: User can add custom tasks beyond seed library
- [x] **TASK-07
**: User can edit and archive tasks
- [x] **TASK-08
**: Next due date is computed, never stored (cycle: last_completion + frequency; anchored: next in fixed series)

### Completions

- [x] **COMP-01
**: User can complete a task with one tap (records who, when)
- [x] **COMP-02
**: Early-completion guard prompts when <25% of cycle elapsed since last completion
- [x] **COMP-03
**: Completions are append-only history (never deleted)

### Main View (Three-Band)

- [x] **VIEW-01
**: Default screen shows three bands: Overdue (top), This Week (middle), Horizon (bottom)
- [x] **VIEW-02
**: Overdue band only appears when tasks are actually overdue, sorted by days overdue
- [x] **VIEW-03
**: This Week band shows 7-day window, grouped by day if >5 items
- [x] **VIEW-04
**: Horizon band shows 12-month calendar strip with task dots/pills per month
- [x] **VIEW-05
**: Coverage ring at top shows % of annual maintenance on track (equal-weight, frequency-normalized)
- [x] **VIEW-06
**: Tapping a task allows completion or viewing details

### By Area View

- [x] **AREA-V-01
**: Card per area showing name, icon, coverage %, overdue/due/upcoming counts
- [x] **AREA-V-02
**: "Whole Home" card pinned to top
- [x] **AREA-V-03
**: Tapping an area card shows all its tasks

### Person View

- [x] **PERS-01
**: Shows tasks effectively assigned to the current user (via cascade)
- [x] **PERS-02
**: Shows user's completion history
- [x] **PERS-03
**: Shows personal streak and contribution to household stats
- [x] **PERS-04
**: Shows notification preferences (editable)

### History View

- [x] **HIST-01
**: Timeline of recent completions across the household
- [x] **HIST-02
**: Filterable by person, area, time range
- [x] **HIST-03
**: Shows who completed what and when

### Onboarding

- [x] **ONBD-01
**: First-run wizard offers seed task library with suggested frequencies and areas
- [x] **ONBD-02
**: User can accept/reject individual seed tasks
- [x] **ONBD-03
**: User can customize frequency and area assignment of seed tasks
- [x] **ONBD-04
**: Seed library covers Kitchen, Bathroom, Living areas, Yards, and Whole Home

### Notifications

- [x] **NOTF-01
**: Each user can configure a personal ntfy topic
- [x] **NOTF-02
**: Default ntfy server is ntfy.sh, configurable via NTFY_URL env var
- [x] **NOTF-03
**: Notification fires when a task becomes overdue (once, not repeatedly)
- [x] **NOTF-04
**: Notification fires when a task is assigned to you specifically
- [x] **NOTF-05
**: Optional notification when partner completes a task (off by default)
- [x] **NOTF-06
**: Optional weekly summary on Sunday (opt-in)
- [x] **NOTF-07
**: In-app scheduler (node-cron) runs hourly for overdue detection

### Gamification

- [x] **GAME-01
**: Household streak — consecutive weeks with at least one completion
- [x] **GAME-02
**: Per-area coverage percentages displayed
- [x] **GAME-03
**: Weekly summary: "Together you did X tasks. The house is Y% maintained."
- [x] **GAME-04
**: Small celebration animation when area first hits 100% coverage
- [x] **GAME-05
**: "Most neglected" card — the most overdue task, gentle nudge

### Infrastructure

- [x] **INFR-01
**: Single Docker image with Next.js + PocketBase (supervisord or similar)
- [x] **INFR-02
**: Multi-arch image: linux/amd64 + linux/arm64
- [x] **INFR-03
**: Final image under 300MB
- [x] **INFR-04
**: Single `./data` volume for all persistence (PB DB + uploads)
- [x] **INFR-05
**: `/api/health` endpoint for Docker / Uptime Kuma
- [x] **INFR-06
**: Three compose variants: LAN-only (default), Caddy (public domain), Tailscale (private HTTPS)
- [x] **INFR-07
**: App detects insecure context and informs user what's unavailable
- [x] **INFR-08
**: PWA manifest + service worker in HTTPS modes
- [x] **INFR-09
**: GitHub Actions CI/CD: lint, test on PR; multi-arch build → GHCR on tag
- [x] **INFR-10
**: Env-driven config — no hardcoded URLs, paths, or secrets
- [x] **INFR-11
**: `.env.example` with structure, real `.env` git-ignored
- [x] **INFR-12
**: MIT license, public GitHub repo

## v2 Requirements (v1.1)

### Area Groups

- **AGRP-01**: User can create area groups (Inside / Outside / Outbuildings) for homes with 6+ areas
- **AGRP-02**: Groups only appear when needed; small homes see flat area list

### Task Rotation

- **TROT-01**: Per-task toggle that round-robins between members on completion

### Public API

- **API-01**: Documented REST API at `/api/v1/*` with stable contracts
- **API-02**: Webhooks (task.overdue, task.completed, area.full_coverage)

### Additional

- **V2-01**: Year-in-review dashboard (December summary)
- **V2-02**: Photo attachment on completion (proof / before-after)
- **V2-03**: Task categories as cross-cutting tags (cleaning, maintenance, seasonal)
- **V2-04**: Export data as JSON

## Out of Scope

| Feature | Reason |
|---------|--------|
| Calendar integration (iCal, Google Cal) | Different problem space — maintenance isn't calendar-shaped |
| Shopping lists / inventory | Not home maintenance |
| Bill tracking / finance | Not home maintenance |
| Vendor/contractor contacts | Adds complexity without core value |
| Multi-tenant SaaS | Self-hosted first, always |
| Enterprise SSO (OIDC/SAML) | Not the target user |
| i18n (v1) | English only; strings extractable for later |
| Offline-first write sync | Reads cached, writes require connection |
| Real-time presence/cursors | Overkill for household app |
| Kids/chores mode | Post-1.1 — different mental model from adult maintenance |
| Points, XP, levels, leaderboards | Against cooperative design principle |
| Daily streak pressure | Weekly is humane, daily is toxic |
| SMTP email delivery | v1 uses link-only invites; no SMTP dependency |
| Native mobile apps | PWA is sufficient for v1 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 2 | Pending |
| AUTH-02 | Phase 2 | Pending |
| AUTH-03 | Phase 2 | Complete |
| AUTH-04 | Phase 2 | Pending |
| HOME-01 | Phase 2 | Pending |
| HOME-02 | Phase 2 | Pending |
| HOME-03 | Phase 2 | Pending |
| HOME-04 | Phase 2 | Pending |
| HOME-05 | Phase 4 | Complete |
| HOME-06 | Phase 4 | Complete |
| HOME-07 | Phase 4 | Complete |
| AREA-01 | Phase 2 | Pending |
| AREA-02 | Phase 2 | Pending |
| AREA-03 | Phase 2 | Pending |
| AREA-04 | Phase 2 | Pending |
| AREA-05 | Phase 2 | Pending |
| TASK-01 | Phase 2 | Pending |
| TASK-02 | Phase 4 | Complete |
| TASK-03 | Phase 4 | Complete |
| TASK-04 | Phase 4 | Complete |
| TASK-05 | Phase 2 | Pending |
| TASK-06 | Phase 2 | Pending |
| TASK-07 | Phase 2 | Pending |
| TASK-08 | Phase 2 | Pending |
| COMP-01 | Phase 3 | Complete (03-03) |
| COMP-02 | Phase 3 | Complete (03-01 + 03-03) |
| COMP-03 | Phase 3 | Complete (03-01) |
| VIEW-01 | Phase 3 | Complete (03-02) |
| VIEW-02 | Phase 3 | Complete (03-02) |
| VIEW-03 | Phase 3 | Complete (03-02) |
| VIEW-04 | Phase 3 | Complete (03-02) |
| VIEW-05 | Phase 3 | Complete (03-01 + 03-02) |
| VIEW-06 | Phase 3 | Complete (03-03) |
| AREA-V-01 | Phase 5 | Complete |
| AREA-V-02 | Phase 5 | Complete |
| AREA-V-03 | Phase 5 | Complete |
| PERS-01 | Phase 5 | Complete |
| PERS-02 | Phase 5 | Complete |
| PERS-03 | Phase 5 | Complete |
| PERS-04 | Phase 5 | Complete |
| HIST-01 | Phase 5 | Complete |
| HIST-02 | Phase 5 | Complete |
| HIST-03 | Phase 5 | Complete |
| ONBD-01 | Phase 5 | Complete |
| ONBD-02 | Phase 5 | Complete |
| ONBD-03 | Phase 5 | Complete |
| ONBD-04 | Phase 5 | Complete |
| NOTF-01 | Phase 6 | Complete |
| NOTF-02 | Phase 6 | Complete |
| NOTF-03 | Phase 6 | Complete |
| NOTF-04 | Phase 6 | Complete |
| NOTF-05 | Phase 6 | Complete |
| NOTF-06 | Phase 6 | Complete |
| NOTF-07 | Phase 6 | Complete |
| GAME-01 | Phase 6 | Complete |
| GAME-02 | Phase 6 | Complete |
| GAME-03 | Phase 6 | Complete |
| GAME-04 | Phase 6 | Complete |
| GAME-05 | Phase 6 | Complete |
| INFR-01 | Phase 1 | Complete (01-02) |
| INFR-02 | Phase 1 | Complete (01-02) |
| INFR-03 | Phase 1 | Complete (01-02) |
| INFR-04 | Phase 1 | Complete (01-02) |
| INFR-05 | Phase 1 | Complete (01-01) |
| INFR-06 | Phase 1 | Complete (01-05) |
| INFR-07 | Phase 7 | Complete |
| INFR-08 | Phase 7 | Complete |
| INFR-09 | Phase 7 | Complete |
| INFR-10 | Phase 1 | Complete (01-02) |
| INFR-11 | Phase 1 | Complete (01-01) |
| INFR-12 | Phase 1 | Complete (01-01) |

**Coverage:**
- v1 requirements: 71 total
- Mapped to phases: 71
- Unmapped: 0

---
*Requirements defined: 2026-04-20*
*Last updated: 2026-04-20 after roadmap creation*
