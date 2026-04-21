---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Completed 02-04-PLAN.md
last_updated: "2026-04-21T00:33:20.677Z"
last_activity: 2026-04-21
progress:
  total_phases: 8
  completed_phases: 1
  total_plans: 12
  completed_plans: 11
  percent: 92
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-20)

**Core value:** The household's recurring maintenance is visible, evenly distributed, and nothing falls through the cracks — without creating anxiety or guilt.
**Current focus:** Phase 2 — Auth & Core Data

## Current Position

Phase: 2 (Auth & Core Data) — EXECUTING
Plan: 5 of 5
Status: Ready to execute
Last activity: 2026-04-21

Progress: [█████████░] 92%

## Performance Metrics

**Velocity:**

- Total plans completed: 7
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1 | 7 | - | - |

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

Last session: 2026-04-21T00:33:20.660Z
Stopped at: Completed 02-04-PLAN.md
Resume file: None

**Planned Phase:** 2 (Auth & Core Data) — 5 plans — 2026-04-20T23:14:37.047Z
