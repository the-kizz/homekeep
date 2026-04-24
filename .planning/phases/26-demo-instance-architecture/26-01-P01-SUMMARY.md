---
phase: 26
plan: 26-01-P01
subsystem: demo-instance
tags: [demo, docker, tmpfs, ephemeral-session, caddy, pb-hooks]
requires:
  - phase-07 (Caddyfile.prod scaffold + pwa baseline)
  - phase-22 (HOTFIX-01 admin-UI edge block pattern)
  - phase-24 (HDR-04 HK_BUILD_STEALTH + HSTS header)
  - phase-25 (ratelimits + users:create bucket)
provides:
  - docker-compose.demo.yml overlay (tmpfs PB, DEMO_MODE gates)
  - lib/demo-session.ts + /api/demo/session route (per-visitor seed)
  - pb_hooks/demo_cleanup.pb.js (2h idle + 24h absolute TTL cron)
  - components/demo-banner.tsx (amber warning)
  - docker/Caddyfile.demo (homekeep.demo.the-kizz.com TLS block)
  - docs/deployment.md "Deploying a public demo" section
affects:
  - app/layout.tsx (DemoBanner inserted above children)
  - users collection (additive: is_demo BOOL + last_activity DATETIME)
tech-stack:
  added: []
  patterns:
    - "tmpfs mount for ephemeral state (Compose v2.24+ `volumes: !reset []` + `tmpfs:` block)"
    - "DEMO_MODE=true env flag gates four surfaces (lib + route + banner + hook) — dead-code on personal instances"
    - "PB 0.22+ superuser .impersonate(userId, duration) for resume-path auth token minting"
    - "PB filter datetime cutoff format: Date.toISOString().replace('T',' ') mandatory (space-separated stored format)"
key-files:
  created:
    - docker/docker-compose.demo.yml
    - docker/.env.demo
    - docker/Caddyfile.demo
    - pocketbase/pb_migrations/1745280006_demo_flag.js
    - pocketbase/pb_hooks/demo_cleanup.pb.js
    - lib/demo-session.ts
    - app/api/demo/session/route.ts
    - components/demo-banner.tsx
    - components/demo-banner-dismissible.tsx
    - tests/unit/demo-session-integration.test.ts
  modified:
    - app/layout.tsx
    - docs/deployment.md
decisions:
  - "docker-compose.demo.yml tmpfs /app/data (256m cap) with DEMO_MODE=true gating seed-session helper + banner + cleanup cron"
  - "Rule 1 fix in pb_hooks/demo_cleanup.pb.js — ISO Date.toISOString().replace('T',' ') required before embedding in PB filter (PB 0.37.x stores space-separated datetimes, lexicographic compare against ISO-T would match every row)"
  - "Ephemeral demo-session cookie 'homekeep_demo_session'=userId (24h), pb_auth minted via PB 0.22+ users.impersonate(userId, 86400) on resume path"
  - "Caddyfile.demo replaces Caddyfile.prod on demo deploys; NO ALLOW_PUBLIC_ADMIN_UI escape hatch (demo host never permits admin UI at edge)"
  - "Port 18106 claimed for demo-session-integration.test.ts (allocation register 18090..18106; 18107+ reserved for Phase 27+)"
metrics:
  duration_minutes: 16
  completed_date: 2026-04-23
  tasks_completed: 5
  files_created: 10
  files_modified: 2
  tests_added: 5
  tests_passing: 664
---

# Phase 26 Plan 01: Demo Instance Architecture Summary

**One-liner:** Ship a `docker-compose.demo.yml` overlay + per-visitor ephemeral session helper + 2h/24h cleanup cron + amber warning banner + Caddyfile.demo block, so `homekeep.demo.the-kizz.com` can run the public HomeKeep demo without risk to real-user data.

## What Shipped

### DEMO-01 — Compose overlay + .env template (commit `7fb6baa`)

`docker/docker-compose.demo.yml` layers on top of the baseline + caddy overlay and:
- replaces `./data:/app/data` bind-mount with a 256 MB tmpfs (`volumes: !reset []` + `tmpfs:` block, Compose v2.24+);
- sets `DEMO_MODE=true`, `DISABLE_SCHEDULER=true`, `HK_BUILD_STEALTH=true`, `NTFY_URL=""`, `SITE_URL=https://homekeep.demo.the-kizz.com`;
- pins the image via `GHCR_OWNER=${GHCR_OWNER:-the-kizz}` + `TAG=${TAG:-latest}`, so `TAG=edge` supports active-dev deploys.

`docker/.env.demo` is the committed operator template — fail-fast placeholder for `PB_ADMIN_PASSWORD` forces a rotation before first `compose up`.

### DEMO-02 — Ephemeral session helper + API route (commit `85e413d`)

- Migration `1745280006_demo_flag.js` adds `users.is_demo BOOL` + `users.last_activity DATETIME` (both nullable, false/empty defaults — additive, non-breaking for real users).
- `lib/demo-session.ts::ensureDemoSession(cookieStore)`:
  - resume path: if `homekeep_demo_session` cookie points to an `is_demo=true` user, touch `last_activity`, mint a fresh `pb_auth` via PB 0.22+ `users.impersonate(userId, 86400)` (returns a new client — SDK contract), return existing home;
  - fresh path: spawn throwaway user (random 12-char hex tag in email, 32-char hex password), create "Demo House" + Kitchen + Outdoor areas (Whole Home auto-creates via hook), batch 15 `SEED_LIBRARY` tasks + `homes.onboarded=true` in one `pb.createBatch()` transaction;
  - `assertDemoMode()` fail-loud guard — stray imports from a non-demo build throw rather than mint accounts silently.
- `app/api/demo/session/route.ts` GET handler: returns 404 when `DEMO_MODE` unset; otherwise calls the helper and sets `pb_auth` + `homekeep_demo_session` cookies (`httpOnly`, `secure: true`, `sameSite: 'lax'`), 303-redirect to `/h/<homeId>`.

### DEMO-03 — Cleanup cron (commit `365412f`)

`pocketbase/pb_hooks/demo_cleanup.pb.js` runs `*/15 * * * *`:
- skipped entirely when `DEMO_MODE !== 'true'` (dead-code on personal instances);
- two-pass filter (idle + absolute) merged by id; defense-in-depth per-row `is_demo === true` re-check inside the delete loop;
- deletes homes FIRST (because `homes.owner_id.cascadeDelete=false` in the init migration blocks user-delete cascade), then the user — tasks/areas/completions/members/overrides then cascade from `home.id` (all `cascadeDelete=true` in init);
- fresh sessions with empty `last_activity` are excluded from the idle pass (`last_activity != ""` guard) so they aren't nuked mid-seed by the same-minute tick.

### DEMO-04 — Banner (commit `995ca12`)

- `components/demo-banner.tsx` (server component): returns `null` when `DEMO_MODE !== 'true'` — zero bytes shipped to clients on personal instances.
- `components/demo-banner-dismissible.tsx` (`'use client'` leaf): sticky amber-bg banner, `useSyncExternalStore` pattern borrowed from `insecure-context-banner`, dismissal persisted to `localStorage['dismissed_demo_banner']`. Copy per D-11: "Demo instance — data resets every 2 hours and after 24 hours. Do not enter real personal information."
- Integrated into `app/layout.tsx` above `{children}`.

### DEMO-05 — Caddy block + docs (commit `aa35632`)

- `docker/Caddyfile.demo` — dedicated block for `homekeep.demo.the-kizz.com` with the same Phase 24 HDR-02 headers as `Caddyfile.prod`. No `ALLOW_PUBLIC_ADMIN_UI` escape hatch — the admin UI is always 404 on the demo host.
- `docs/deployment.md` gains a 60-line "Deploying a public demo" section covering DNS prereq, `.env.demo` rotation, 3-file compose chain, verification, resource usage, and tear-down.

### Tests — 5 integration scenarios (commit `b317a0e`)

`tests/unit/demo-session-integration.test.ts` on disposable PB (port 18106):
1. `ensureDemoSession` with no cookie → user + home + 3 areas + 15 cycle-mode seed tasks, `is_demo=true`, `onboarded=true`.
2. Resume with existing session cookie → same user/home, task count unchanged, `last_activity` touched.
3. Idle-TTL (2h): stale `last_activity` matches filter → cascade deletes user + home.
4. Absolute-TTL (24h): `created < now-24h` matches regardless of fresh `last_activity` (simulated by shifting cutoff forward since PB autodate `created` is server-controlled).
5. Safety gate D-09: `is_demo=false` real users with stale activity + ancient `created` match NEITHER sweep.

All 664 tests in the wider suite pass.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] PB filter datetime format incompatibility**

- **Found during:** Scenario 4 of the integration test (would have broken production silently).
- **Issue:** PB 0.37.x stores datetimes in space-separated format (`2026-04-23 22:50:02.940Z`) and its filter parser does raw string comparison against the stored value. JavaScript `Date.prototype.toISOString()` emits T-separated format (`2026-04-23T22:50:02.940Z`). Since space (0x20) is less than `T` (0x54), any stored datetime sorts lexicographically BEFORE any ISO-T cutoff — meaning the idle sweep (`last_activity < "${cutoff}"`) would match every demo user on every 15-min tick and nuke brand-new sessions the moment they were created.
- **Fix:** Apply `.replace('T', ' ')` after `toISOString()` on both `idleCutoffIso` and `absoluteCutoffIso` in `pb_hooks/demo_cleanup.pb.js`; mirrored in all three scenarios of the test that construct the same filter.
- **Files modified:** `pocketbase/pb_hooks/demo_cleanup.pb.js`, `tests/unit/demo-session-integration.test.ts`.
- **Commit:** `b317a0e` (test + fix landed together since the test caught it).

### Scope Adjustments

- **Seed selection from `SEED_LIBRARY`:** picked 15 seeds from the existing 34-entry library rather than forking a dedicated "demo" list — preserves seed-id invariants used elsewhere (tests, analytics) and keeps the demo feel authentic to the real onboarding flow.
- **`authAsDemoUser` impersonation:** the initial plan suggested calling `authWithPassword` for resume — but the random password is discarded after first-visit create, so we cannot re-auth that way. PB 0.22+ `users.impersonate(userId, duration)` is the correct API (returns a new client already authenticated), and the comment block in `lib/demo-session.ts` documents this decision.
- **Scenario 4 simulated cutoff:** PB 0.37.x autodate `created` cannot be overridden via REST (even as superuser) nor via `sqlite3` (not on the test host). Solution: shift the simulated `now` 25 hours forward instead of the record 25 hours backward — functionally equivalent, proves the filter expression works.

## Authentication Gates

None. Everything automated end-to-end; integration test uses disposable PB with superuser-CLI-auth pattern copied from Phase 12/17 suites.

## Known Stubs

None. Every surface is wired to real data; the demo is a complete end-to-end experience inside the v1.1 app shell.

## Threat Flags

None. Every new surface (public `/api/demo/session` route, Caddy block, cron hook) was designed with the Phase 22/23/24/25 hardening patterns already in place: admin-UI edge-block, CSP+HSTS headers, per-endpoint rate limits, `is_demo` safety gate. No new attack surface is introduced beyond what was explicitly planned in `26-CONTEXT.md`.

## User Setup Required (before first demo deploy)

The phase ships primitives; the user activates them with:

1. Add DNS A record `homekeep.demo.the-kizz.com → 46.62.151.57` in GoDaddy.
2. Copy `docker/.env.demo` → `docker/.env.demo.local` on the VPS; run `openssl rand -hex 24` and paste the output into `PB_ADMIN_PASSWORD=`.
3. Decide which Caddyfile to mount: either edit the `docker-compose.caddy.yml` volume mount to point at `Caddyfile.demo`, or set `DOMAIN=homekeep.demo.the-kizz.com` in `.env.demo.local` and let `Caddyfile.prod`'s `{$DOMAIN}` substitution serve it.
4. `docker compose -f docker/docker-compose.yml -f docker/docker-compose.caddy.yml -f docker/docker-compose.demo.yml --env-file docker/.env.demo.local up -d`.

Steps 1-4 are documented in `docs/deployment.md` "Deploying a public demo".

## Commits

| Task | Description                                 | Commit    |
| ---- | ------------------------------------------- | --------- |
| 1    | docker-compose.demo.yml + .env.demo (01)    | `7fb6baa` |
| 2    | demo-session + API route + migration (02)   | `85e413d` |
| 3    | demo_cleanup.pb.js cron (03)                | `365412f` |
| 4    | demo-banner components + layout wire (04)   | `995ca12` |
| 5    | Caddyfile.demo + deployment.md section (05) | `aa35632` |
| 6    | integration suite + Rule 1 fix (D-17)       | `b317a0e` |

**Duration:** 16 min (research + build + test + Rule-1 discovery and fix + summary).

## Self-Check: PASSED

All 11 files created/modified verified on disk; all 6 commits verified in `git log`.
