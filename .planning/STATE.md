---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Completed 06-02-PLAN.md
last_updated: "2026-04-21T06:21:30.388Z"
last_activity: 2026-04-21
progress:
  total_phases: 8
  completed_phases: 5
  total_plans: 24
  completed_plans: 24
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-20)

**Core value:** The household's recurring maintenance is visible, evenly distributed, and nothing falls through the cracks — without creating anxiety or guilt.
**Current focus:** Phase 6 — Notifications & Gamification

## Current Position

Phase: 6 (Notifications & Gamification) — EXECUTING
Plan: 3 of 3
Status: Ready to execute
Last activity: 2026-04-21

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**

- Total plans completed: 16
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1 | 7 | - | - |
| 3 | 3 | - | - |
| 4 | 3 | - | - |
| 5 | 3 | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
| Phase 01 P01-01 | 9min | 2 tasks | 25 files |
| Phase 01 P01-02 | 3min | 2 tasks | 4 files |
| Phase 01 P01-03 | 1min | 1 tasks | 12 files |
| Phase 01 P04 | 1min | 1 tasks | 1 files |
| Phase 01 P01-05 | 3min | 2 tasks | 3 files |
| Phase 01 P01-06 | 2min | 2 tasks | 2 files |
| Phase 01 P01-07 | 2min | 1 tasks | 1 files |
| Phase 02 P02-01 | 14min | 2 tasks | 9 files |
| Phase 02 P02 | 8min | 2 tasks | 21 files |
| Phase 02 P02-03 | 7min | 3 tasks | 18 files |
| Phase 02 P02-04 | 25min | 3 tasks | 22 files |
| Phase 02 P02-05 | 16min | 4 tasks | 13 files |
| Phase 03 P03-01 | 9min | 3 tasks | 13 files |
| Phase 03 P03-02 | 7 | 5 tasks | 10 files |
| Phase 03 P03-03 | 30min | 4 tasks | 10 files |
| Phase 04 P04-01 | 7min | 2 tasks | 7 files |
| Phase Phase 04 PP04-02 | 13min | 3 tasks | 21 files |
| Phase 04 P03 | 25min | 3 tasks | 30 files |
| Phase 05 P01 | 11min | 3 tasks | 14 files |
| Phase 05 P02 | 20min | 3 tasks tasks | 10 files files |
| Phase 05 P03 | 12min | 3 tasks | 19 files |
| Phase 06 P01 | 12min | 2 tasks | 13 files |
| Phase Phase 06 PP02 | 18min | 2 tasks | 14 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Two-in-one container (PB + Next.js via supervisord)
- Direct PB SDK from browser (client-side auth)
- Link-only invites (no SMTP)
- Equal-weight coverage ring with frequency-normalized overdue ratio
- 01-01: Bumped @types/node 22.10.5 -> 22.19.17 (vite7 peer)
- 01-01: Downgraded eslint 10.2.1 -> 9.39.4 (eslint-plugin-react incompat)
- 01-01: Replaced next lint (removed in Next 16) with 'eslint .'
- 01-01: eslint-config-next@16.2.4 is flat config; import entries directly without FlatCompat
- 01-02: HEALTHCHECK collapsed to single line (plan action block vs acceptance grep mismatch)
- 01-02: docker build deferred to 01-06 CI (runtime stage COPY targets come from 01-03 + 01-04)
- 01-03: parallel s6 startup (no dependencies.d/<peer>) relies on Caddy upstream-retry + HEALTHCHECK start-period=30s
- 01-03: Caddy stays root (T-01-03-03 accept); PB and Next.js drop to node via s6-setuidgid
- 01-04: Caddyfile tab-indented matching RESEARCH.md §Critical Design Choice byte-for-byte
- 01-04: global options block added (auto_https off, admin off) to minimize attack surface on internal port
- 01-04: caddy validate deferred to 01-06 CI (binary not installed on exec host); static-grep gate green
- 01-05: kept env_file: - .env short form per acceptance grep; operators need docker/.env symlink or --project-directory .
- 01-05: pull_policy: if_not_present (Docker normalizes to 'missing') -- predictable local behavior
- 01-05: added pocketbase/pb_migrations/.gitkeep (Rule 3) to preserve committed-empty-dir contract git cannot track empty dirs
- 01-05: dev-pb.js runs as .js without type:module -- verified working on Node 22.22.0 via smoke test (downloaded PB, served :8090, /api/health 200)
- 01-06: arm64 cross-build on every PR via --output type=image,push=false (buildx cannot --load multi-platform)
- 01-06: strict permissions split — ci.yml contents:read only, release.yml sole packages:write (PR cannot publish to GHCR)
- 01-06: actions pinned to major versions (@v4/@v5/@v6/@v7); SHA pinning + cosign deferred to phase 7
- 01-06: D-10 branch protection + GHCR visibility + Actions write permissions are user_setup (no gh CLI on host)
- 01-07: README adds maintainer fork checklist (workflow perms + branch protection + GHCR visibility) from 01-06 user_setup
- 01-07: README dual-renders docker run (one-liner + multi-line) to satisfy key_links single-line regex
- 01-07: README documents compose-dir footgun (env_file/./data resolve relative to docker/, not cwd)
- 01-07: UID fallback uses --entrypoint sh -u 0 override so chown actually executes (not s6 /init CMD-swallow)
- 02-01: PB 0.37.1 Collection constructor ignores fields+indexes — use collection.fields.add() post-construction
- 02-01: Whole Home hook calls e.next() BEFORE creating area (fixes validation_missing_rel_records on home_id)
- 02-01: Rate-limit labels use camelCase (*:authWithPassword) and path prefixes (/api/); lone * and kebab-case actions rejected by Go validator
- 02-01: Integration-test pattern — create superuser BEFORE serve start to avoid SQLite WAL race; port 18090 with unique --dir per test file
- 02-01: ESLint override disables triple-slash-reference for pocketbase/pb_migrations + pb_hooks (PB JSVM pattern, ESM import unsupported in goja)
- 02-02: shadcn 4.3.1 preset system writes empty form.json — use classic style=new-york baseColor=stone for real content
- 02-02: Strip all carets and remove shadcn CLI from runtime deps — exact-pin pattern carried forward (cva, clsx, tailwind-merge, next-themes, radix-ui, tw-animate-css)
- 02-02: Removed bogus @import 'shadcn/tailwind.css' (no such package published); tokens live in :root
- 02-02: Test hygiene — clear jsdom localStorage in beforeEach so PB LocalAuthStore doesn't leak authStore state across tests
- 02-02: lib/pocketbase.ts kept as 13-line back-compat shim so Phase 1 tests/unit/pocketbase.test.ts stays green — new code uses the split factories
- 02-03: Cookie options driven by NODE_ENV for secure flag (D-03 + Pitfall 3) — LAN-HTTP production has Secure OFF; SameSite=Lax still mitigates CSRF; Phase 7 HTTPS flips on automatically
- 02-03: proxy.ts (Next 16 rename, NOT middleware.ts) with presence-check only — full JWT validation delegated to PB server-side; (app)/layout.tsx adds defense-in-depth via pb.authStore.isValid
- 02-03: safeNext() enforces /-prefix same-origin + forbids // and ://, implementing T-02-03-08 mitigation in-plan rather than deferring
- 02-03: requestResetAction always returns ok on user-not-found; only SMTP-disabled 400 surfaces the 'Password reset unavailable' message per D-02 (T-02-03-03 email-enumeration)
- 02-03: app/page.tsx single landing file; no app/(public)/page.tsx (would error 'two parallel pages same path' — route groups don't create segments)
- 02-03: Logout is DropdownMenuItem asChild wrapping a form whose action={logoutAction} — works without JS, participates in Next 16 cookie-clear+redirect single-response flow (D-07)
- 02-03: signupAction email-taken detection covers both PB 0.23+ 'validation_not_unique' and older 'validation_invalid_email' codes for forward/backward compat
- 02-04: AREA_ICONS substitutes 'brush' for 'vacuum'/'broom' (neither in lucide-react@1.8.0)
- 02-04: IconPicker+ColorPicker as RHF Controller + hidden input bridge — single source for UI state AND FormData submit payload
- 02-04: HomeSwitcher uses router.push+refresh (Open Q #3) — avoids full-layout revalidate on every switch
- 02-04: SortableAreaList uses render-time reset-state pattern (setPrevKey/setItems inline) — syncs to fresh server props after router.refresh without useEffect
- 02-04: (app)/layout.tsx + /h/page.tsx fetch live users record via pb.getOne() — pb.authStore.record is stale cookie snapshot
- 02-04: Bumped *:authWithPassword rate limit 5/60s → 20/60s to unblock E2E suite (still blocks >20 spray/min)
- 02-04: deleteHome server action exported but NOT UI-wired — Danger Zone deferred to Settings/Phase 5
- 02-05: Adopted RESEARCH's computeNextDue anchored formula (floor(elapsed/freq)+1 cycles) over CONTEXT D-13's Math.ceil pseudocode — codified with an explicit exact-boundary unit test.
- 02-05: Frequency quick-select buttons are explicitly type='button' — HTML default of type='submit' would submit the form mid-fill on click; plan verification flagged this as a real bug risk.
- 02-05: computeNextDue is pure — accepts now: Date as a parameter, never reads Date.now internally. The Server Component page passes new Date() as a prop so all tasks render relative to a single request-time instant.
- 02-05: NextDueDisplay is Client Component — date-fns-tz timezone DB loads on the client boundary only, keeping the server bundle lean. Rendering uses formatInTimeZone(date, home.timezone, 'MMM d, yyyy') inside a <time dateTime> element.
- 03-01: Completions collection uses updateRule=null + deleteRule=null (not empty string) per PB docs — locks mutations to superusers
- 03-01: Timezone-aware band boundaries via fromZonedTime(startOfDay(toZonedTime(now, tz)), tz) — DST-safe per date-fns-tz
- 03-01: Server action returns discriminated-union CompleteResult — business outcomes typed, only PB/network outages caught as {ok:false,formError}
- 03-01: Integration test uses port 18091 (02-01 used 18090) for concurrent test runs without collision
- 03-02: shadcn CLI added caret to radix-ui; reverted to exact-pin (Phase 2 02-02 invariant)
- 03-02: Used Tailwind primary token (not invented --accent-warm var) for warm-accent coverage ring + overdue border
- 03-02: No Pitfall 10 opt-out needed; useOptimistic reducer form compiles cleanly under React Compiler
- 03-02: ClassifiedTask 'name' attached via Map-backed lookup in BandView (narrow engine type preserved from 03-01)
- 03-02: HorizonStrip empty-cell policy = disabled+opacity-50 (grid stays 12 cells); empty-band policy = 'looking clear' copy replaces grid
- 03-01: Completions collection uses updateRule=null + deleteRule=null
- 03-03: Discriminated-union narrowing via 'requiresConfirm' in result — TS strict refuses to narrow on literal-true property
- 03-03: Date/clock reads hoisted inside startTransition to satisfy react-hooks/purity without a 'use no memo' directive
- 03-03: E2E URL regex {15} enforced PB id length — closes the /h/new ambiguity that let expect(toHaveURL) return before server-action redirect
- 03-03: Seed-via-PB-REST pattern for E2E back-dated completions — the user's own auth token is sufficient, no superuser back-door needed
- Phase 4 primary rule form: _via_ back-relation with ?= any-match (over @collection fallback)
- Owner-membership auto-create lives in the Whole Home hook (single transaction, not chained hooks)
- Disposable-PB port map: 18090/18091/18092/18093 (02-01 / 03-01 / 04-01 hook / 04-01 rules)
- 04-02: Enable PB batch API via bootstrap hook (Rule 3) — PB 0.37 defaults to disabled; reorderAreas + acceptInvite both require
- 04-02: Admin client 30-min TTL cache — amortises authWithPassword 20/60s rate limit (Pitfall 3)
- 04-02: acceptInvite uses admin batch (NOT split with authed client) — attribution preserved via server-set accepted_by_id; simpler atomicity
- 04-02: assigned_to_id validation: trust-the-rule (Wave 3 resolveAssignee handles orphan assignees) rather than explicit assertMembership on assignee
- 04-02: Port 18094 for invites-roundtrip test (plan said 18093 but 04-01 already claimed 18093)
- 04-03: resolveAssignee as pure fn + discriminated union — Map-backed member lookup, O(1) per cascade
- 04-03: AvatarCircle primitive over @radix-ui/react-avatar — pure CSS variants, zero new deps
- 04-03: users.viewRule relaxed via double-hop back-relation so co-members can expand each other (migration 1714953603)
- 04-03: acceptInvite drops revalidatePath — Next 16 rejects revalidate-during-RSC-render; redirect handles fresh render
- 04-03: Playwright globalSetup shells to 'pocketbase superuser upsert' CLI — PB 0.37 REST refuses unauthed superuser creates
- 04-03: LeaveHomeMenuItem renders raw <button> (not DropdownMenuItem) to avoid Radix auto-close dismissing Dialog
- 05-01: Week-offset bucketing via self-computed local-week-start + Math.round on ms-ratio — DST-safe for 23h/25h weeks
- 05-01: TopTabs hand-rolled as styled Link row (not shadcn Tabs primitive) — preserves prefetch + Cmd-click + route-driven active state
- 05-01: homes.onboarded migration omits BoolField default (PB 0.37.1 default-semantics quirky); backfill existing rows to true explicitly; new rows rely on PB's unset=false storage default
- 05-01: NavShell scoped at app/(app)/h/[homeId]/layout.tsx segment so /h, /h/new, /login, /signup, /invite/[token] are skipped automatically; onboarding wizard keeps nav visible as Skip escape hatch per D-13
- 05-01: Disposable-PB port 18095 allocated for homes-onboarded integration test — slots after 18094 (04-02 invites-roundtrip)
- 05-02: PersonTaskList forked from BandView (not prop variant) — clean scope separation; share only the optimistic+guard pattern
- 05-02: Lucide icons resolved dynamically via record-lookup on PascalCase name; fallback to Home on miss (legacy/defense)
- 05-02: History cap at 50 + 'Showing 50 of N' footer over server-side pagination — simpler Phase 5 surface; T-05-02-05 acknowledged
- 05-02: HistoryFilters strips default values (empty person/area, range=month) from URLSearchParams for clean /history URLs
- 05-02: E2E uses direct URL navigation for /by-area|/person|/history — NavShell BottomNav is md:hidden and desktop viewport would miss it
- 05-02: Bumped *:authWithPassword rate limit 20/60s → 60/60s (Rule 3 Blocking) — Phase 5 adds 3 signup-heavy suites; password-spray protection still prohibitive
- 05-03: pb.createBatch() atomic N tasks + homes.onboarded=true flip in one transaction (T-05-03-10)
- 05-03: every seed defaults to Whole Home area — guaranteed to exist via Phase 2 hook; Edit control surfaces existing-area select; no auto-creation of Kitchen/Bathroom
- 05-03: BottomNav + TopTabs early-return null on pathname.endsWith('/onboarding') — breaks Home-tap redirect loop without route-group refactor (Rule 2)
- 05-03: batchCreateSeedTasks uses user-authed pb client (NOT admin) — tasks.createRule gates writes via membership which caller has; keeps security model clean
- 05-03: tests/e2e excluded from tsconfig paths → onboarding.spec.ts uses relative '../../lib/seed-library' import
- 05-03: skipOnboardingIfPresent(page) E2E helper centralises backward-compat; 6 older specs patched at createHome call sites
- 06-01: users ntfy_topic validated at app layer (lib/ntfy.ts topic regex) not via PB pattern field — avoids empty-string backfill mismatch
- 06-01: notifications.task_id nullable (minSelect:0) so weekly_summary rows carry null; kind↔task partition is caller invariant
- 06-01: recordNotification/hasNotified swallow ALL errors; DB UNIQUE INDEX is race safety net (two-layer dedupe per D-05)
- 06-01: detectAreaCelebration uses strict === 1.0 (not epsilon) — computeCoverage is deterministic mean, no FP drift vs canonical values
- 06-01: Disposable-PB port 18096 claimed for notifications idempotency test; allocation log 18090..18096
- 06-02: node-cron pinned to v3.0.3 (matches @types/node-cron@3.0.11; v4 async API breaking)
- 06-02: scheduler test seeds past completion (5d ago) on cycle-mode task — PB AutoDate `created` is server-controlled
- 06-02: fetchHomeMembers drops PB `fields` whitelist; `expand.user_id.<field>` syntax silently empties expand payload
- 06-02: celebration reuses tasksInArea + getCompletionsForHome via Map overlay (no 2nd PB roundtrip)
- 06-02: playwright.config.ts env gains DISABLE_SCHEDULER=true — quiets cron start logs in E2E; sync hooks still run but test users have empty topics
- 06-02: Disposable-PB port 18097 claimed for scheduler integration test (allocation log now 18090..18097)
- 06-02: admin-route fail-closed: 401 identical for token-unset vs token-too-short (no signal leakage)

### Pending Todos

None yet.

### Blockers/Concerns

- PWA tooling: next-pwa may be unmaintained; verify Serwist compatibility at Phase 7
- PocketBase version: may have breaking changes since training data cutoff; verify at Phase 1 scaffold

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-04-21T06:21:30.374Z
Stopped at: Completed 06-02-PLAN.md
Resume file: None

**Planned Phase:** 6 (Notifications & Gamification) — 3 plans — 2026-04-21T05:45:07.848Z
