# Phase 1: Scaffold & Infrastructure - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-20
**Phase:** 01-scaffold-infrastructure
**Areas discussed:** Process manager, Dev environment, PocketBase exposure, Reverse proxy/ports, Testing, GitHub setup, Remote access

---

## Process Manager

| Option | Description | Selected |
|--------|-------------|----------|
| s6-overlay | Alpine-native, ~2MB overhead, proper signal handling, used by linuxserver.io images | ✓ |
| supervisord | Python-based, well-documented, simple config. Adds ~30MB to image | |
| Custom entrypoint script | Simple bash with trap/wait. No auto-restart on crash | |

**User's choice:** s6-overlay (after requesting plain-language explanation of each option)
**Notes:** User asked how Sonarr/Radarr/Plex handle this. Explained linuxserver.io convention.

---

## Dev Environment

| Option | Description | Selected |
|--------|-------------|----------|
| Native + Docker PB | npm run dev for Next.js, PocketBase in minimal container | ✓ |
| Full Docker Compose | Everything in containers, slower hot reload | |
| Fully native | Download PB binary + run Next.js natively | |

**User's choice:** Native dev (after asking how similar apps do it)
**Notes:** User asked about Actual Budget and similar projects. Explained the "develop natively, ship in Docker" pattern.

---

## PocketBase Admin Exposure

| Option | Description | Selected |
|--------|-------------|----------|
| Accessible at /_/ | Protected by PB's own admin auth. Standard for PB apps. | ✓ |
| Disabled by default | Blocked unless ENABLE_PB_ADMIN=true | |
| Separate port | Admin only on 8090, not exposed in default compose | |

**User's choice:** Accessible
**Notes:** User mentioned future OAuth providers (Facebook, Google, mobile number). Noted as deferred — PB supports this via admin UI config.

---

## Reverse Proxy / Port Exposure

| Option | Description | Selected |
|--------|-------------|----------|
| Single port with internal proxy | One port serves everything via internal Caddy | ✓ |
| Two ports exposed | 3000 for UI, 8090 for PB API | |
| Next.js proxies PB | API routes proxy to PB. Breaks realtime. | |

**User's choice:** Single port (after asking how Sonarr handles it)
**Notes:** User also asked about docker run vs compose — confirmed both will be supported and documented.

---

## Testing

| Option | Description | Selected |
|--------|-------------|----------|
| Vitest + Playwright | Unit/integration + E2E browser tests | ✓ |
| Vitest only | No browser E2E tests | |
| Minimal (lint + type-check) | No test framework | |

**User's choice:** Vitest + Playwright

---

## GitHub Setup

| Option | Description | Selected |
|--------|-------------|----------|
| Public repo from start | MIT, public from day 1, GitHub Actions CI/CD | ✓ |
| Private then public | Build privately until v1, then open-source | |
| Just the basics | Minimal setup, skip workflow discussion | |

**User's choice:** Public from start

---

## Remote Access

| Option | Description | Selected |
|--------|-------------|----------|
| Direct IP | Access via http://[vps-ip]:port. Zero setup. | ✓ |
| Tailscale | Private HTTPS via Tailscale network | |
| Caddy + domain | Point domain at VPS for HTTPS | |

**User's choice:** Direct IP
**Notes:** VPS has UFW with ports 22, 80, 443 open. Port 3000 not open — use port 80 mapping or open 3000.

---

## Claude's Discretion

- Internal Caddy config, s6-overlay service structure, Dockerfile multi-stage layout, GitHub Actions workflow details

## Deferred Ideas

- OAuth providers (Google, Facebook, mobile number) — future
- Tailscale/Caddy HTTPS compose variants — Phase 7
- PWA install testing — requires HTTPS
