# HomeKeep

## What This Is

A self-hosted, open-source household maintenance PWA for couples and families. Every recurring task has a frequency, and HomeKeep spreads the year's work evenly across weeks so nothing piles up and nothing rots. Designed for calm, shared responsibility — not competitive productivity.

## Core Value

The household's recurring maintenance is visible, evenly distributed, and nothing falls through the cracks — without creating anxiety or guilt.

## Current Milestone: v1.1 Scheduling & Flexibility

**Goal:** Deliver the SPEC thesis — *"spread the year's work evenly across weeks so nothing piles up"* — by making tasks know about each other. Per-task flexibility (one-off, preferred-days, seasonal, snooze) becomes the substrate; household-global LOAD smoothing is the user-visible payoff.

**Target features:**
- **LOAD** — Household load-aware placement algorithm replacing naive `last_completion + frequency_days`. Stored per-task in nullable `tasks.next_due_smoothed`. Forward-only; <100ms for 100 tasks.
- **LVIZ** — Horizon density visualization + ⚖️ badge on shifted dates (UI honesty)
- **TCSEM** — Task creation semantics with optional "Last done" field + smart-default first-due based on cycle length. Subsumes the v1.0 onboarding clumping problem (no synthetic completions needed)
- **REBAL** — Manual rebalance escape hatch in Settings (counts-only preview; honors anchored, snoozes, "From now on" intent)
- **OOFT** — One-off tasks (data model TBD in Phase 11 discuss per rider 2)
- **PREF** — Per-task preferred-days as LOAD-narrowing hard constraint
- **SEAS** — Seasonal tasks with `active_from_month`/`to_month`, cross-year wrap, dormancy-aware coverage, "Sleeps until" badge
- **SNZE** — Snooze + permanent reschedule action sheet (`schedule_overrides` collection; "From now on" mutates anchor or smoothed date with marker flag for REBAL preservation)
- **DOCS** — SPEC.md → **v0.4** with full v1.1 changelog and MIT→AGPL drift fix (also fixes `INFR-12`)

**Key context:** Discovery audit (`.planning/v1.1/audit.md`, 3,800 words) plus addendum (`.planning/v1.1/audit-addendum-load.md`, 3,400 words, 3 riders approved) before scoping. All v1.1 migrations additive and backward-compatible — v1.0.0 installs upgrading via `:1` or `:latest` lose nothing. v1.0 task data is not modified; smoothing adopts at next post-upgrade completion. Anchored-mode tasks remain byte-identical to v1.0 (the explicit opt-out from smoothing). Phase numbering continues from Phase 10 (Phase 8/9 were post-v1.0.0-rc1 UX polish).

## Requirements

### Validated (v1.0)

All 71 v1.0 requirements shipped (AUTH/HOME/AREA/TASK/COMP/VIEW/AREA-V/PERS/HIST/ONBD/NOTF/GAME/INFR — see `MILESTONES.md` and `REQUIREMENTS.md` Traceability for phase mapping). v1.0.0 is tagged and live on GHCR (`:1.0.0`, `:1`, `:latest`).

### Active (v1.1)

See `REQUIREMENTS.md` for full REQ-IDs (69 total). Summary:

- [ ] **LOAD** (15) — Household load-aware scheduler (the thesis-deliverer)
- [ ] **LVIZ** (5) — Horizon density visualization + ⚖️ shift badges
- [ ] **TCSEM** (7) — Task creation semantics + smart-default first-due (subsumes SDST)
- [ ] **REBAL** (7) — Settings → "Rebalance schedule" minimal v1.1 surface
- [ ] **OOFT** (5) — One-off tasks (3 draft REQs pending Phase 11 discuss decision)
- [ ] **PREF** (4) — Preferred-days as LOAD-narrowing constraint
- [ ] **SEAS** (10) — Seasonal tasks with active months
- [ ] **SNZE** (10) — Snooze + permanent reschedule via action sheet
- [ ] **DOCS** (6) — SPEC.md v0.4 + AGPL drift fix + changelog

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
- **Container**: Single Docker image under 320MB (v1.1 budget — see SPEC.md §15), serves both processes
- **Data**: All state in one `./data` volume — backup = copy folder
- **No cloud**: Zero outbound telemetry, no paid APIs, no cloud dependencies
- **SMTP optional, never required**: v1 invites are link-only and no feature requires SMTP, but if an operator configures it (e.g. for built-in PB password reset) the app uses it
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
| v1.1: scope expanded — household load smoothing as first-class | Original audit's per-task flexibility didn't deliver the SPEC thesis ("spread the year's work evenly"). Tasks must know about each other. Added LOAD/LVIZ/TCSEM/REBAL; removed SDST. Audit addendum at `.planning/v1.1/audit-addendum-load.md` | — v1.1 Pending |
| v1.1 LOAD: smoothed date storage on tasks (not completions) | One nullable `tasks.next_due_smoothed DATE` field. NULL = v1.0 behavior, zero migration. TCSEM sets at creation, LOAD updates at completion. Single source of truth | — v1.1 Pending |
| v1.1 LOAD: forward-only smoothing | Adding/completing one task never modifies existing tasks' next_due_smoothed. Predictability > optimality. Manual escape hatch via REBAL phase covers accumulated clumping | — v1.1 Pending |
| v1.1 LOAD: tolerance window `min(0.15 * freq, 5)` initial | Per rider 1: ship ±5 cap, validate against 30-task test household in Phase 12, widen to ±14 if annual clusters remain bunched | — v1.1 Pending |
| v1.1 OOFT: first-due semantics deferred to Phase 11 discuss | Per rider 2: 3 candidate shapes — explicit do-by date, default +7d editable, separate to-do list. User leans (a) explicit do-by | — v1.1 Pending |
| v1.1 REBAL: minimal v1.1 surface, richer features deferred | Per rider 3: ship Settings button + counts-only preview + apply. Per-task preview, undo, auto-trigger, area-scoped all deferred to v1.2+ | — v1.1 Pending |
| v1.1 SPEC bump v0.3 → v0.4 | Addendum changes the spec materially (load smoothing is a new architectural commitment), not just a feature changelog | — v1.1 Pending |

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
*Last updated: 2026-04-22 — v1.1 scope expanded per addendum + 3 riders. Added LOAD/LVIZ/TCSEM/REBAL; removed SDST; PREF reframed; OOFT-01..03 draft; SPEC bump v0.3→v0.4; SMTP nit reworded. Net: +23 REQs, 6→9 phases. Re-roadmap pending.*
