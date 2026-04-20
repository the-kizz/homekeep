# Phase 1: Scaffold & Infrastructure - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Get Next.js 15 and PocketBase running together in a single Docker container, with a working dev environment, compose files, health endpoint, and CI/CD scaffold. This phase produces a running container that serves a hello page — no application logic yet.

</domain>

<decisions>
## Implementation Decisions

### Process Management
- **D-01:** Use s6-overlay as the process manager inside the container. It's tiny (~2MB), handles signal propagation properly, auto-restarts crashed processes, and is the linuxserver.io standard. Preferred over supervisord (too heavy, +30MB Python deps) and custom bash scripts (no auto-restart).

### Port & Routing Architecture
- **D-02:** Single exposed port (3000 internal) with an internal Caddy instance routing traffic: `/api/*` and `/_/` → PocketBase (port 8090 internal), everything else → Next.js. Users map this single port to any external port they choose.
- **D-03:** The PocketBase JS SDK URL from the browser is just `window.location.origin` (same-origin, thanks to internal proxy). No separate PB URL config needed for end users.
- **D-04:** Support both `docker compose up` AND standalone `docker run -p 80:3000 -v ./data:/app/data --env-file .env ghcr.io/owner/homekeep:latest`. Document both in README.

### PocketBase Admin
- **D-05:** PocketBase admin UI at `/_/` is accessible in production, protected by PB's own admin auth. Do not gate it behind an env var. Future OAuth providers (Google, Facebook, etc.) can be configured via this admin UI without code changes.

### Development Environment
- **D-06:** Native dev workflow: `npm run dev` for Next.js (instant hot reload) + PocketBase binary running locally (or in a minimal dev container). Docker is for building the production image, not for day-to-day coding.
- **D-07:** Include a `Makefile` or `package.json` scripts for common dev tasks: `dev` (start both), `dev:next` (Next.js only), `dev:pb` (PocketBase only), `build` (Docker image), `test` (Vitest), `test:e2e` (Playwright).

### Testing
- **D-08:** Vitest for unit/integration tests, Playwright for E2E tests. CI runs both on every PR. Lint (ESLint) + type-check (tsc) + test (Vitest) + E2E (Playwright) as the CI pipeline.

### GitHub & CI/CD
- **D-09:** Public GitHub repo from day 1. MIT license. GitHub Actions for CI (lint/test on PR) and release (multi-arch build → GHCR on tag push).
- **D-10:** Branch protection on main: require PR, require CI pass. Development on feature branches.

### VPS & Remote Access
- **D-11:** This VPS (Hetzner, Ubuntu 24.04) is the dev environment. UFW firewall has ports 22, 80, 443 open. For dev access, map container to port 80 (already open) or open port 3000 (`ufw allow 3000/tcp`). Direct IP access for now — HTTPS/Tailscale added in Phase 7 compose variants.

### Claude's Discretion
- Internal Caddy config specifics (routing rules, headers)
- s6-overlay service directory structure
- Exact PocketBase binary download/management in dev
- Dockerfile multi-stage build structure
- GitHub Actions workflow specifics (matrix, caching)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Specification
- `SPEC.md` §13 — Tech stack choices (Next.js 15, PocketBase, Tailwind, shadcn/ui)
- `SPEC.md` §14 — Repository layout (directory structure)
- `SPEC.md` §15 — Docker + distribution requirements (multi-arch, <300MB, health check, env-driven)
- `SPEC.md` §16 — Security constraints (no telemetry, secrets via env vars)

### Research
- `.planning/research/ARCHITECTURE.md` — Two-process container architecture, data flow, build order
- `.planning/research/PITFALLS.md` — Docker/PocketBase/Next.js gotchas (SQLite WAL, standalone output, env vars)
- `.planning/research/STACK.md` — Version recommendations and what NOT to use

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield project, no existing code

### Established Patterns
- None yet — this phase establishes them

### Integration Points
- PocketBase migrations in `pocketbase/pb_migrations/` will be the schema-as-code approach
- Next.js standalone output (`output: 'standalone'` in next.config) produces minimal server
- s6-overlay services defined in `/etc/s6-overlay/s6-rc.d/`

</code_context>

<specifics>
## Specific Ideas

- Follow linuxserver.io conventions for the container (s6-overlay, /config pattern adapted to /app/data)
- Image must work with `docker run` just as well as `docker compose up`
- Port 80 is already open on the VPS — use it for dev testing without extra firewall config
- PocketBase admin at /_/ is a feature, not a security risk (it has its own auth)

</specifics>

<deferred>
## Deferred Ideas

- OAuth providers (Google, Facebook, mobile number) — future, configured via PB admin UI when needed
- Tailscale/Caddy HTTPS — Phase 7
- PWA testing — needs HTTPS, deferred until compose variants exist

</deferred>

---

*Phase: 01-scaffold-infrastructure*
*Context gathered: 2026-04-20*
