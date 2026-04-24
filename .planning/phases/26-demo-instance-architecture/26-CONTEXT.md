# Phase 26: Demo Instance Architecture — Context

**Gathered:** 2026-04-23
**Status:** Ready for planning
**Mode:** Autonomous

<domain>
## Phase Boundary

Ship a `docker-compose.demo.yml` overlay + app-layer demo primitives so a public demo can run at `homekeep.demo.the-kizz.com` without risk to real user data or spam-abuse vectors.

**Target deployment:** `homekeep.demo.the-kizz.com` (hierarchical subdomain per STATE.md decision). Wildcard Let's Encrypt cert `*.demo.the-kizz.com` via DNS-01 + godaddy plugin.

**In scope (5 REQ-IDs):**
- DEMO-01 `docker-compose.demo.yml` overlay — tmpfs PB_DATA, DISABLE_SCHEDULER=true, HK_BUILD_STEALTH=true, SMTP off, NTFY_URL="", throwaway admin account
- DEMO-02 Per-visitor ephemeral home — admin-client helper seeds home + 3 areas + 15 seed tasks on first visit, cookie-keyed
- DEMO-03 Cleanup cron — 2-hour idle TTL + 24-hour absolute TTL; wipes stale sessions
- DEMO-04 Landing page warning banner — "This is a demo. Data resets every 2 hours. Do not enter real info."
- DEMO-05 Public DNS record `homekeep.demo.the-kizz.com` pointed to VPS; Caddy block serves it with wildcard cert

**Out of scope:**
- SMS / email verification
- Demo-specific feature flags beyond scheduler+ntfy+smtp
- Onboarding flow changes (demo uses existing flow but with pre-seeded state)

**Deliverables:**
1. `docker/docker-compose.demo.yml` overlay (ports, env, tmpfs mount, image pinning)
2. `Caddyfile.demo` or additional Caddy block for `homekeep.demo.the-kizz.com`
3. `lib/demo-session.ts` — cookie-keyed ephemeral-home seeding helper
4. `app/api/demo/session/route.ts` — GET handler that checks/creates demo session + seeds home
5. `components/demo-banner.tsx` + layout integration (conditionally rendered when `DEMO_MODE=true`)
6. PB hook or cron script for idle/absolute TTL cleanup
7. Documentation in `docs/deployment.md` (demo section)
</domain>

<decisions>
## Implementation Decisions

### DEMO-01: Compose overlay

- **D-01 (compose file structure):** New `docker/docker-compose.demo.yml` extends the base compose with:
  - Service env overrides: `DEMO_MODE=true`, `DISABLE_SCHEDULER=true`, `HK_BUILD_STEALTH=true`, `NTFY_URL=""`, `SMTP=""`, `SITE_URL=https://homekeep.demo.the-kizz.com`
  - Volume: `/app/data/pb_data` mounted as tmpfs (no disk persistence)
  - Image: `ghcr.io/the-kizz/homekeep:latest` (or `:edge` during active dev)
  - Healthcheck + restart policy preserved
- **D-02 (env file):** `docker/.env.demo` separate from production `docker/.env` so secrets don't mix. Uses throwaway admin email (e.g. `admin@demo.homekeep.local`) with fresh generated password.

### DEMO-02: Ephemeral home seeding

- **D-03 (session key):** HTTP-only cookie `homekeep_demo_session` with 24h TTL. Client-side untestable (HTTP-only); server reads it on each request.
- **D-04 (first-visit flow):**
  1. Visitor lands on `/` with no session cookie
  2. Server action calls `ensureDemoSession()`:
     - If cookie present + session exists in PB → resume
     - Else create throwaway user via admin client, create home "Demo House", 3 areas (Kitchen / Outdoor / Whole Home), 15 seed tasks (via existing seed library)
     - Set cookie with new session ID
     - Authenticate the visitor as this throwaway user
  3. Visitor experiences the normal app with pre-populated data
- **D-05 (admin-client isolation):** The seeding uses the admin client; visitor's visible authStore is their throwaway user, not admin. All subsequent actions use the visitor's auth.

### DEMO-03: Cleanup TTL

- **D-06 (2-hour idle):** cron or PB hook runs every 15 min, finds demo users whose `last_activity` > 2h ago, deletes the user + cascades (home, members, tasks, completions, overrides, notifications).
- **D-07 (24-hour absolute):** same sweep also deletes demo users whose `created > 24h ago` regardless of activity.
- **D-08 (demo user tag):** mark demo users with `is_demo=true` field on `users` collection (migration adds nullable field — defaults false; only demo-session-helper sets true).
- **D-09 (safety):** cleanup sweep ONLY touches records where `is_demo=true`. Never deletes real users.

### DEMO-04: Landing banner

- **D-10 (component):** `<DemoBanner>` fixed-top sticky banner with amber warning icon + text. Only rendered when `process.env.DEMO_MODE === 'true'`.
- **D-11 (copy):** "🧪 Demo instance — data resets every 2 hours and after 24 hours. Do not enter real personal information." Dismissible (localStorage flag) but reappears per browser session.
- **D-12 (layout integration):** rendered in `app/layout.tsx` above main content when `DEMO_MODE=true`.

### DEMO-05: DNS + Caddy

- **D-13 (DNS):** manually add A record `homekeep.demo.the-kizz.com → 46.62.151.57` in godaddy UI (API automation deferred to v1.3). Also add wildcard placeholder `*.demo.the-kizz.com → 46.62.151.57` if using wildcard cert strategy.
- **D-14 (Caddy block):** new `homekeep.demo.the-kizz.com` block in a demo-specific Caddyfile that runs alongside the existing `docker-compose.caddy.yml`. Uses auto-HTTPS via HTTP-01 (simpler than DNS-01 for initial ship). DNS-01 + godaddy plugin upgrade deferred.
- **D-15 (wildcard cert future):** once DNS-01 + godaddy plugin added, swap to wildcard `*.demo.the-kizz.com` cert that covers future project demos (notes.demo, wiki.demo, etc).

### Migration + tests

- **D-16 (new migration):** `1745280007_demo_flag.js` — adds `users.is_demo BOOL` nullable, default false. Additive.
- **D-17 (tests):** 5 integration tests —
  1. `DEMO_MODE=true` env + no cookie → session created, home/areas/tasks seeded, cookie set
  2. Resume existing session → same home returned
  3. 2h idle → cleanup sweep deletes the user
  4. 24h absolute → deletion regardless of activity
  5. Cleanup sweep does NOT touch users where is_demo=false

### Claude's Discretion
- Seed library — reuse existing onboarding seed list from Phase 5/13, or a dedicated shorter "demo-friendly" list. Recommend reuse with 15-task subset.
- Cleanup runs as PB hook (every 15 min via hook cron) vs separate container — recommend hook for simplicity.
- Whether to disable signup in demo mode (only seed on session-create) — recommend yes, prevent visitors from creating real accounts on demo.
</decisions>

<canonical_refs>
- `.planning/v1.2-security/research/public-facing-hardening.md` §Demo-instance architecture (the recipe)
- `.planning/STATE.md` "Subdomain Naming Decision" + "Architecture Decision"
- `docker/docker-compose.yml` + `docker-compose.caddy.yml` — base compose to extend
- `docker/Caddyfile.prod` — existing Caddy config (add demo block or new file)
- `lib/seed-library.ts` — source of seed tasks
- `lib/actions/auth.ts` — signup flow (disabled in demo mode)
- `pocketbase/pb_hooks/` — location for cleanup hook
</canonical_refs>

<deferred>
- DNS-01 + godaddy plugin for wildcard cert (v1.3)
- Per-project demo wildcard `*.demo.the-kizz.com` (v1.3)
- Demo analytics (visitor counts, session length)
- Onboarding-flow adjustment for demo (maybe skip wizard)
</deferred>

---

*Phase: 26-demo-instance-architecture*
