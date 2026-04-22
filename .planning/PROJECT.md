# HomeKeep

## What This Is

A self-hosted, open-source household maintenance PWA for couples and families. Every recurring task has a frequency, and HomeKeep spreads the year's work evenly across weeks so nothing piles up and nothing rots. Designed for calm, shared responsibility — not competitive productivity.

## Core Value

The household's recurring maintenance is visible, evenly distributed, and nothing falls through the cracks — without creating anxiety or guilt.

## Current Milestone: v1.1 Scheduling & Flexibility

**Goal:** Give users finer control over WHEN tasks fire — one-off tasks, weekday/weekend constraints, seasonal dormancy, and manual reschedule (snooze + permanent shift) — without breaking v1.0 data, the coverage ring, or the early-completion guard.

**Target features:**
- One-off tasks (`frequency_days` nullable; auto-archive on completion)
- Per-task `preferred_days` constraint (any/weekend/weekday) — scheduler searches forward to land on a matching weekday
- Seasonal tasks (`active_from_month` + `active_to_month`) with cross-year wrap, dormancy-aware coverage, and "Sleeps until" badge
- Manual reschedule via action sheet ("Just this time" → `schedule_overrides` table; "From now on" → mutate `tasks.anchor_date` directly)
- First-run seed offset (stagger first-due dates across cycle via `via='seed-stagger'` synthetic completions, filtered from History/stats/notifications)
- SPEC.md → v0.3 with v1.1 changelog and MIT→AGPL drift fix (also fixes `INFR-12`)

**Key context:** Discovery audit produced `.planning/v1.1/audit.md` (3,800 words) before scoping. All v1.1 migrations are additive and backward-compatible — v1.0.0 installs upgrading via `:1` or `:latest` lose nothing. Phase numbering continues from Phase 8 (no `--reset-phase-numbers`).

## Requirements

### Validated (v1.0)

All 71 v1.0 requirements shipped (AUTH/HOME/AREA/TASK/COMP/VIEW/AREA-V/PERS/HIST/ONBD/NOTF/GAME/INFR — see `MILESTONES.md` and `REQUIREMENTS.md` Traceability for phase mapping). v1.0.0 is tagged and live on GHCR (`:1.0.0`, `:1`, `:latest`).

### Active (v1.1)

See `REQUIREMENTS.md` for full REQ-IDs. Summary:

- [ ] **OOFT** — One-off tasks (Idea 1)
- [ ] **PREF** — Preferred-days hard constraint (Idea 2)
- [ ] **SEAS** — Seasonal tasks with active months (Idea 5, Q2)
- [ ] **SNZE** — Snooze + permanent reschedule via action sheet (Idea 4, Q1)
- [ ] **SDST** — First-run seed-stagger offset (Idea 3)
- [ ] **DOCS** — SPEC.md v0.3 + AGPL drift fix + v1.1 changelog

### Out of Scope

- Calendar integration (iCal, Google Calendar) — different problem space
- Shopping lists / inventory — not home maintenance
- Bill tracking / finance — not home maintenance
- Vendor/contractor contacts — adds complexity without core value
- Multi-tenant SaaS — self-hosted first, always
- Enterprise SSO (OIDC, SAML) — not the target user
- i18n (v1 is English only, strings extractable for later)
- Offline-first write sync — reads cached, writes require connection
- Real-time collaboration / presence — overkill for household app
- Documented public API (deferred to v1.2+)
- Webhooks (deferred to v1.2+)
- Kids/chores mode (post-1.1)
- Area groups (deferred to v1.2+)
- Task rotation (deferred to v1.2+)
- Photo attachments on completion (deferred to v1.2+)
- `preferred_days` as a soft "nudge" — replaced by hard-constraint framing in v1.1 (see audit Idea 2 reshape)

## Context

- Target deployment: Raspberry Pi 4 (8GB) for a single household
- Primary users are couples sharing one home; multi-home is for holiday house / parents' place
- PocketBase provides auth, DB (SQLite), and API out of the box as a single Go binary
- Frontend talks to PocketBase directly from the browser via PB JS SDK (standard pattern, gets realtime for free)
- Both PocketBase and Next.js run in the same Docker container (supervisord or similar process manager)
- ntfy.sh as default notification provider — no SMTP, no VAPID, works on iOS via ntfy app
- Aesthetic: warm, calm, domestic — not a SaaS dashboard. Think well-kept notebook.

## Constraints

- **Tech stack**: Next.js 15 (App Router, standalone), PocketBase, Tailwind + shadcn/ui — specified in SPEC.md
- **Container**: Single Docker image under 300MB, serves both processes
- **Data**: All state in one `./data` volume — backup = copy folder
- **No cloud**: Zero outbound telemetry, no paid APIs, no cloud dependencies
- **No SMTP**: v1 invites are link-only; no email delivery requirement
- **Platform**: Must run on amd64 + arm64 (Pi, Apple Silicon, ARM NAS)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Two-in-one container (PB + Next.js) | Simpler for self-hosters — one container, one compose service | — Pending |
| Direct PB SDK from browser | Standard PocketBase pattern, gets realtime subscriptions for free | — Pending |
| Link-only invites (no SMTP) | Removes config burden for self-hosters; progressive enhancement later | — Pending |
| Equal-weight coverage ring | Formula's overdue_ratio already normalizes by frequency; simpler to reason about | — Pending |
| Last-viewed-home landing | Most users have 1 home; extra picker tap is unnecessary friction | — Pending |
| v1.1: schedule_overrides as collection (not fields) | Snooze history preserved; supports v1.2 "recent reschedules" surface without refactor | — v1.1 Pending |
| v1.1: preferred_days as hard constraint (not nudge) | User intent: "task is too big for a Tuesday, don't put it there"; scheduler searches forward up to +6 days | — v1.1 Pending |
| v1.1: seasonal via two-task-per-season pattern | One task per cadence keeps the data model boring; varying frequency over months is a UX trap | — v1.1 Pending |
| v1.1: action-sheet reschedule, no drag | Mobile-first PWA; 58px Horizon cells make drag fragile; same user problem at half the cost | — v1.1 Pending |
| v1.1: seed-stagger via `completions.via='seed-stagger'` | Smaller schema delta than new field; History/stats/notifications filter on `via` | — v1.1 Pending |
| v1.1: phase numbering continues from 10 | Phases are absolute project milestones, not per-milestone counters. Phases 8 (UX Polish) + 9 (UX Audit Fix) were consumed by post-v1.0.0 polish work between RC1 and v1.1 milestone start; retroactively logged in ROADMAP.md | — v1.1 Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-22 — v1.1 Scheduling & Flexibility milestone started (audit at `.planning/v1.1/audit.md`)*
