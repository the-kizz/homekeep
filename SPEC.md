# HomeKeep — Product Specification

**Version:** 0.5 (v1.2 Red Team Audit & Public-Facing Hardening)
**Status:** Release-ready for v1.2.0
**License:** AGPL-3.0-or-later (see [SECURITY.md](SECURITY.md) for reporting security issues)

---

## 1. One-line pitch

A self-hosted, open-source household maintenance companion for couples and families. Every recurring task has a frequency, and HomeKeep spreads the year's work evenly across weeks so nothing piles up and nothing rots.

## 2. The problem it solves

Existing task apps (Apple Reminders, Todoist, etc.) treat a task due in 365 days the same as a task due today — both clutter the same list. Home maintenance is almost entirely long-cycle recurring work (gutters annually, toilets monthly, benches daily), so existing tools either overwhelm you or you ignore them.

HomeKeep separates **what's due now** from **what's coming eventually**, and turns the whole year into a steady, shared rhythm instead of a guilt pile.

## 3. Core users

- **Primary:** a couple sharing maintenance of one or more homes
- **Secondary:** individuals, families with older kids, anyone who self-hosts and wants ownership of their data
- **Future:** families wanting to involve kids via chore-mode (see §6.3)
- **Not targeting:** property managers, commercial cleaning, team/enterprise use

## 4. Guiding principles

1. **Calm over urgent.** Reduces anxiety, not creates it. No red badges on things that aren't actually overdue.
2. **Shared, not competitive.** Streaks and progress are "us vs. the house," never partner-vs-partner.
3. **Forgiveness built in.** Miss a week? The app redistributes, doesn't scold.
4. **Self-hosted first.** No cloud dependencies, no telemetry, no paid APIs. Runs on a Pi.
5. **Portable.** Your data is one folder. Backup by copying it. Leave any time.
6. **Progressive enhancement.** Works without HTTPS, without notifications, without internet. More features unlock as you add infrastructure.
7. **Cascade, don't repeat.** Set things at the highest sensible level (area, home) and let tasks inherit. Override only when needed.

## 5. Deployment modes (must all work)

The same Docker image serves four scenarios:

| Mode | Setup | HTTPS | PWA install | Push notifs |
|---|---|---|---|---|
| **LAN only** | Default compose, any LAN | ❌ | ❌ | ntfy only |
| **Tailscale** | Sidecar container | ✅ (real cert) | ✅ | ✅ |
| **Public domain** | Caddy + domain | ✅ | ✅ | ✅ |
| **Behind existing proxy** | NPM/Traefik/HAProxy | ✅ (user's cert) | ✅ | ✅ |

The app must **detect insecure context** and gracefully inform the user what's unavailable without breaking core functionality.

## 6. Feature scope

### 6.1 Must have (v1)

- Email/password auth (PocketBase built-in)
- Multiple homes per user
- Share a home with another user (invite by email or shareable link)
- **Areas** within a home (location-scoped or whole-home, see §7.2)
- Tasks with: name, frequency in days, area, optional notes, optional assignee
- **Cascading assignment** (task → area → default-to-anyone, see §7.3)
- Complete a task (records who, when)
- The **three-band main view** + **By Area view** (see §8)
- **Year-view horizon** — calendar strip showing the next 12 months with task distribution
- **Dashboards:** House (areas at-a-glance), Person (your tasks + history), History (timeline)
- Seed task library (see §11) — users accept/reject on first run
- Add custom tasks
- Per-user notification preferences (ntfy topic)
- **Completion model with early-completion guard** (see §8.5)
- Single `./data` volume for all persistence

### 6.2 Should have (v1.1)

- **Area groups** (Inside / Outside / Outbuildings) for properties with 6+ areas
- **Task rotation** — per-task toggle that round-robins between members on completion
- **Documented public API** at `/api/v1/*` for stable integrations
- **Webhooks** — POST on overdue / completion events (Home Assistant, Slack, etc.)
- **Year-in-review** dashboard
- Photo attachment on completion (proof / before-after)
- Task categories (cleaning, maintenance, seasonal) as cross-cutting tags
- Export data as JSON

### 6.3 Could have (later, post-1.1)

- **Kids / chores mode** — restricted account type for under-18s. Parent-defined task pool, optional approval-on-completion, simpler UI, no settings access. Different mental model from adult maintenance — kept separate so it doesn't distort v1.
- **MCP server** — let Claude / other LLMs query a HomeKeep instance ("what's overdue?")
- **Home Assistant native integration** — sensor-triggered tasks, area sync
- Mobile-optimized camera capture for proof photos
- Recurring task templates (seasonal bundles)
- Home Assistant add-on packaging
- i18n (English first, German second)
- Allowance / rewards tracking (only relevant if chores mode ships)

### 6.4 Won't have (explicitly out of scope, ever)

- Calendar integration (iCal export, Google Calendar sync)
- Shopping lists / inventory
- Bill tracking or home finance
- Vendor/contractor contacts
- Property management (tenants, leases)
- Public user accounts / social features
- Multi-tenant SaaS hosting

## 7. Data model

### 7.1 Core entities

```
users (PocketBase auth collection)
  id, email, name, avatar, ntfy_topic, role (adult|kid), created_at

homes
  id, name, address (optional), timezone, created_by, created_at

home_members
  id, home_id, user_id, role (owner|member), joined_at

area_groups (optional, v1.1)
  id, home_id, name, sort_order

areas
  id, home_id, group_id (nullable),
  name, icon, color, sort_order,
  scope (location | whole_home),
  default_assignee (nullable, user_id),
  created_at

tasks
  id, home_id, area_id, name, description,
  frequency_days (integer),
  schedule_mode (cycle | anchored, default: cycle),
  anchor_date (nullable, used when schedule_mode = anchored),
  rotation_enabled (boolean, v1.1),
  category (nullable),
  icon, color,
  assigned_to (nullable, user_id; overrides area default),
  created_by, created_at, archived_at

completions
  id, task_id, completed_by, completed_at, notes, photo (nullable)

invites
  id, home_id, email, token, expires_at, accepted_at
```

### 7.2 Areas: scope and cardinality

Areas describe **where** a task lives. Two scopes:

- **`location`** — a specific place: Kitchen, Bathroom, Backyard, Driveway, Garage, Pool, Roof, Shed
- **`whole_home`** — applies across the entire house: gutters, smoke alarms, pest control, RCD test

Every home has **exactly one** auto-created `whole_home` area on creation (named "Whole Home" or user-set). It cannot be deleted.

**Same logical task can exist either way:**
- Per-location: "Wipe kitchen benches" (Kitchen) + "Wipe bathroom vanity" (Bathroom) — independent schedules
- Whole-home: "Wipe all benches" — single task covering everywhere

User decides based on whether they actually do them at the same time.

### 7.3 Cascading assignment

Three levels, falling through:

```
task.assigned_to ───── if set, wins
       ↓
area.default_assignee ─ if set, applies to all tasks in area
       ↓
"Anyone" ────────────── default; visible to all members
```

**UI shows effective assignee** on each task with a subtle icon distinguishing inherited vs. overridden. Changing an area's assignee updates all tasks that don't have an override.

**"Anyone" semantics:** task appears in everyone's personal view, can be completed by anyone. Notifications go to all members (configurable per user).

### 7.4 Optional area groups (v1.1)

For properties with 6+ areas, groups let users categorize:

```
Smith Residence
├── Inside
│   ├── Kitchen
│   ├── Master Bath
│   └── Living Room
├── Outside
│   ├── Front Yard
│   ├── Backyard
│   └── Driveway
├── Outbuildings
│   ├── Shed
│   └── Garage
└── Whole Home (system, ungrouped)
```

Small homes don't see the grouping UI at all. Pure flat list of areas. Groups appear only when needed.

### 7.5 Key design decisions

- Frequency stored as **integer days**, not recurrence rules. Weekly = 7, monthly = 30, quarterly = 90, yearly = 365. Simple math, no edge cases.
- **Next due date is computed**, never stored. See §8.5 for the formula based on schedule mode.
- **Overdue is a computed state**, not a stored flag.
- Completions are append-only history. Never deleted. Full audit trail.

## 8. UI

### 8.1 Three-band main view (core interaction)

Default screen. Three horizontal sections:

**Band 1: Overdue (top)**
- Only shown if anything is actually overdue
- Warm accent, but not shouting — information, not alarm
- Sorted by days overdue (worst first)
- One-tap complete

**Band 2: This Week**
- 7-day window: today through 6 days from now
- The working list. Where you actually do things.
- Grouped by day if >5 items, flat list otherwise
- Shows who last did it (avatar)

**Band 3: Horizon**
- Next 12 months, calendar-strip style
- Tasks appear as dots/pills in their due month
- Scannable, not actionable — "what's coming" at a glance
- Tap a month to see its tasks; tap a task to complete early or reschedule

**Persistent top element: Coverage ring**
- Single number: % of annual maintenance on track
- Formula: weighted average of `(1 - overdue_ratio)` across all tasks. Perfect schedule = 100%. Half overdue by full cycle = ~50%.
- Updates live as tasks are completed
- The "how's the house doing" number

### 8.2 By Area view

Equal-weight alternative to the main view. Tappable from bottom nav.

- One card per area (Kitchen, Bathroom, Backyard, Whole Home, etc.)
- Each card shows: area name, icon, coverage %, count of overdue/due-this-week/upcoming
- Tap into an area to see all its tasks
- "Whole Home" card pinned to top
- Visually scannable — the "which part of the house needs love" view

### 8.3 Person view

Tappable from bottom nav or your avatar.

- Tasks effectively assigned to you (via cascade)
- Your completion history
- Your personal streak / contribution to household stats
- Notification preferences

### 8.4 History view

Timeline of recent activity across the household.

- "Alex completed Wipe benches • 2 hours ago"
- "Sam completed Mow lawn • yesterday"
- Filterable by person, area, time range
- Settles the "did you ever actually do that?" conversation

### 8.5 Completion model & early-completion guard

**Default mode: cycle (`schedule_mode: cycle`)**
Next due = `last_completion + frequency_days`.
Doing it today resets the cycle from today.

Matches how cleaning works: a clean bench stays clean ~3 days regardless of when you cleaned it last.

**Optional mode: anchored (`schedule_mode: anchored`)**
Next due = next scheduled date in fixed series (anchor + N × frequency_days).
Doing it early doesn't shift the schedule.

Useful for things tied to fixed cadence: quarterly air-con service, annual smoke alarm test, monthly bills.

User picks per task. Default is cycle.

**Early-completion guard (both modes):**
If user completes a task when less than 25% of the cycle has elapsed since the last completion, prompt:

> *"Wipe benches was last done 1 day ago, every 3 days. Mark done anyway?"*
> [Cancel] [Mark done]

Catches accidental double-taps and "did my partner already do this?" cases without nagging on legitimate early completions.

### 8.6 Dashboards summary

| View | Purpose |
|---|---|
| Three-band (default) | What needs doing now and soon |
| By Area | How each part of the home is doing |
| Person | What you specifically own + your history |
| History | Household activity timeline |
| Year-in-review (v1.1) | December summary — counts, streaks, milestones |

All views read the same data. No precomputed aggregates that could go stale.

## 9. Gamification rules

Light-touch. Must feel warm, not Duolingo.

**In:**
- Household streak: consecutive weeks where at least one task was completed. Shared between all members.
- Per-area coverage percentages (Kitchen 100%, Backyard 60%)
- Weekly summary (Sunday): "Together you did 14 tasks this week. The house is 73% maintained."
- Small celebration when an area first hits 100% coverage, or when a long-overdue task finally gets done
- "Most neglected" card: the one task most overdue. Gentle nudge, not shame.

**Out:**
- Points, XP, levels
- Leaderboards between household members (never compete with your partner)
- Badges for trivial stuff
- Daily streak pressure (weekly is humane, daily is toxic)
- Push notifications for gamification events (opt-in only)

**Note:** competitive gamification (leaderboards, points) is reserved for kids/chores mode (§6.3). Adult household view stays cooperative.

## 10. Notifications

**Primary mechanism: ntfy.** Works everywhere, no VAPID keys, no service worker complexity, no iOS PWA gotchas.

- Each user gets a unique ntfy topic (e.g., `homekeep-a7f3k2`)
- Default server: `https://ntfy.sh` (public, free, works out of the box)
- Configurable to self-hosted ntfy via `NTFY_URL` env var
- User installs ntfy app on phone, subscribes to their topic, done

**When notifications fire:**
- Task becomes overdue (once, not repeatedly)
- Task assigned to you specifically
- Partner completes a task (optional, off by default)
- Sunday weekly summary (opt-in)
- User-set reminders on specific tasks

**Trigger mechanism:** in-app scheduler (node-cron or similar) runs hourly, checks for newly-overdue tasks, posts to ntfy. No external job queue.

## 11. Seed task library

First-run wizard offers a starter set. User ticks what applies, sets frequency (defaults provided), assigns to areas. All editable after.

Each task has a suggested area scope. User can override.

### Kitchen *(location)*
- Wipe benches (1 day)
- Mop floor (7 days)
- Clean microwave (14 days)
- Clean oven (90 days)
- Clean rangehood filter (30 days)
- Descale kettle (60 days)
- Clean dishwasher filter (30 days)
- Clean fridge interior (30 days)

### Bathroom *(location)*
- Clean toilet (7 days)
- Clean shower (7 days)
- Clean mirrors (7 days)
- Clean sink (3 days)
- Wash bath mats (14 days)
- Deep clean grout (180 days)

### Living areas *(location)*
- Dust surfaces (14 days)
- Vacuum (7 days)
- Mop hard floors (14 days)
- Wipe down cabinets / dust cabinet tops (30 days)
- Wash windows inside (90 days)
- Wash curtains (180 days)

### Front yard / Backyard *(location, separate areas)*
- Mow lawn (14 days) *seasonal-adjust later*
- Trim hedges (60 days)
- Weed garden beds (14 days)
- Edge paths (30 days)

### Whole Home *(scope: whole_home)*
- Clean gutters (180 days)
- Wash windows outside (180 days)
- Pressure-wash paths (365 days)
- Service air-con (365 days, anchored)
- Check smoke alarm batteries (180 days, anchored)
- Test RCD / safety switch (90 days, anchored)
- Pest inspection (365 days, anchored)
- Wash sheets (14 days)
- Vacuum mattresses (90 days)
- Flip / rotate mattresses (180 days)
- Clean washing machine (60 days)

**Add-your-own** is front-and-centre. Users will think of things unique to their property (pool, firewood, bore pump, chickens, septic, solar inverter check, etc.).

## 12. API

Three tiers, shipped progressively.

### v1: PocketBase API (undocumented but available)
PocketBase exposes a full authenticated REST + realtime API automatically. Power users can query everything. No stability guarantees — schema may change between versions.

### v1.1: Documented public API (`/api/v1/*`)
Thin REST layer on top, with stable contracts:
- `GET /api/v1/tasks?status=overdue`
- `POST /api/v1/tasks/{id}/complete`
- `GET /api/v1/areas/{id}/coverage`
- `GET /api/v1/homes/{id}/summary`

Plus **webhooks**:
- `task.overdue` — fires when a task crosses into overdue
- `task.completed` — fires on completion
- `area.full_coverage` — fires when area hits 100%

User-configurable webhook URLs in settings. Enables Home Assistant ("the bins still haven't gone out"), Slack/Discord pings, Node-RED flows, anything.

### v2: MCP server (could-have)
Native Model Context Protocol server so LLMs can query and act on a HomeKeep instance:
- "Hey Claude, what's overdue at home?"
- "Mark gutters as done"

Useful for voice integrations, AI assistants. Still self-hosted, still local-first.

## 13. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend + API | Next.js 15 (App Router, TypeScript, standalone output) | Single process, small image |
| Styling | Tailwind + shadcn/ui | Own the components, no runtime deps |
| DB + Auth | PocketBase (single Go binary, SQLite) | One file to back up, embedded auth |
| Notifications | ntfy (external, configurable) | Simplest notification story that works on iOS |
| Container base | `node:22-alpine` | Small, maintained |
| Reverse proxy | Caddy (optional, in `docker-compose.caddy.yml`) | Only for public-domain mode |
| Private HTTPS | Tailscale sidecar (optional) | Best mode for couples/families |
| CI/CD | GitHub Actions → GHCR | Free, multi-arch (amd64 + arm64) |

## 14. Repository layout

```
homekeep/
├── .claude/
│   ├── skills/
│   │   ├── gsd-*/              # installed via npx
│   │   └── ui-ux-pro-max/      # cloned
├── .planning/                  # GSD specs, phases
├── .github/workflows/
│   ├── ci.yml                  # lint, test on PR
│   └── release.yml             # multi-arch build → GHCR on tag
├── app/                        # Next.js App Router
├── components/
├── lib/
│   ├── db.ts                   # PocketBase client
│   ├── scheduler.ts            # ntfy trigger cron
│   ├── coverage.ts             # the health % calc
│   └── assignment.ts           # cascade resolution logic
├── public/
│   ├── manifest.json           # PWA
│   └── icons/
├── pocketbase/
│   └── pb_migrations/          # schema as code
├── docker/
│   ├── Dockerfile              # multi-stage
│   ├── docker-compose.yml          # LAN-only (default)
│   ├── docker-compose.caddy.yml    # + Caddy for public domain
│   ├── docker-compose.tailscale.yml # + Tailscale sidecar
│   └── Caddyfile.example
├── .env.example
├── LICENSE                     # AGPL-3.0-or-later
├── README.md
├── DEPLOYMENT.md               # per-platform recipes
└── SPEC.md                     # this file
```

## 15. Docker + distribution requirements

- **Multi-arch image:** `linux/amd64` + `linux/arm64` (Raspberry Pi, Apple Silicon, ARM NAS)
- **Final image target:** under 320MB (v1.1 growth: ~9MB for 8 new shadcn UI components including Collapsible + Dialog variants, @radix-ui/react-collapsible, 4 new pb_migrations + expanded pb_hooks; further optimization deferred to v1.2)
- **Single data volume:** `./data` contains PocketBase DB + uploaded photos. Backup = copy folder.
- **Health check:** `/api/health` endpoint for Docker / Uptime Kuma
- **Env-driven config:** no hardcoded URLs, paths, or secrets in the image
- **Published on GHCR:** `ghcr.io/{owner}/homekeep:latest` and `:v{semver}` on tag
- **Watchtower-friendly:** proper labels for auto-update
- **First-run:** admin bootstraps on first visit (no default creds in image)

## 16. Security

- PocketBase handles auth, password hashing (bcrypt), rate limiting on login
- HTTPS strongly recommended but not required for LAN use
- All secrets via env vars, never committed
- `.env.example` shows structure, real `.env` git-ignored
- CSP headers appropriate for PWA
- No outbound telemetry. Ever.
- Ntfy topic IDs are long random strings (effectively unguessable) — acts as the auth for notifications
- Webhook URLs (v1.1) stored encrypted at rest

## 17. Non-goals for v1

Explicit list of what we are NOT doing in v1:

- Mobile native apps (PWA is enough)
- Social / public sharing features
- Marketplace, plugin system, theming
- Multi-tenant SaaS deployment
- Enterprise SSO (OIDC, SAML)
- Full i18n (ship English, leave strings extractable)
- Offline-first write sync (reads cached, writes require connection)
- Real-time collaboration cursors / presence
- Documented public API (v1.1)
- Webhooks (v1.1)
- Kids/chores mode (post-1.1)
- Area groups (v1.1 — flat area list in v1)
- Task rotation (v1.1)

## 18. Success criteria (how we know v1 is done)

1. Fresh Ubuntu VM + Docker installed. Clone repo, `docker compose up -d`. In 5 minutes, working app on `http://ip:3000`.
2. Two users, one shared home, 20 seed tasks across 4 areas (including Whole Home), can complete tasks and see all views populate correctly.
3. Cascading assignment works: set area assignee → tasks inherit. Override at task → wins. Clear at task → falls back to area.
4. Early-completion guard prompts when expected, doesn't prompt on normal completion.
5. Overdue task triggers ntfy notification on phone within 1 hour.
6. Stop containers, back up `./data`, delete everything, restore folder, start containers. All state intact.
7. Coverage ring math correct (spot-check with manually calculated scenarios).
8. Pi 4 (8GB) can run it comfortably for a single-home deployment.
9. Public GitHub repo, AGPL-3.0-or-later license, published Docker image, working GitHub Actions release pipeline.

## 19. Design direction (for UI/UX Pro Max skill)

When the UX skill activates, here's the aesthetic brief:

- **Mood:** warm, calm, domestic. Think a well-kept notebook, not a productivity dashboard.
- **Avoid:** dark-mode-first "SaaS cockpit" look, neon accents, aggressive gradients, generic AI-styled landing pages, leaderboard / competitive framing
- **Prefer:** soft neutrals with one warm accent color, generous whitespace, rounded corners (not pill-shaped), readable serif or humanist sans for headings, system sans for UI
- **Micro-interactions:** completion should feel satisfying (subtle haptic-equivalent animation), not gamified sparkle
- **Icons:** lucide-react, consistent stroke weight, no emoji-as-UI
- **Mobile-first:** designed for phone held one-handed while standing in a kitchen
- **Dark mode:** yes, but as a true alt theme, not the default
- **Areas should feel like places**, not categories — color/icon per area, scannable at a glance (the "By Area" view is where this matters most)

---

## Build phases (for GSD)

Rough sketch — GSD will refine.

**Phase 0 — Repo scaffold**
Init Next.js, Tailwind, shadcn/ui, PocketBase, base Dockerfile, compose, CI. Goal: `docker compose up` shows a hello page.

**Phase 1 — Auth + single home, single user**
PocketBase schema (homes, areas with scope, tasks, completions), auth pages, add/complete tasks in one home. Whole Home auto-creation. Ugly but functional.

**Phase 2 — The three-band UI + By Area view + coverage**
UX Pro Max owns this phase. Design system + three-band view + By Area cards + coverage ring + completion flow with early-completion guard.

**Phase 3 — Multi-home + sharing + cascading assignment**
Homes CRUD, invites, member management. Area-level + task-level assignment with cascade resolution. Person view.

**Phase 4 — Seed library + first-run wizard**
Task library JSON (with scope hints), onboarding flow, area creation guidance.

**Phase 5 — ntfy + scheduler + History view**
Hourly cron, overdue detection, assignment notifications, history timeline.

**Phase 6 — Gamification + polish**
Streaks, area coverage celebrations, weekly summary, "most neglected" card, dark mode, accessibility pass.

**Phase 7 — Deployment variants + docs + release**
Caddy compose, Tailscale compose, README, DEPLOYMENT.md, multi-arch CI, first tagged release (`v1.0.0`).

---

**End of spec.** This document is the source of truth for v1. Changes go through revisions of this file. Version bump on material changes.

---

## Changelog

### v0.5 — Red Team Audit & Public-Facing Hardening (2026-04-24)

Material spec bump (v0.4 → v0.5) for the v1.2-security milestone. No new
user-visible features; every change tightens the attack surface, the
supply-chain posture, or the operator-facing security documentation.
Ships as `v1.2.0`. All migrations are additive; v1.1 installs upgrading
via `:1` or `:latest` lose no data. Anchored-mode / cycle-mode scheduling
semantics are byte-identical to v1.1.

**Discovery (v1.2-security research, 4 reports):**
- `auth-access-control.md` — authentication, authorization, session lifecycle
- `attack-surface.md` — server actions, PB collections, API routes, hooks
- `public-facing-hardening.md` — transport, headers, rate limits, deployment
- `supply-chain.md` — image signing, SBOM, provenance, action pinning

All reports landed 2026-04-22 and drove the 35-REQ-ID plan split across
Phases 22-28.

**Emergency hotfix (Phase 22, HOTFIX-01..03):**
- HOTFIX-01: internal + external Caddy now block `/_/*`,
  `/api/_superusers`, `/api/_superusers/*`, and
  `/api/collections/_superusers/*` with 404. `ALLOW_PUBLIC_ADMIN_UI=true`
  env flag is the only bypass.
- HOTFIX-02: VPS `PB_ADMIN_PASSWORD` and `ADMIN_SCHEDULER_TOKEN` rotated
  via `openssl rand`; `docker/.env` pinned to mode `600`.
- HOTFIX-03: GitHub PAT rotation guidance documented; user action to
  swap the classic PAT for a fine-grained one.

**Code attack surface (Phase 23, SEC-01..07):**
- SEC-01: parameterised every `pb.filter(...)` call site across
  `app/**/*.tsx` + `lib/**/*.ts` (15 files, 27 sites). Template-literal
  filter strings are now impossible to regress via grep gate.
- SEC-02: new migration `1745280004_schedule_overrides_body_check.js`
  adds `@request.body.created_by_id = @request.auth.id` to
  `schedule_overrides.createRule`, preventing audit-trail forgery by a
  home member.
- SEC-03: `app/api/admin/run-scheduler/route.ts` token compare replaced
  `!==` with `crypto.timingSafeEqual` plus length pre-check. Byte-by-byte
  timing oracle closed.
- SEC-04: `updateTask` now cross-verifies `area_id.home_id` against the
  task's `home_id`, matching the `createTaskAction` invariant. Rejects
  attempts to re-home a task into a second-home area.
- SEC-05: new PB hook `users_last_viewed_home_membership.pb.js` + existing
  action-layer `assertMembership` close the IDOR on
  `users.last_viewed_home_id` for direct-SDK writes.
- SEC-06: signup + reset-confirm password minimum raised 8 → 12 chars.
  Login floor kept at 8 so existing users are not locked out. 12 E2E
  specs updated to the new minimum.
- SEC-07: `app/(app)/layout.tsx` swapped to
  `createServerClientWithRefresh()`. Stale / revoked tokens now reject at
  render time with a redirect to `/login`.

**HTTP headers + transport (Phase 24, HDR-01..04):**
- HDR-01: `next.config.ts` `headers()` export adds CSP-Report-Only, HSTS
  (HTTPS only), X-Frame DENY, X-Content-Type nosniff, Referrer-Policy
  strict-origin-when-cross-origin, and Permissions-Policy all-off to
  every response.
- HDR-02: same 5 headers mirrored at the Caddy layer —
  `docker/Caddyfile` (internal) + `docker/Caddyfile.prod` (external,
  adds HSTS). `-Server` and `-X-Powered-By` stripped on both layers.
- HDR-03: new `/api/csp-report` endpoint accepts browser violation POSTs,
  logs to stdout with `[CSP-REPORT]` prefix (capped at 4096 chars), always
  returns 204. Builds a 30-day soak corpus for the future enforced-CSP flip.
- HDR-04: `HK_BUILD_STEALTH=true` env flag redacts the `HomeKeep-Build`
  response header, `<meta name="hk-build">` tag, and
  `/.well-known/homekeep.json` `build` field to the literal `hk-hidden`.
  Read on every request — toggle without rebuilding the image.

**Rate limits + abuse prevention (Phase 25, RATE-01..06):**
- RATE-01: per-owner row quotas via `lib/quotas.ts` —
  `MAX_HOMES_PER_OWNER` (default 5), `MAX_TASKS_PER_HOME` (default 500,
  archived exempt), `MAX_AREAS_PER_HOME` (default 10, Whole Home exempt).
  Enforced at the server-action layer (PB JSVM hooks were infeasible due
  to 0.37.1 handler dispatch quirks — documented in phase summary).
- RATE-02: new PB rate-limit bucket `users:create` → 10 req/60s per IP
  guest. Replaces the prior generic `/api/` 300/60s fallback on signup.
- RATE-03: invite-accept action (`lib/actions/invites.ts`) gains a
  sliding-window per-IP limiter (5/60s) plus a 3-strike per-token lockout
  with 1h cool-down. In-memory, reset on container restart.
- RATE-04: new PB rate-limit bucket `users:confirmPasswordReset` →
  5 req/60s per IP guest.
- RATE-05: `*:authWithPassword` bucket tightened 60/60s → 20/60s per IP.
  Dictionary attacks against a 6-char password set now take ~14 days
  per IP instead of ~4.5.
- RATE-06: ntfy topic schema raised to `min 12 chars AND ≥1 digit`.
  Guessable-topic risk (noted in M-4 of the research) closed for new
  preferences; grandfathered for existing users.

**Demo instance architecture (Phase 26, DEMO-01..05):**
- DEMO-01: new `docker/docker-compose.demo.yml` overlay — tmpfs
  `/app/data` (256 MB cap, state never touches disk); sets
  `DEMO_MODE=true`, `DISABLE_SCHEDULER=true`, `HK_BUILD_STEALTH=true`,
  `NTFY_URL=""`; image pinned via `GHCR_OWNER` + `TAG` env vars. Paired
  `docker/.env.demo` template forces `PB_ADMIN_PASSWORD` rotation before
  first `compose up`.
- DEMO-02: `lib/demo-session.ts::ensureDemoSession()` + new
  `/api/demo/session` route. First visit mints a throwaway user
  (random 12-char hex), creates "Demo House" + Kitchen + Outdoor +
  Whole Home areas, batch-seeds 15 tasks in one `pb.createBatch`
  transaction, and 303-redirects to `/h/<homeId>` with `pb_auth` + a
  24h `homekeep_demo_session` cookie. Resume path re-mints `pb_auth` via
  PB 0.22+ `users.impersonate(userId, 86400)`. Migration
  `1745280006_demo_flag.js` adds `users.is_demo BOOL` +
  `users.last_activity DATETIME`.
- DEMO-03: `pb_hooks/demo_cleanup.pb.js` cron runs every 15 minutes.
  Two-pass sweep: idle (`last_activity < now-2h`) + absolute
  (`created < now-24h`); deletes homes before users so `cascadeDelete=true`
  propagates to tasks / areas / completions / members / overrides.
  Defense-in-depth per-row `is_demo === true` re-check inside the delete
  loop. PB datetime-format quirk (space-separated stored vs ISO-T emitted)
  documented and patched (`.replace('T', ' ')` on both cutoff strings).
- DEMO-04: `components/demo-banner.tsx` (server) +
  `components/demo-banner-dismissible.tsx` (client) — amber banner above
  `{children}` in `app/layout.tsx`, dismissal persisted to
  `localStorage['dismissed_demo_banner']`. Zero bytes shipped to
  non-demo clients (`DEMO_MODE !== 'true'` returns `null`).
- DEMO-05: `docker/Caddyfile.demo` — dedicated block for
  `homekeep.demo.the-kizz.com` with the Phase 24 header set. NO
  `ALLOW_PUBLIC_ADMIN_UI` escape hatch; the admin UI is always 404 on
  demo hosts. `docs/deployment.md` gains a 60-line "Deploying a public
  demo" section covering DNS, `.env.demo` rotation, compose chain,
  verification, and tear-down.

**Supply chain hardening (Phase 27, SUPPLY-01..06):**
- SUPPLY-01: cosign keyless image signing via GitHub OIDC. New step in
  `.github/workflows/release.yml` signs every `ghcr.io/.../homekeep@<digest>`
  after the push, binding the signature to the workflow identity. No
  long-lived keys; consumers verify with
  `cosign verify --certificate-identity-regexp '...release.yml@' --certificate-oidc-issuer 'https://token.actions.githubusercontent.com'`.
- SUPPLY-02: SPDX SBOM + SLSA-3 provenance attached to every build via
  BuildKit's native `sbom: true` + `provenance: mode=max` flags on
  `docker/build-push-action`. Applied to both `release.yml` and
  `edge.yml` — the bleeding-edge channel gets the same attestations.
- SUPPLY-03: every GitHub Action in release.yml / ci.yml / edge.yml
  replaced floating-major refs (`@v6`, `@v4`) with full 40-char commit
  SHAs + trailing `# v<tag>` comment. New `.github/dependabot.yml`
  schedules weekly updates for both `github-actions` and `docker`
  ecosystems. Grep gate: `uses:\s+\S+@v\d+\s*$` returns no matches.
- SUPPLY-04: `docker/Dockerfile` base images digest-pinned via
  `ARG NODE_DIGEST=sha256:...` + `ARG CADDY_DIGEST=sha256:...` applied
  to all three FROM stages and the Caddy `COPY --from=` step
  (inlined because `COPY --from=` does not interpolate ARGs).
- SUPPLY-05: `scripts/dev-pb.js` now fetches
  `pocketbase_<ver>_checksums.txt` from the same release and verifies
  the downloaded zip's SHA-256 via streaming
  `crypto.createHash('sha256')` before extracting / chmod+x. Mismatch
  deletes the zip and exits 1. Helpers (`expectedSha256`, `sha256File`)
  refactored to be importable without spawning PB, enabling 8-case unit
  coverage in `tests/unit/dev-pb-checksum.test.ts`.
- SUPPLY-06: `NEXT_TELEMETRY_DISABLED=1` set in the Dockerfile builder
  stage, runtime stage, and `docker-compose.yml`. CI build no longer
  phones home to `telemetry.nextjs.org`; running containers emit no
  telemetry.

**Documentation + responsible disclosure (Phase 28, SECDOC-01..04):**
- SECDOC-01: `SECURITY.md` at repo root — supported versions, threat
  model summary (what HomeKeep protects, what it doesn't, deployment
  model assumptions), reporting a vulnerability (email + PGP
  placeholders for maintainer to fill, 7-day ack + 90-day fix SLA),
  scope / out-of-scope, safe-harbor clause modelled on Dropbox + GitHub,
  empty advisories table (all v1.2-security findings fixed
  pre-publication).
- SECDOC-02: `docs/deployment-hardening.md` — 15-item operator checklist
  for public-facing install. Each item has description, why it matters,
  how (command + config), and verify step. Covers DOMAIN + Caddy, secret
  generation, `.env` perms, admin-UI edge block, security headers,
  firewall, stealth build-id, row quotas, 90-day rotation, CSP reports,
  release feed, and `cosign verify`.
- SECDOC-03: README gains a "Security" section linking SECURITY.md.
  SPEC.md License line appends a SECURITY.md reference.
  `docs/deployment.md` gains a "Public deployment hardening" subsection
  linking the new checklist.
- SECDOC-04: this changelog section + SPEC.md version bump (0.4 → 0.5)
  and status line update.

**Test delta:**
- Phase 22: 0 (ops + config only)
- Phase 23: +19 (629 total)
- Phase 24: +8 (637 total)
- Phase 25: +22 (659 total)
- Phase 26: +5 (664 total)
- Phase 27: +8 (672 total)
- Phase 28: 0 (pure docs)
- v1.2-security cumulative: +62 tests (610 pre → 672 post)

**Deferred (captured in phase summaries, not blocking v1.2.0):**
- Real PGP key for security@ contact (placeholder ships with v1.2.0;
  user generates the key post-release)
- HackerOne / Bugcrowd listing (evaluate for v1.3+)
- Numbered advisory site at a dedicated domain (v1.3+)
- CSP flip from Report-Only to enforced (needs 30-day soak corpus;
  target v1.2.1)
- DNS-01 wildcard cert via GoDaddy plugin for `*.demo.the-kizz.com`
  (currently operator manual DNS; target v1.3)

### v0.4 — v1.1 Scheduling & Flexibility (2026-04-22)

Material spec bump (v0.3→v0.4) because the LOAD addendum changes the scheduling thesis. Ships as `v1.1.0-rc1`. All v1.1 migrations are additive; v1.0 installs upgrading via `:1` or `:latest` lose no data. Anchored-mode tasks remain byte-identical to v1.0 (the explicit opt-out from smoothing).

**Data model (Phases 10, 11, 12, 15):**
- `tasks.frequency_days` is now nullable (previously required) — enables one-off (OOFT) tasks
- `tasks.due_date DATE NULL` — explicit due date for one-off tasks (required when `frequency_days IS NULL`)
- `tasks.preferred_days` (nullable enum `any | weekend | weekday`) — hard narrowing constraint on placement
- `tasks.active_from_month INT? (1..12)` + `tasks.active_to_month INT? (1..12)` — seasonal active window; both null = year-round; cross-year wrap supported (e.g. Oct-Mar means Oct through March inclusive)
- `tasks.next_due_smoothed DATE NULL` — LOAD smoother's chosen date; null falls back to natural cadence
- `tasks.reschedule_marker TIMESTAMP NULL` — set by SNZE "From now on"; REBAL reads it to preserve the task; cleared on rebalance apply
- New `schedule_overrides` collection `(id, task_id, snooze_until, consumed_at, created)` — per-task snooze history with member-gated rules and atomic consumption on completion

**Scheduler — `computeNextDue` 6-branch composition (documented order):**
1. Archived → `null`
2. Override (Phase 10) → `override.snooze_until` when active + unconsumed + `snooze_until > lastCompletion.completed_at` (D-10 read-time filter)
3. Smoothed (Phase 12) → `next_due_smoothed` when set AND task not anchored AND not about to wake from seasonal dormancy
4. Seasonal-dormant (Phase 11) → `null` when task has active window AND current month is outside it AND lastCompletion is in the current/recent season
5. Seasonal-wakeup (Phase 11) → `nextWindowOpenDate(now, from, to, tz)` when waking up (no completion OR prior-season completion)
6. OOFT (Phase 11) → `task.due_date` if no completion, else `null` (completed OOFT is atomically archived)
7. Natural cycle/anchored — existing v1.0 behavior for cycle tasks (`lastCompletion + frequency_days`) or anchored tasks (`anchor_date + k × frequency_days`)

**LOAD placement algorithm (Phase 12, REQ LOAD-01..15):**
- Pure helpers `placeNextDue(task, householdLoad, now, opts)` and `computeHouseholdLoad(tasks, now, windowDays): Map<ISODate, number>` in `lib/load-smoothing.ts`
- Tolerance window: `min(0.15 × frequency_days, 5)` days each side of natural ideal (rider 1: validated against 30-task household; ships at 5-day cap)
- Pipeline: generate candidates (natural_ideal ± tolerance) → apply `narrowToPreferredDays` (hard PREF constraint) → if empty, widen forward +1..+6 days → score by load map → pick by tiebreakers
- Tiebreakers: lowest `householdLoad[date]` → closest-to-ideal → earliest (fully ordered, deterministic)
- Forward-only contract: `placeNextDue` returns a Date for the argument task ONLY; no other task's `next_due_smoothed` mutated. Sibling convergence is eventual (on their own next completion)
- Anchored tasks bypass smoothing entirely (LOAD-06) but still contribute to the household load map for other tasks' placement
- OOFT tasks contribute `1` to the load map on their `due_date` but their own `next_due_smoothed` is never written (LOAD-09)
- Smoother runs on task creation (Phase 13 TCSEM) AND on task completion (Phase 12); each invocation is a single atomic `pb.createBatch`
- Performance budget: single placement < 100ms for 100-task household (observed 4ms; 25× headroom)

**Task creation semantics (Phase 13, TCSEM-01..07):**
- Task form "Advanced" collapsible surfaces optional "Last done" date; smart defaults otherwise (≤7d → tomorrow; 8-90d → cycle/4; >90d → cycle/3)
- `createTaskAction` computes first_ideal → places via LOAD → writes `next_due_smoothed` atomically in the same batch as the task row
- `batchCreateSeedTasks` threads an in-memory load Map between seeds so a cohort of onboarding seeds distributes naturally
- SDST (seed-stagger via synthetic completions) removed entirely — replaced by TCSEM

**Snooze & permanent reschedule (Phase 10 + 15, SNZE-01..10):**
- `<RescheduleActionSheet>` opens from BandView / PersonTaskList / TaskDetailSheet; date picker defaults to natural next due; radio toggles "Just this time" / "From now on"
- "Just this time" → writes `schedule_overrides` row (Phase 10 atomic-replace-active: second writer consumes predecessor in same batch). Consumption happens at completion atomically.
- "From now on" → mutates `tasks.anchor_date` (anchored mode) or `tasks.next_due_smoothed` (cycle mode) with `reschedule_marker = now`. No override row written.
- `<ExtendWindowDialog>` warns when snooze date lands outside the task's active seasonal window — user picks Cancel / Extend / Continue anyway

**Seasonal UI (Phase 14, SEAS-06..10):**
- Task form "Active months" subsection (from/to month dropdowns) with paired-or-null validation
- Anchored-warning Alert when >50% of projected cycles fall outside the active window (non-blocking)
- Dormant tasks render dimmed with "Sleeps until `MMM yyyy`" badge in BandView / PersonTaskList / By Area; rows are silent no-op on tap
- Coverage ring excludes dormant tasks from its mean (SEAS-05)
- History view shows completions regardless of current dormancy state (SEAS-10)
- Seed library extends with 2 seasonal pairs (mowing warm/cool; HVAC summer/winter)

**Horizon density visualization (Phase 16, LVIZ-01..05):**
- HorizonStrip month cells render density tint (`bg-primary/10`, `/30`, `/50`) scaling with per-month task count
- `<ShiftBadge>` (⚖️ emoji + tooltip) appears on any task whose `next_due_smoothed` differs from its natural ideal by ≥1 day
- TaskDetailSheet "Schedule" section shows Ideal vs Scheduled dates side-by-side when displaced; hidden when equal

**Manual rebalance (Phase 17, REBAL-01..07):**
- Settings → Scheduling → "Rebalance schedule" button opens a counts-only preview Dialog
- 4-bucket classifier (priority: anchored > active-override > from-now-on marker > rebalanceable)
- Apply: fresh `computeHouseholdLoad` → re-place rebalanceable bucket in ascending ideal-date order, threading the in-memory load map between placements; clear `reschedule_marker` on from-now-on bucket after preservation; single atomic `pb.createBatch`
- Second consecutive rebalance is a no-op on date values (deterministic, stable)

**Documentation (Phase 18):**
- License corrected MIT → AGPL-3.0-or-later throughout SPEC.md and PROJECT.md
- This changelog section

### v0.2

Added cascading assignment model (task → area → anyone). Renamed "rooms" to "areas" with scope (location vs. whole_home). Auto-created Whole Home area per home. Added completion model with early-completion guard (cycle vs. anchored modes). Added By Area, Person, History dashboards. Added API tier plan (PocketBase v1, documented + webhooks v1.1, MCP v2). Parked kids/chores mode as v1.2+. Added optional area groups for v1.1. Added rotation toggle for v1.1.

### v0.1

Initial spec.
