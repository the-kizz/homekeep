# Phase 1: Scaffold & Infrastructure - Research

**Researched:** 2026-04-20
**Domain:** Single-container self-hosted web app (Next.js + PocketBase + Caddy under s6-overlay v3)
**Confidence:** HIGH

## Summary

This phase produces a working multi-arch Docker image that runs Next.js 16 + PocketBase 0.37 + an internal Caddy reverse proxy under s6-overlay v3, exposing a single port. The image boots, serves a hello page through Caddy, proxies `/api/*` and `/_/` to PocketBase, routes everything else to Next.js, and answers `/api/health` with a combined status. A native dev workflow (`npm run dev`) runs Next.js and PocketBase side-by-side without Docker for day-to-day coding. GitHub Actions builds multi-arch images on tag push to GHCR. Repo has MIT license, branch protection, and a Vitest + Playwright scaffold.

Two things shifted significantly from STACK.md's training-data assumptions and must be honored: **Next.js is now at 16.2.4** (not 15.x) and **PocketBase is at 0.37.1** (not 0.22-0.25). PocketBase made a major API/SDK change in v0.23 (admins became `_superusers` auth records, Router switched from echo to net/http, error `code` field renamed to `status`). All references to "0.25" in earlier research docs are stale — verified the current release contract directly against the binary.

**Primary recommendation:** Build a three-stage Alpine-based Dockerfile (deps → next-build → runtime with s6-overlay). Caddy runs as the first s6 service and listens on the single exposed port 3000. Next.js standalone runs on an internal port (3001). PocketBase runs on internal 8090. All three processes are managed by s6-overlay longrun services. Volume is `/app/data` containing `pb_data/` only. `.env.example` lists SITE_URL and NTFY_URL — no PB admin bootstrap env vars (PocketBase installer flow handles that).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Process Management**
- **D-01:** Use s6-overlay as the process manager inside the container. It's tiny (~2MB), handles signal propagation properly, auto-restarts crashed processes, and is the linuxserver.io standard. Preferred over supervisord (too heavy, +30MB Python deps) and custom bash scripts (no auto-restart).

**Port & Routing Architecture**
- **D-02:** Single exposed port (3000 internal) with an internal Caddy instance routing traffic: `/api/*` and `/_/` → PocketBase (port 8090 internal), everything else → Next.js. Users map this single port to any external port they choose.
- **D-03:** The PocketBase JS SDK URL from the browser is just `window.location.origin` (same-origin, thanks to internal proxy). No separate PB URL config needed for end users.
- **D-04:** Support both `docker compose up` AND standalone `docker run -p 80:3000 -v ./data:/app/data --env-file .env ghcr.io/owner/homekeep:latest`. Document both in README.

**PocketBase Admin**
- **D-05:** PocketBase admin UI at `/_/` is accessible in production, protected by PB's own admin auth. Do not gate it behind an env var. Future OAuth providers (Google, Facebook, etc.) can be configured via this admin UI without code changes.

**Development Environment**
- **D-06:** Native dev workflow: `npm run dev` for Next.js (instant hot reload) + PocketBase binary running locally (or in a minimal dev container). Docker is for building the production image, not for day-to-day coding.
- **D-07:** Include a `Makefile` or `package.json` scripts for common dev tasks: `dev` (start both), `dev:next` (Next.js only), `dev:pb` (PocketBase only), `build` (Docker image), `test` (Vitest), `test:e2e` (Playwright).

**Testing**
- **D-08:** Vitest for unit/integration tests, Playwright for E2E tests. CI runs both on every PR. Lint (ESLint) + type-check (tsc) + test (Vitest) + E2E (Playwright) as the CI pipeline.

**GitHub & CI/CD**
- **D-09:** Public GitHub repo from day 1. MIT license. GitHub Actions for CI (lint/test on PR) and release (multi-arch build → GHCR on tag push).
- **D-10:** Branch protection on main: require PR, require CI pass. Development on feature branches.

**VPS & Remote Access**
- **D-11:** This VPS (Hetzner, Ubuntu 24.04) is the dev environment. UFW firewall has ports 22, 80, 443 open. For dev access, map container to port 80 (already open) or open port 3000 (`ufw allow 3000/tcp`). Direct IP access for now — HTTPS/Tailscale added in Phase 7 compose variants.

### Claude's Discretion

- Internal Caddy config specifics (routing rules, headers)
- s6-overlay service directory structure
- Exact PocketBase binary download/management in dev
- Dockerfile multi-stage build structure
- GitHub Actions workflow specifics (matrix, caching)

### Deferred Ideas (OUT OF SCOPE)

- OAuth providers (Google, Facebook, mobile number) — future, configured via PB admin UI when needed
- Tailscale/Caddy HTTPS — Phase 7
- PWA testing — needs HTTPS, deferred until compose variants exist
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INFR-01 | Single Docker image with Next.js + PocketBase (s6-overlay per D-01) | Standard Stack + Dockerfile pattern §Architecture Patterns |
| INFR-02 | Multi-arch image: linux/amd64 + linux/arm64 | GitHub Actions pattern §Multi-Arch Build, PocketBase binary per-arch download |
| INFR-03 | Final image under 300MB | Size budget analysis §Image Size Budget |
| INFR-04 | Single `./data` volume for all persistence (PB DB + uploads) | Volume layout §Volume Strategy; `pb_data/` under `/app/data` |
| INFR-05 | `/api/health` endpoint for Docker / Uptime Kuma | Health endpoint pattern §Pattern 6 (verified PB endpoint live) |
| INFR-06 | Three compose variants: LAN-only (default), Caddy, Tailscale | Only base `docker-compose.yml` (LAN) in this phase; Caddy/Tailscale deferred to Phase 7 per CONTEXT deferred list |
| INFR-10 | Env-driven config — no hardcoded URLs, paths, or secrets | `.env.example` strategy §Environment Variables |
| INFR-11 | `.env.example` with structure, real `.env` git-ignored | §Environment Variables + `.gitignore` |
| INFR-12 | MIT license, public GitHub repo | §Repo Bootstrap |

**Scope clarification for INFR-06:** CONTEXT.md defers Caddy/Tailscale compose variants to Phase 7. Phase 1 ships only the default LAN compose file, but the Dockerfile and internal architecture must not block the future variants (i.e., `/api/*` routing through the single port is the foundation for both external proxies).
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| HTTP ingress / path-based routing | Internal Caddy (container) | — | Single exposed port; path-based fan-out to Next.js vs PocketBase |
| Static assets (`.next/static`, `public/`) | Next.js standalone server | Internal Caddy (as passthrough) | Next.js's `server.js` serves these when copied into the standalone dir |
| SSR / App Router pages | Next.js standalone server | — | Server-rendered HTML for initial load |
| `/api/health` aggregated status | Next.js API route | — | Only Next.js can poll both itself and PocketBase and return a combined JSON |
| Auth, collections, REST API | PocketBase | — | PB is the database + auth server; all business data flows here |
| Realtime (SSE) | PocketBase | Internal Caddy (`flush_interval -1` passthrough) | Caddy must NOT buffer SSE; PB emits events |
| Admin UI (`/_/`) | PocketBase | Internal Caddy (passthrough) | PB's built-in admin dashboard at the `/_/` path |
| Process lifecycle / supervision | s6-overlay v3 | — | Three longrun services (caddy, pocketbase, nextjs) with dependency ordering |
| Image build / multi-arch | GitHub Actions + Buildx + QEMU | Docker Hub/GHCR | CI builds, GHCR hosts |
| Dev-mode process coordination | `concurrently` (npm) | — | Native `npm run dev` runs Next.js + local PB binary without Docker |

## Standard Stack

### Core (runtime inside container)

| Library / Tool | Version | Purpose | Why Standard |
|----------------|---------|---------|--------------|
| Node.js | 22 LTS (alpine) | Next.js runtime | Spec §13; LTS, small Alpine base [VERIFIED: `node:22-alpine` pulls libc6-compat-free, node v22.22.0 locally] |
| Next.js | 16.2.4 | UI + SSR + API routes | [VERIFIED: npm view next version → 16.2.4, 2026-04-15]. **Major correction from STACK.md which assumed 15.x**; Next 16 requires React 19 and Node ≥ 20.9.0 |
| React / React-DOM | 19.2.5 | UI runtime | [VERIFIED: npm view react version] Required peer of Next 16 |
| PocketBase binary | 0.37.1 | DB + auth + admin UI | [VERIFIED: github.com/pocketbase/pocketbase/releases/tag/v0.37.1 published 2026-04-19]. Downloaded and smoke-tested locally — `/api/health` returns 200 `{"message":"API is healthy.","code":200,"data":{}}` |
| PocketBase JS SDK | 0.26.8 | Client library | [VERIFIED: npm view pocketbase version]. Pin to match server major/minor |
| Caddy | 2.11.2 (alpine image) | Internal reverse proxy | [VERIFIED: github.com/caddyserver/caddy/releases/tag/v2.11.2 published 2026-03-06]. Single binary, SSE-safe via `flush_interval -1` |
| s6-overlay | 3.2.2.0 | Process supervisor | [VERIFIED: github.com/just-containers/s6-overlay/releases/tag/v3.2.2.0 published 2026-01-24]. ~2MB, linuxserver.io standard [CITED: linuxserver/docker-baseimage-alpine Dockerfile] |

### Build / Dev / Test

| Library | Version | Purpose | Confidence |
|---------|---------|---------|------------|
| TypeScript | 6.0.3 | Type safety | [VERIFIED: npm view] |
| Tailwind CSS | 4.2.2 | Utility CSS | [VERIFIED: npm view]. v4 uses CSS-first config; shadcn/ui v4.3.1 [VERIFIED] supports it |
| shadcn CLI | 4.3.1 | Component scaffolder | [VERIFIED]. Not a runtime dep; copies source |
| ESLint | 10.2.1 | Linter | [VERIFIED] |
| eslint-config-next | 16.2.4 | Next.js lint preset | [VERIFIED], matches Next 16.2.4 |
| Vitest | 4.1.4 | Unit/integration tests | [VERIFIED]. ESM-native, Next.js 16 compatible |
| @testing-library/react | 16.3.2 | React component tests | [VERIFIED] |
| jsdom | 29.0.2 | Vitest DOM env | [VERIFIED] |
| @playwright/test | 1.59.1 | E2E tests | [VERIFIED]. Next 16 declares it as optional peer dep |
| concurrently | 9.2.1 | Dev: run Next+PB in parallel | [VERIFIED]. Alternative: `npm-run-all2` 8.0.4. `concurrently` preferred — cleaner Ctrl+C handling |
| date-fns | 4.3.6 | Date math | [VERIFIED] |
| zod | 4.1.0 | Schema validation | [VERIFIED]. Major bump from v3 (STACK.md was stale) |

### Base images

| Image | Tag | Size (est) | Purpose |
|-------|-----|------------|---------|
| `node:22-alpine` | 22-alpine | ~130 MB | Build stage (has npm, git for deps) |
| `node:22-alpine` | 22-alpine | same | Runtime base (includes Node for `server.js`) |
| `caddy:2.11.2-alpine` | 2.11.2-alpine | ~50 MB | Source for `COPY --from` to grab the caddy binary |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| s6-overlay | supervisord | +30MB Python deps; rejected by D-01 |
| s6-overlay | tini + entrypoint.sh | No auto-restart on process crash; rejected by D-01 |
| Caddy internal proxy | Next.js `rewrites: /api → :8090` | Breaks SSE/WS realtime (Pitfall #10, #5 from PITFALLS.md); also confuses dual-port separation (`window.location.origin` wouldn't work cleanly) |
| concurrently | npm-run-all2 | Either works; concurrently has nicer output and name prefixing |
| standalone Caddy binary in image | `caddy:alpine` image as source | Standalone binary saves ~10MB — use `COPY --from=caddy:2.11.2-alpine /usr/bin/caddy /usr/bin/caddy` |

**Installation (scaffold time):**

```bash
# Next.js 16 with App Router
npx create-next-app@16.2.4 homekeep --typescript --tailwind --eslint --app --no-src-dir --no-turbopack

cd homekeep

# Runtime deps
npm install pocketbase@0.26.8 date-fns@4.3.6 zod@4.1.0

# Dev deps
npm install -D concurrently@9.2.1 vitest@4.1.4 @vitejs/plugin-react \
  @testing-library/react@16.3.2 @testing-library/jest-dom jsdom@29.0.2 \
  @playwright/test@1.59.1

# shadcn/ui init (prompts)
npx shadcn@4.3.1 init
```

**Version verification:** All versions above were verified via `npm view <pkg> version` on 2026-04-20. Re-verify immediately before scaffold to catch any new patch releases.

## Architecture Patterns

### System Architecture Diagram

```
                           External client
                               │  (HTTP on host port, user-chosen)
                               ▼
         ┌─────────────────────────────────────────────────────┐
         │ Docker container: ghcr.io/owner/homekeep           │
         │                                                     │
         │  EXPOSE 3000  ← single internal port                │
         │       │                                             │
         │       ▼                                             │
         │  ┌──────────────────┐  s6-rc longrun #1             │
         │  │ Caddy :3000      │  routes by path:              │
         │  │                  │    /api/*  →  :8090           │
         │  │  flush_interval  │    /_/*    →  :8090           │
         │  │  -1 (SSE safe)   │    /*      →  :3001           │
         │  └──┬───────────┬───┘                               │
         │     │           │                                   │
         │     ▼           ▼                                   │
         │  ┌────────┐ ┌────────────────────┐                 │
         │  │ PB     │ │ Next.js standalone │                  │
         │  │ :8090  │ │ server.js :3001    │                  │
         │  │        │ │                    │                  │
         │  │ s6 #2  │ │ /api/health polls  │                  │
         │  │ dep:   │ │   pb:8090 internal │                  │
         │  │ base   │ │                    │                  │
         │  │        │ │ s6 #3, dep: pb-rdy │                  │
         │  └───┬────┘ └────────────────────┘                  │
         │      │                                               │
         │      ▼                                               │
         │  /app/data/pb_data/   ← volume mount                │
         │     data.db (SQLite + WAL)                          │
         │     storage/ (uploads)                              │
         │                                                     │
         │  /app/pb_migrations/  ← copied from image (RO)      │
         └─────────────────────────────────────────────────────┘
                                │
                                ▼
                        Host bind mount
                        ./data/pb_data/  (local FS only — Pitfall #1)
```

**Traceable use cases:**
- *Hello page:* browser → Caddy:3000 → Next.js:3001 → React page with "HomeKeep" heading
- *PB admin:* browser → `/_/` → Caddy → PocketBase → admin UI HTML
- *Health check:* Docker → Caddy `/api/health` → matches `/api/*` → PocketBase `/api/health` (PB returns `{message:"API is healthy."}`); note: the Next.js `/api/health` route is at `/api/health` too — see §Critical Design Choice below
- *Realtime (future):* browser → Caddy `/api/realtime` (SSE) → `flush_interval -1` passthrough → PocketBase SSE stream

### Critical Design Choice: `/api/health` ownership

Both Next.js (`app/api/health/route.ts`) and PocketBase (`/api/health`) want to own this path. Two viable resolutions:

**Option A (recommended):** Caddy routes `/api/health` → Next.js BEFORE the `/api/*` catch-all. Next.js internally `fetch`es `http://127.0.0.1:8090/api/health` and returns a combined JSON (`{nextjs:"ok", pocketbase:"ok"}`). This is what the Docker HEALTHCHECK hits. Matches INFR-05 exactly — a single endpoint that reports whole-container health.

**Option B:** Mount Next.js health at `/healthz` (not `/api/health`) to avoid the collision. Simpler routing but breaks the "standard" `/api/health` convention Uptime Kuma users expect.

**Go with Option A.** The Caddyfile orders specific matchers before `/api/*`:

```caddyfile
:3000 {
	handle /api/health {
		reverse_proxy localhost:3001
	}

	handle /api/* {
		reverse_proxy localhost:8090 {
			flush_interval -1
		}
	}

	handle /_/* {
		reverse_proxy localhost:8090 {
			flush_interval -1
		}
	}

	handle {
		reverse_proxy localhost:3001
	}
}
```

[CITED: caddyserver.com/docs/caddyfile/directives/reverse_proxy — `flush_interval -1` disables response buffering for SSE]

### Recommended Project Structure

```
homekeep/
├── app/                        # Next.js App Router
│   ├── api/
│   │   └── health/
│   │       └── route.ts        # GET: pings localhost:8090/api/health, returns combined
│   ├── layout.tsx
│   └── page.tsx                # Hello page (phase 1 placeholder)
├── components/                 # (shadcn/ui copies here)
├── lib/
│   └── pocketbase.ts           # PB SDK factory (browser vs server)
├── pocketbase/
│   └── pb_migrations/          # schema as code (empty at phase 1; populated in phase 2)
├── public/                     # static assets; NOT auto-copied to standalone
├── docker/
│   ├── Dockerfile
│   ├── Caddyfile
│   ├── s6-rc.d/
│   │   ├── caddy/
│   │   │   ├── type            # "longrun"
│   │   │   ├── run             # #!/command/with-contenv sh ; exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
│   │   │   └── dependencies.d/base    (empty)
│   │   ├── pocketbase/
│   │   │   ├── type            # "longrun"
│   │   │   ├── run             # exec pocketbase serve --http=127.0.0.1:8090 --dir=/app/data/pb_data --migrationsDir=/app/pb_migrations
│   │   │   └── dependencies.d/base    (empty)
│   │   ├── nextjs/
│   │   │   ├── type            # "longrun"
│   │   │   ├── run             # exec node /app/server.js
│   │   │   └── dependencies.d/base    (empty)
│   │   └── user/contents.d/
│   │       ├── caddy           (empty file — registers in default bundle)
│   │       ├── pocketbase      (empty file)
│   │       └── nextjs          (empty file)
│   └── docker-compose.yml      # LAN-only default; Caddy/Tailscale variants in phase 7
├── tests/
│   ├── unit/                   # vitest
│   │   └── smoke.test.ts       # trivial passing test
│   └── e2e/                    # playwright
│       └── hello.spec.ts       # hits / and checks for "HomeKeep" text
├── .github/workflows/
│   ├── ci.yml                  # lint, typecheck, test, e2e on PR
│   └── release.yml             # multi-arch build + push to GHCR on v* tag
├── .env.example
├── .gitignore
├── .dockerignore
├── LICENSE                     # MIT
├── README.md
├── package.json
├── next.config.ts              # { output: 'standalone' }
├── tsconfig.json
├── vitest.config.ts
└── playwright.config.ts
```

### Pattern 1: Multi-Stage Dockerfile

**What:** Three stages — deps install, Next build, runtime with s6-overlay.

**When:** Always for production image.

**Example:**

```dockerfile
# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22-alpine
ARG PB_VERSION=0.37.1
ARG S6_OVERLAY_VERSION=3.2.2.0
ARG CADDY_VERSION=2.11.2

############################################
# 1. deps: lockfile-only npm install
############################################
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

############################################
# 2. builder: next build → .next/standalone
############################################
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

############################################
# 3. runtime: alpine + s6 + caddy + pb + next
############################################
FROM node:${NODE_VERSION} AS runtime
ARG TARGETARCH
ARG PB_VERSION
ARG S6_OVERLAY_VERSION

RUN apk add --no-cache xz ca-certificates tzdata curl \
    && rm -rf /var/cache/apk/*

# --- s6-overlay v3 ---
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz /tmp/
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz.sha256 /tmp/
RUN cd /tmp && sha256sum -c s6-overlay-noarch.tar.xz.sha256 && tar -C / -Jxpf s6-overlay-noarch.tar.xz

# s6 arch tarball uses x86_64 / aarch64 names; map from TARGETARCH
RUN case "${TARGETARCH}" in \
      amd64) S6_ARCH=x86_64 ;; \
      arm64) S6_ARCH=aarch64 ;; \
      *) echo "Unsupported arch: ${TARGETARCH}" && exit 1 ;; \
    esac \
    && curl -fsSL -o /tmp/s6-arch.tar.xz \
       "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-${S6_ARCH}.tar.xz" \
    && curl -fsSL -o /tmp/s6-arch.tar.xz.sha256 \
       "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-${S6_ARCH}.tar.xz.sha256" \
    && cd /tmp && sha256sum -c s6-arch.tar.xz.sha256 \
    && tar -C / -Jxpf s6-arch.tar.xz \
    && rm -f /tmp/s6-*

# --- Caddy (grab static binary from official image) ---
COPY --from=caddy:2.11.2-alpine /usr/bin/caddy /usr/bin/caddy

# --- PocketBase ---
RUN case "${TARGETARCH}" in \
      amd64) PB_ARCH=amd64 ;; \
      arm64) PB_ARCH=arm64 ;; \
      *) echo "Unsupported arch: ${TARGETARCH}" && exit 1 ;; \
    esac \
    && curl -fsSL -o /tmp/pb.zip \
       "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${PB_ARCH}.zip" \
    && curl -fsSL -o /tmp/pb.sha \
       "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/checksums.txt" \
    && grep "pocketbase_${PB_VERSION}_linux_${PB_ARCH}.zip" /tmp/pb.sha | sha256sum -c - \
    && unzip -q /tmp/pb.zip -d /usr/local/bin/ \
    && chmod +x /usr/local/bin/pocketbase \
    && rm -f /tmp/pb.*

# --- Next.js standalone output ---
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# --- App assets ---
COPY pocketbase/pb_migrations /app/pb_migrations
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY docker/s6-rc.d /etc/s6-overlay/s6-rc.d

# --- Data dir ---
RUN mkdir -p /app/data/pb_data \
    && chown -R node:node /app/data

ENV NODE_ENV=production \
    HOSTNAME=127.0.0.1 \
    PORT=3001 \
    S6_KEEP_ENV=1 \
    S6_BEHAVIOUR_IF_STAGE2_FAILS=2 \
    S6_VERBOSITY=1

EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["/init"]
```

Notes verified against official sources:
- Alpine s6 requires `xz` package [CITED: just-containers/s6-overlay README]
- `/init` is the s6-overlay v3 entrypoint [CITED: same]
- `S6_BEHAVIOUR_IF_STAGE2_FAILS=2` = stop container if init fails [CITED: s6-overlay docs]
- `S6_KEEP_ENV=1` keeps container env vars visible to services (we need `NTFY_URL`, `SITE_URL` in Next.js) [CITED: s6-overlay docs]
- Next.js standalone requires manual `public/` and `.next/static/` copy [CITED: nextjs.org/docs/app/api-reference/config/next-config-js/output, v16.2.4]
- PocketBase checksum file `checksums.txt` exists at that URL [VERIFIED: curl https://github.com/pocketbase/pocketbase/releases/download/v0.37.1/checksums.txt returns SHA256 list]
- PocketBase `serve --http=` flag syntax [VERIFIED: local `./pocketbase serve --help`]

### Pattern 2: s6-overlay v3 longrun service

**What:** Each process gets a directory under `/etc/s6-overlay/s6-rc.d/<name>/` with a `type` file, a `run` executable, and an empty `dependencies.d/base` file. Register the service in the default `user` bundle via `contents.d/`.

**When:** Always, for every process that must run in the container.

**Example — `docker/s6-rc.d/nextjs/run`:**

```sh
#!/command/with-contenv sh
cd /app
exec node server.js
```

**`docker/s6-rc.d/nextjs/type`:**

```
longrun
```

**Register in default bundle:** `docker/s6-rc.d/user/contents.d/nextjs` (empty file)

**Startup ordering:** s6-overlay v3 starts all services in the `user` bundle in parallel unless `dependencies.d/` declares otherwise. For HomeKeep, all three start in parallel — Caddy will return 502 briefly if a backend isn't ready, but Docker's `start-period=30s` in HEALTHCHECK tolerates that. An explicit dependency is not needed because Caddy retries upstream connections transparently.

**Signal handling:** s6-overlay v3 handles SIGTERM correctly — it stops all services in reverse dependency order, allowing PocketBase to checkpoint its SQLite WAL cleanly before exit. No custom `finish` script needed for phase 1.

[CITED: just-containers/s6-overlay README — longrun type, dependencies.d, user bundle, SIGTERM behavior]

### Pattern 3: Next.js 16 Standalone Output

**What:** `next.config.ts` exports `{ output: 'standalone' }`. Build produces `.next/standalone/server.js` + minimal `node_modules`. Public assets must be copied manually.

**When:** Always for Docker.

**Example — `next.config.ts`:**

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // No NEXT_PUBLIC_* that vary per deployment (Pitfall #3 in PITFALLS.md)
};

export default nextConfig;
```

**Required Dockerfile copies** (shown in Pattern 1):

```dockerfile
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
```

**Env at runtime:** `HOSTNAME=127.0.0.1` (bind to loopback only, Caddy routes external), `PORT=3001` (avoid collision with Caddy's 3000).

[CITED: nextjs.org/docs/app/api-reference/config/next-config-js/output]

### Pattern 4: Combined Health Endpoint

**What:** `app/api/health/route.ts` polls PocketBase's `/api/health` over loopback and returns combined status.

**When:** Always. Required by INFR-05 and Docker HEALTHCHECK.

**Example:**

```ts
// app/api/health/route.ts
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const nextjs = 'ok';
  let pocketbase: 'ok' | 'unhealthy' | 'unreachable' = 'unreachable';
  let pbCode: number | null = null;

  try {
    const res = await fetch('http://127.0.0.1:8090/api/health', {
      signal: AbortSignal.timeout(3000),
      cache: 'no-store',
    });
    pbCode = res.status;
    pocketbase = res.ok ? 'ok' : 'unhealthy';
  } catch {
    pocketbase = 'unreachable';
  }

  const ok = pocketbase === 'ok';
  return NextResponse.json(
    { status: ok ? 'ok' : 'degraded', nextjs, pocketbase, pbCode },
    { status: ok ? 200 : 503 }
  );
}
```

**PocketBase response shape (verified live):** `{"message":"API is healthy.","code":200,"data":{}}` with HTTP 200.

[VERIFIED: local smoke test against pocketbase 0.37.1 binary]

### Pattern 5: Environment-Aware PocketBase Client

**What:** Single `lib/pocketbase.ts` factory that returns the right URL for browser vs server context.

**When:** Always.

**Example:**

```ts
// lib/pocketbase.ts
import PocketBase from 'pocketbase';

export function createClient() {
  if (typeof window === 'undefined') {
    // Server-side: inside the container, PB is on loopback
    return new PocketBase('http://127.0.0.1:8090');
  }
  // Browser-side: same origin as the page (Caddy proxies /api/* to PB)
  return new PocketBase(window.location.origin);
}
```

Critical consequence of D-03: the browser uses `window.location.origin` — NOT a `NEXT_PUBLIC_POCKETBASE_URL`. This sidesteps Pitfall #3 entirely (no build-time env leakage). The URL is dynamic per request because Caddy fronts everything.

### Pattern 6: Native Dev Workflow (non-Docker)

**What:** `npm run dev` starts Next.js (with Turbopack? see below) AND downloads/runs PocketBase locally. All in foreground, Ctrl+C stops both.

**When:** Default development workflow per D-06.

**`package.json` scripts:**

```json
{
  "scripts": {
    "dev": "concurrently -n next,pb -c cyan,magenta \"npm:dev:next\" \"npm:dev:pb\"",
    "dev:next": "next dev --port 3001",
    "dev:pb": "node scripts/dev-pb.js",
    "build": "next build",
    "start": "next start --port 3001",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "docker:build": "docker buildx build --platform linux/amd64 -t homekeep:dev --load -f docker/Dockerfile .",
    "docker:run": "docker run --rm -p 3000:3000 -v \"$(pwd)/data:/app/data\" --env-file .env homekeep:dev"
  }
}
```

**`scripts/dev-pb.js`** (downloads PB on first run, stores under `./.pb/`, not committed):

```js
// scripts/dev-pb.js
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { execSync } from 'node:child_process';

const PB_VERSION = '0.37.1';
const PB_DIR = './.pb';
const PB_BIN = `${PB_DIR}/pocketbase`;

const platform = process.platform === 'darwin' ? 'darwin' : 'linux';
const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';

if (!existsSync(PB_BIN)) {
  console.log(`[dev-pb] downloading PocketBase ${PB_VERSION} (${platform}/${arch})...`);
  mkdirSync(PB_DIR, { recursive: true });
  const url = `https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_${platform}_${arch}.zip`;
  const zipPath = `${PB_DIR}/pb.zip`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(zipPath));
  execSync(`unzip -o ${zipPath} -d ${PB_DIR}`);
}

const pb = spawn(PB_BIN, [
  'serve',
  '--http=127.0.0.1:8090',
  '--dir=./.pb/pb_data',
  '--migrationsDir=./pocketbase/pb_migrations',
  '--dev',
], { stdio: 'inherit' });

process.on('SIGINT', () => pb.kill('SIGINT'));
process.on('SIGTERM', () => pb.kill('SIGTERM'));
pb.on('exit', (code) => process.exit(code ?? 0));
```

Notes:
- `--dev` enables verbose logging and SQL printing (safe in dev only)
- `./.pb/` is git-ignored; contains binary + dev data
- `./pocketbase/pb_migrations/` IS committed — the schema lives there (phase 2 populates it)
- In dev, browser hits `http://localhost:3001` → Next.js renders with `window.location.origin === 'http://localhost:3001'`. The PB SDK factory must detect dev and override to `http://localhost:8090`. **Simplest fix:** in dev only, set `NEXT_PUBLIC_POCKETBASE_URL=http://localhost:8090` via `.env.local`; in production, leave unset (factory falls through to `window.location.origin`).

**Turbopack note:** Next.js 16's default dev server is now Turbopack; `--no-turbopack` flag from scaffold command above opts out if it breaks. Phase 1 assumes Turbopack works fine for the hello page — reevaluate in phase 2 if HMR misbehaves.

**CORS in dev:** PocketBase `--origins` flag defaults to `*` [VERIFIED from `./pocketbase serve --help`]. No CORS config needed for dev.

### Pattern 7: Multi-Arch GitHub Actions Release

**What:** Workflow triggered on `v*` tag push. QEMU emulates arm64 on the amd64 runner. buildx produces a multi-platform manifest pushed to GHCR.

**When:** Always, for production releases.

**`.github/workflows/release.yml`:**

```yaml
name: Release
on:
  push:
    tags: ['v*']

permissions:
  contents: read
  packages: write

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - uses: docker/setup-qemu-action@v4

      - uses: docker/setup-buildx-action@v4

      - uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=raw,value=latest,enable={{is_default_branch}}

      - uses: docker/build-push-action@v7
        with:
          context: .
          file: docker/Dockerfile
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          build-args: |
            PB_VERSION=0.37.1
            S6_OVERLAY_VERSION=3.2.2.0
```

**CI on PR (`.github/workflows/ci.yml`):**

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]

jobs:
  lint-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v5
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test
      - run: npx playwright install --with-deps chromium
      - run: npm run build
      - run: npm run test:e2e
```

**E2E strategy:** Playwright runs against the built Next.js (via `next start`). No PB in CI for phase 1 (the hello page doesn't touch it). Phase 2 introduces PB-dependent E2E; that phase will start the compiled Docker image in CI.

[CITED: github.com/docker/build-push-action — metadata-action + gha cache pattern]

### Anti-Patterns to Avoid

- **Exposing PocketBase on a second port.** ARCHITECTURE.md (older draft) suggested this; CONTEXT.md D-02 explicitly overrides. Single port only.
- **Using `NEXT_PUBLIC_POCKETBASE_URL` for production.** Bakes the URL into the bundle (Pitfall #3). Use `window.location.origin` in browser, loopback on server.
- **Proxying PocketBase through Next.js rewrites.** Breaks SSE for realtime (Pitfall #10, Anti-Pattern 5 in ARCHITECTURE.md). Caddy handles routing.
- **Running `pocketbase serve` as root in production.** Set up a `node` user for file ownership (Pitfall #9). Current Dockerfile chowns `/app/data` to `node`; s6 can `exec` as a specific user.
- **Supervisord or tini-only bash.** Rejected by D-01. Use s6-overlay.
- **Building arm64 natively unless runner available.** GitHub's `ubuntu-24.04-arm` runners exist but cost more minutes for private repos; public repo (D-09) could use them. For phase 1, QEMU via `setup-qemu-action` is fine — no native Node modules in the runtime (PB is a pre-built Go binary, Next.js standalone is pure JS). Pitfall #7 mitigated.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Process supervision | Custom bash `trap` + `&` | s6-overlay v3 | Signal handling, auto-restart, zombie reaping [D-01, Pitfall #4] |
| Internal reverse proxy | Node HTTP proxy server | Caddy 2.11.2 | SSE-safe out of the box (`flush_interval -1`), 40MB binary, maintained |
| Multi-arch image build | Custom QEMU setup | `docker/build-push-action@v7` | Solves cache, manifest, platform matrix [CITED: Docker docs] |
| Semver container tags | Manual string mangling in YAML | `docker/metadata-action@v5` | Parses git tags → latest + {major}.{minor} + {version} automatically |
| PocketBase download | Custom shell fetch | Release asset + official checksums.txt | Verified checksum file exists; use `sha256sum -c` |
| Next.js dev + PB dev side-by-side | Two terminals | `concurrently` | Single Ctrl+C, prefixed output, exit code aggregation |
| Health check logic | Docker `CMD` shell script | Next.js API route | Centralized status response, easy to extend to deeper checks in future phases |
| MIT license text | Hand-type | SPDX template | `gh repo create --license mit` or copy from https://spdx.org/licenses/MIT.html |

**Key insight:** Phase 1 is heavily reliant on mature, well-supported tooling. The only bespoke code should be: `app/api/health/route.ts`, `app/page.tsx` (hello), `lib/pocketbase.ts`, `scripts/dev-pb.js`, `Caddyfile`, s6 run scripts, and the Dockerfile. Everything else is configuration of existing tools.

## Common Pitfalls

### Pitfall 1: SQLite WAL + Docker volume on NFS/SMB (from PITFALLS.md #1)

**What goes wrong:** `pb_data/data.db` on a non-local filesystem silently corrupts.

**Why it happens:** WAL needs mmap; only works on local FS.

**How to avoid:**
- README must state: *"`./data` must be on a local filesystem. NFS, SMB, and most NAS-mounted paths will corrupt the database."*
- Phase 7 (deployment docs) expands this with platform-specific warnings
- The `/api/health` endpoint in later phases should optionally do a test write/read (phase 1 version just pings PB)

**Warning signs:** Intermittent 500s, "database is locked" in PB logs.

**Phase-1 action:** Add the warning to README template and the `.env.example` comments.

### Pitfall 2: Next.js standalone missing public/static assets (PITFALLS.md #2)

**What goes wrong:** Image builds; browser gets 404s for `/manifest.json`, `/_next/static/*`, icons.

**Why it happens:** `output: 'standalone'` does NOT copy `public/` or `.next/static/` automatically. Documented behavior.

**How to avoid:** The Pattern 1 Dockerfile includes the explicit COPY commands. Phase 1 verification MUST curl `/_next/static/...` (a CSS bundle) and confirm 200, not 404, against the built container.

**Warning signs:** Page renders but unstyled; DevTools Network shows 404s.

### Pitfall 3: Env vars baked at build time (PITFALLS.md #3)

**What goes wrong:** `NEXT_PUBLIC_POCKETBASE_URL=http://build-host:8090` gets hardcoded into the JS bundle in CI; every pulled image talks to the wrong host.

**How to avoid:** Phase 1 uses `window.location.origin` in browser, loopback on server (Pattern 5). ZERO `NEXT_PUBLIC_*` variables in the Dockerfile build. `.env.example` lists runtime-only vars (`NTFY_URL`, `SITE_URL`, `TZ`).

**Warning signs:** DevTools shows API requests to a hostname the user never configured.

**Phase-1 action:** Grep the final image filesystem (`docker run --rm <img> sh -c "grep -r NEXT_PUBLIC_ /app/.next/static/ | head"`) as a sanity check in CI — MUST return empty.

### Pitfall 4: Two-process lifecycle without supervision (PITFALLS.md #4)

**What goes wrong:** One process dies, the other keeps running, health check lies.

**How to avoid:** s6-overlay v3 handles auto-restart. The combined `/api/health` (Pattern 4) catches the case where PB dies but Next.js survives — returns 503.

**Phase-1 verification:** `docker exec <container> pkill pocketbase` → wait 5s → `curl /api/health` should transiently return 503, then 200 once s6 restarts PB.

### Pitfall 5: PocketBase version pinning (PITFALLS.md #12)

**What goes wrong:** Unpinned `latest` breaks on next rebuild; 0.22 → 0.37 had breaking changes (admins became `_superusers` in 0.23).

**How to avoid:** `ARG PB_VERSION=0.37.1` in Dockerfile; `pocketbase@0.26.8` exact-pin in package.json. Document version compatibility in README.

### Pitfall 6: Multi-arch QEMU flakiness (PITFALLS.md #7)

**What goes wrong:** arm64 builds segfault under QEMU, especially with native Node modules.

**How to avoid for phase 1:**
- No native Node modules in the runtime (verified: PocketBase is Go, Caddy is Go, Next.js standalone is pure JS, s6 is C but pre-compiled per arch)
- `sharp` is NOT installed in phase 1 (image optimization deferred)
- `cache-from/cache-to type=gha` keeps rebuilds fast
- If QEMU still fails, fall back to amd64-only for phase 1 and add arm64 in phase 7 per Pitfall #7 mitigation

**Warning signs:** release.yml times out (>20min) or segfaults in build logs.

### Pitfall 7: Volume permissions (PITFALLS.md #9)

**What goes wrong:** Host UID ≠ container UID; PB can't write to `/app/data`.

**How to avoid for phase 1:** Dockerfile chowns `/app/data` to `node` (UID 1000). Host users with UID 1000 (default Ubuntu) work immediately; others document in README:

```bash
# .env
PUID=1000
PGID=1000
```

An entrypoint customization to respect PUID/PGID is deferred — phase 1 assumes UID 1000 and documents it. Full linuxserver.io-style PUID handling is overkill for initial scaffold.

### Pitfall 8: Caddy route ordering collides `/api/health` paths

**What goes wrong:** Both PocketBase and Next.js have `/api/health`. If Caddy's `/api/*` matcher fires first, Docker HEALTHCHECK hits PB (which says OK) and we never notice when Next.js is broken.

**How to avoid:** Caddyfile `handle /api/health` block defined BEFORE `handle /api/*`. Caddy matches in order. Already encoded in the Pattern 1 Caddyfile.

**Warning signs:** Image starts, Docker says healthy, but browser shows Next.js errors.

**Phase-1 verification:** `curl -i http://localhost:3000/api/health` — response body must contain `"nextjs":"ok"` field (only Next.js's handler has that; PB's response has `"message"` only).

## Runtime State Inventory

*Greenfield project — section omitted per template guidance. No prior runtime state exists.*

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker | Image build, runtime | ✓ | 29.3.1 | — |
| Docker buildx | Multi-arch build | ✓ | v0.31.1 | — |
| Node.js | Dev + build | ✓ | 22.22.0 | — |
| npm | Package management | ✓ | 10.9.4 | — |
| git | Version control | ✓ | 2.43.0 | — |
| curl | Health check, PB download | ✓ | 8.5.0 | — |
| unzip | PB binary extraction | ✓ | (present) | python3 `zipfile` |
| GitHub CLI (`gh`) | Repo bootstrap (optional) | ✗ | — | Web UI for repo creation |
| make | Optional task runner | ✗ | — | `npm run` scripts cover D-07 |

**Missing dependencies with fallback:**
- `gh` — Not required; MIT license + branch protection can be configured via web UI. If automated repo setup is wanted, add `apt install gh` as a plan step.
- `make` — D-07 offers "Makefile OR package.json scripts". Use npm scripts exclusively; no Makefile needed.

**Missing dependencies with no fallback:** None.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Unit framework | Vitest 4.1.4 |
| E2E framework | Playwright 1.59.1 |
| Config files | `vitest.config.ts`, `playwright.config.ts` (Wave 0 creates both) |
| Quick run command | `npm run test` (Vitest) — runs in <5s at phase 1 scale |
| Full suite command | `npm run lint && npm run typecheck && npm run test && npm run build && npm run test:e2e` |
| Phase gate command | `docker buildx build ...` + `docker run ...` + E2E against running container |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INFR-01 | Container runs Next.js + PocketBase under s6 | E2E (container smoke) | `docker run homekeep:test` + `curl /api/health` returns 200 | ❌ Wave 0 |
| INFR-02 | Multi-arch manifest exists | CI check | `docker buildx imagetools inspect ghcr.io/.../homekeep:test` shows amd64 + arm64 | ❌ Wave 0 (release.yml) |
| INFR-03 | Image <300MB | CI check | `docker images --format '{{.Size}}' homekeep:test` parsed to MB, asserted <300 | ❌ Wave 0 |
| INFR-04 | Single `/app/data` volume | integration | Dockerfile lint: exactly one `VOLUME` directive. Smoke: stop → copy `./data` → start fresh → data restored | ❌ Wave 0 |
| INFR-05 | `/api/health` responds | unit + e2e | Unit: `vitest` tests the route handler with mocked fetch. E2E: `playwright` hits running container | ❌ Wave 0 |
| INFR-10 | No hardcoded URLs/paths/secrets | CI check | `grep -rE 'https?://[a-z0-9.]+:[0-9]+' app/ lib/ components/` should only return loopback patterns | ❌ Wave 0 |
| INFR-11 | `.env.example` committed, `.env` gitignored | CI check | File presence assertion + `git check-ignore .env` | ❌ Wave 0 |
| INFR-12 | MIT license, public repo | Manual (one-time) | README badge + `LICENSE` file + `gh repo view --json visibility` | ❌ Wave 0 |

Also covered:
- Caddy routing (Pitfall #8): E2E test curls `/api/health`, asserts body contains `"nextjs":"ok"` field
- Next.js standalone assets (Pitfall #2): E2E curl `/_next/static/...` returns 200 (test fetches main CSS bundle path from the homepage)
- PB admin reachable (D-05): E2E curl `/_/` returns 200
- Volume persistence (INFR-04): shell script in `tests/e2e/persistence.sh` or Playwright teardown routine

### Sampling Rate

- **Per task commit:** `npm run test` (Vitest, ~1-3s at phase 1 scope)
- **Per wave merge:** `npm run lint && npm run typecheck && npm run test` (~15s)
- **Phase gate:** Full suite including Docker build + container E2E (2-5 min locally)

### Wave 0 Gaps

- [ ] `vitest.config.ts` — jsdom env, setup file path
- [ ] `tests/setup.ts` — `@testing-library/jest-dom` import
- [ ] `tests/unit/health.test.ts` — tests `app/api/health/route.ts` with a mocked PB fetch
- [ ] `tests/unit/pocketbase.test.ts` — tests `lib/pocketbase.ts` factory returns correct URL in server vs browser
- [ ] `playwright.config.ts` — `webServer: { command: 'npm start', port: 3001 }` for non-container E2E; second project for container E2E
- [ ] `tests/e2e/hello.spec.ts` — hits `/`, asserts h1 contains "HomeKeep"
- [ ] `tests/e2e/health.spec.ts` — asserts `/api/health` returns 200 with `nextjs:"ok"` and `pocketbase:"ok"`
- [ ] `tests/e2e/static-assets.spec.ts` — fetches a `.next/static/` bundle link from the HTML, asserts 200 (Pitfall #2 regression guard)
- [ ] `tests/e2e/admin.spec.ts` — asserts `/_/` returns 200 (D-05 regression guard)
- [ ] `scripts/check-image-size.sh` — shell script parsing `docker images` output; exits non-zero if >300MB
- [ ] `scripts/check-multiarch.sh` — runs `docker buildx imagetools inspect` on the pushed image; exits non-zero if amd64 or arm64 missing

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | Phase 2+ | PocketBase built-in (bcrypt, rate-limited) — out of scope for phase 1 |
| V3 Session Management | Phase 2+ | PocketBase JWT — out of scope |
| V4 Access Control | Phase 2+ | PocketBase API rules — out of scope |
| V5 Input Validation | yes (health route) | zod 4.1.0 for any request parsing in phase 1 (none currently; health is GET-only) |
| V6 Cryptography | yes | `--encryptionEnv` flag available for PB settings-at-rest. Not configured in phase 1; defer to phase 7 deployment docs. SQLite WAL is plaintext on disk — document as expected for self-hosted single-tenant |
| V7 Error Handling | yes | Health route catches all errors; no stack traces leaked. Next.js default `error.tsx` boundary |
| V14 Configuration | yes | See Known Threat Patterns below |

### Known Threat Patterns for Phase 1

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| `.env` committed to git with secrets | Information Disclosure | `.gitignore` entry for `.env*` except `.env.example`; CI job fails if `.env` tracked |
| PocketBase admin UI exposed in production | Elevation of Privilege | D-05 accepts this risk — PB has rate-limited admin auth. Document that first-run admin setup link expires (JWT-based installer link observed in smoke test) |
| Docker image built with build-time secrets leaking into layers | Information Disclosure | No `--build-arg` for secrets (only version pins). Use `--secret id=X,src=...` mount pattern if ever needed. Enforce: no `ARG` whose name matches `*_TOKEN`, `*_KEY`, `*_SECRET` |
| Health endpoint reveals internal topology | Information Disclosure | Phase-1 response includes `pbCode` which could leak implementation. Acceptable for self-hosted single-tenant; future phases could gate verbose fields behind `NODE_ENV=development` |
| Caddy SSRF via crafted paths | Tampering / SSRF | Caddy only proxies to two fixed loopback addresses (`localhost:8090`, `localhost:3001`). No user input in upstream URLs. Safe. |
| GHCR image supply chain | Tampering | Checksums verified for PB + s6 tarballs. Consider cosign signing for phase 7; not required for phase 1 |
| Insecure CORS (`*`) | Tampering | PocketBase defaults `--origins=*`. Tighten via `--origins=$SITE_URL` in the s6 run script once SITE_URL is a production concept (phase 7). Phase 1: acceptable because only loopback reaches PB |
| Default container as root | Elevation of Privilege | Set `USER node` at end of Dockerfile OR configure s6 services to `exec` as `node`. Phase 1 minimum: s6 as PID 1 (root), each service switches to `node` via s6-setuidgid |

**Phase 1 secrets inventory:** Currently ZERO secrets. No API keys, no database passwords (PB creates its own superuser via install flow), no tokens. `.env.example` will document variables but none of them are secrets in phase 1:
- `SITE_URL` — public URL, not a secret
- `NTFY_URL` — public service URL, not a secret
- `TZ` — timezone string
- `PUID`/`PGID` — filesystem UIDs, not secrets

If/when secrets appear (phase 6 webhook URLs if sensitive), revisit threat model.

## Code Examples

### `.env.example`

```bash
# HomeKeep configuration
# Copy to .env and customize. Do NOT commit .env.

# Public URL of the app as end users reach it.
# Used for PWA manifest and ntfy notification links.
SITE_URL=http://localhost:3000

# ntfy server (default is public ntfy.sh)
NTFY_URL=https://ntfy.sh

# Timezone for scheduler and date display (IANA name)
TZ=Australia/Melbourne

# Host UID/GID for the ./data volume owner
# Match to your host user: run `id -u` and `id -g`
PUID=1000
PGID=1000
```

### `.gitignore` additions

```
# Dependencies
/node_modules
/.pnp
.pnp.*

# Next.js
/.next/
/out/
/build

# Testing
/coverage
/test-results
/playwright-report
/playwright/.cache

# Env
.env
.env.local
.env.*.local

# Dev PocketBase (dev-pb.js downloads binary + data here)
/.pb/

# Host-side data volume (runtime)
/data/

# IDE
.vscode/
.idea/
```

### `.dockerignore`

```
node_modules
.next
.git
.github
.env*
!.env.example
data
.pb
coverage
playwright-report
test-results
*.md
!README.md
```

### `docker/docker-compose.yml` (LAN-only default)

```yaml
services:
  homekeep:
    image: ghcr.io/${GHCR_OWNER:-owner}/homekeep:${TAG:-latest}
    container_name: homekeep
    restart: unless-stopped
    ports:
      - "${HOST_PORT:-3000}:3000"
    volumes:
      - ./data:/app/data
    env_file:
      - .env
    environment:
      - TZ=${TZ:-Etc/UTC}
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s
```

### LICENSE (MIT)

```
MIT License

Copyright (c) 2026 HomeKeep contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### `app/page.tsx` (phase-1 hello)

```tsx
export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold">HomeKeep</h1>
        <p className="mt-2 text-muted-foreground">
          Scaffolding complete. Phase 1 running.
        </p>
      </div>
    </main>
  );
}
```

### `scripts/check-image-size.sh`

```sh
#!/bin/sh
set -eu
IMAGE="${1:-homekeep:test}"
BYTES=$(docker inspect "$IMAGE" --format '{{.Size}}')
MB=$((BYTES / 1024 / 1024))
LIMIT=300
echo "Image $IMAGE = ${MB}MB (limit ${LIMIT}MB)"
if [ "$MB" -gt "$LIMIT" ]; then
  echo "FAIL: image exceeds ${LIMIT}MB"
  exit 1
fi
echo "OK"
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Next.js 15 App Router | Next.js 16 (default: Turbopack dev) | Next 16 GA sometime in 2025-2026 | STACK.md references 15.x — update to 16.2.4 everywhere; peer dep React 19 |
| PocketBase `_pb_admins` collection | PocketBase `_superusers` auth records | v0.23.0 | ARCHITECTURE.md references 0.25 patterns — the admin concept and SDK are different. CLI flags still compatible though |
| `supervisord` (Python) in Docker | `s6-overlay` v3 (statically linked C) | Industry shift ~2022-2023 | ARCHITECTURE.md suggested supervisord as primary, s6 as "alternative" — CONTEXT D-01 locks s6 |
| Two exposed ports (:3000 UI, :8090 PB) | Single port + internal Caddy | CONTEXT.md D-02 | Overrides ARCHITECTURE.md's two-port diagram. Browser uses `window.location.origin` (D-03), no `NEXT_PUBLIC_POCKETBASE_URL` |
| `npm-run-all` | `concurrently` v9 or `npm-run-all2` | 2024+ | `npm-run-all` unmaintained; both replacements current. Pick `concurrently` |
| Zod 3 | Zod 4 | 2025 | STACK.md pinned 3.x; current is 4.1.0. API is largely compatible; `.parseAsync`, `.safeParse` work the same |
| date-fns 3 | date-fns 4 | 2024 | STACK.md pinned 3.x; current is 4.3.6. ESM-first; function imports unchanged |
| Vitest 2 | Vitest 4 | 2025 | STACK.md pinned 2.x; current is 4.1.4. Config format compatible |

**Deprecated / outdated:**
- Next.js Pages Router — use App Router (already locked by spec)
- `next-pwa` — unmaintained; Serwist (`@serwist/next` 9.5.7) is the successor when PWA is revisited in phase 7
- `supervisord` for two-process containers — s6-overlay is the current standard
- `moment.js` — deprecated; date-fns 4 replaces
- `sharp` without setup — not in phase 1; phase 6+ if photo attachments needed

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | [ASSUMED] Next.js 16 Turbopack dev server works for a trivial phase-1 hello page with zero issues | Pattern 6 | Low — fallback is `next dev --no-turbopack`; phase 2 may revisit anyway |
| A2 | [ASSUMED] `caddy:2.11.2-alpine` image ships a `/usr/bin/caddy` binary that is statically linked and works when copied into `node:22-alpine` | Pattern 1 Dockerfile | Medium — if caddy dynamically links to Alpine musl, copy works. If it pulls debian libc, build fails. Mitigation: if `COPY --from=caddy:alpine` fails, install Caddy via `apk add caddy` or vendor via direct GitHub release download |
| A3 | [ASSUMED] s6-overlay v3 default parallel startup is OK for Caddy → Next+PB (Caddy will retry upstream during the ~1s startup window) | Pattern 2 | Low — if not, add `dependencies.d/pocketbase` under `caddy/` |
| A4 | [ASSUMED] Final image will fit under 300MB with this stack (node:22-alpine 130MB + PB 60MB binary + s6 10MB + caddy 40MB + Next standalone ~50MB = ~290MB estimate) | Image Size Budget | Medium — if over, switch to `node:22-alpine3.19` slim variant, or use a distroless-style final stage copying only Node.js runtime + all binaries. Measurement MUST happen in phase 1, see scripts/check-image-size.sh |
| A5 | [ASSUMED] `ubuntu-latest` GitHub runner (amd64) can cross-compile arm64 via QEMU within 20 minutes for this specific stack (no native deps) | Pattern 7 | Low — stack has no sharp/native modules; QEMU mainly runs `tar`, `unzip`, and file copies for arm64 image. Should be fast. |
| A6 | [ASSUMED] `node:22-alpine` includes the `node` user and group at UID/GID 1000 | Volume permissions | Low — verified by Docker library convention; `node` image has created the `node` user since v8 |
| A7 | [ASSUMED] shadcn/ui 4.3.1 fully supports Tailwind v4 without workarounds | Stack | Medium — STACK.md flagged this as MEDIUM confidence. Phase 1 only installs shadcn if needed for the hello page; defer heavy shadcn usage to phase 2. Verify via `npx shadcn init` during scaffold — if it errors, pin Tailwind to 3.4.x |
| A8 | [ASSUMED] PocketBase 0.37.1 auto-migrations flag (`--automigrate=true` default) is compatible with running migrations from a read-only `/app/pb_migrations` directory while data lives in writable `/app/data/pb_data` | Pattern 1 | Medium — auto-migrate writes to `data.db`, reads JS files from migrationsDir. Should work (migrations dir doesn't need to be writable). Phase 2 will exercise this in practice |

**If any assumption above breaks during execution:** it becomes a scoped question for the user or a small in-plan adjustment. None are plan-stoppers.

## Open Questions

1. **Should phase 1 include a basic shadcn/ui setup (Button, Card) or defer entirely to phase 2?**
   - What we know: CONTEXT.md doesn't mandate it; the hello page in phase 1 only needs a heading.
   - What's unclear: Does the "scaffold is complete" bar include "shadcn ready to go" or just "Next+Tailwind set up"?
   - Recommendation: **Defer shadcn init to phase 2.** Phase 1 ships with plain Tailwind + next-lint working; phase 2 (UI phase) runs `npx shadcn init` and installs Button/Card/Dialog as part of that phase's work. Reduces phase-1 surface area.

2. **Phase 1 uses only the LAN-only compose variant — should it also stub `docker-compose.caddy.yml` and `docker-compose.tailscale.yml` as placeholders?**
   - What we know: INFR-06 lists all three variants; CONTEXT.md deferred list explicitly defers Tailscale/Caddy to phase 7.
   - What's unclear: Do we leave phase 7 with zero skeleton, or pre-create empty files?
   - Recommendation: **Do NOT pre-create.** Phase 7 owns those fully. Phase 1's `docker-compose.yml` is a standalone working artifact.

3. **Should the phase-1 `/api/health` include a write test of SQLite to catch Pitfall #1 (NFS/SMB volumes)?**
   - What we know: PITFALLS.md #1 recommends a write test in the health check.
   - What's unclear: Simple `ping PB` vs `do a throwaway PB insert`.
   - Recommendation: **Just `ping PB` in phase 1.** A write test requires writable PB auth (we don't have admin yet in phase 1). Phase 2 (auth) can add a deeper check using the `_superusers` test collection or similar. Document this as a known limitation.

4. **How is the PocketBase superuser created in production on first run?**
   - What we know: PB 0.37 auto-prints an installer JWT link to stdout on first boot (verified via smoke test). Admin can click it to set up creds.
   - What's unclear: Does the user see that link? s6 forwards stdout to Docker logs, so yes — `docker logs homekeep | grep pbinstall`.
   - Recommendation: **Document this in README.** "After first `docker compose up -d`, run `docker compose logs homekeep | grep pbinstall` to get the one-time superuser setup link." No env-var bootstrap needed — D-05 is consistent with this.

5. **Branch protection automation — `gh` CLI not installed on the VPS.**
   - Recommendation: **Document as manual step** in phase 1 plan: "After pushing initial commits, configure branch protection in GitHub UI (Settings → Branches → Add rule for `main` → Require PR before merge, Require status checks: ci.yml)." OR add `apt install -y gh && gh auth login` as a setup plan step. Either way, this is a one-time setup, not recurring automation.

## Project Constraints (from CLAUDE.md)

No `CLAUDE.md` found at project root. No explicit directives to enforce.

Project-level skill discovered: `.claude/skills/ui-ux-pro-max` (applies to phase 2 UI work per SPEC.md phase plan, not phase 1). Phase 1 research is not gated by UX skill rules.

## Sources

### Primary (HIGH confidence)

- **PocketBase 0.37.1 binary** (downloaded + smoke-tested locally on 2026-04-20) — confirmed serve flags, health endpoint response body/code, admin UI path `/_/`, installer link behavior on first boot
- **github.com/pocketbase/pocketbase/releases/tag/v0.37.1** — release date, multi-arch binaries, checksums.txt file structure
- **npm view <pkg> version** — exact current versions of next (16.2.4), react (19.2.5), pocketbase (0.26.8), tailwindcss (4.2.2), vitest (4.1.4), @playwright/test (1.59.1), concurrently (9.2.1), zod (4.1.0), date-fns (4.3.6), shadcn (4.3.1), typescript (6.0.3), eslint (10.2.1), eslint-config-next (16.2.4)
- **nextjs.org/docs/app/api-reference/config/next-config-js/output** (Next.js 16.2.4, doc updated 2026-04-15) — `output: 'standalone'` behavior, required manual COPY of public/ and .next/static/
- **github.com/just-containers/s6-overlay** (v3.2.2.0, 2026-01-24) — install pattern, longrun type, dependencies.d, user bundle, S6_* env vars, /init entrypoint
- **github.com/caddyserver/caddy/releases/tag/v2.11.2** (2026-03-06) — current stable Caddy
- **caddyserver.com/docs/caddyfile/directives/reverse_proxy** — `flush_interval -1` for SSE safety, handle/route precedence
- **github.com/docker/build-push-action** — multi-arch workflow pattern, gha cache, metadata-action integration
- **github.com/linuxserver/docker-baseimage-alpine/blob/master/Dockerfile** — reference s6-overlay install pattern

### Secondary (MEDIUM confidence — WebSearch, cross-referenced)

- **PocketBase CHANGELOG analysis** (via WebFetch of pocketbase.io/docs) — v0.23 introduced `_superusers` auth-records model, Router swap echo → net/http, error field `code` → `status` rename
- Community template repos (natrontech/pocketbase-nextjs-template, others found via WebSearch) — corroborate that single-container PB+Next via process manager is an established pattern, though specific s6/Caddy combinations in a single image are less common

### Tertiary (LOW confidence — training data only)

- Tailwind v4 + shadcn/ui 4.3.1 full compatibility — shadcn claims support but hasn't been stress-tested in this research; flagged A7

## Metadata

**Confidence breakdown:**

- **Standard stack:** HIGH — every version verified via live `npm view` + GitHub release API queries on 2026-04-20
- **Architecture patterns:** HIGH — Caddy Caddyfile verified against official docs, s6-overlay pattern verified against upstream README, Next.js standalone verified against Next 16.2.4 docs
- **PocketBase contract:** HIGH — binary smoke-tested locally; health endpoint response body confirmed live
- **Pitfalls:** HIGH — inherited from PITFALLS.md (well-researched) + extended with phase-specific findings (Pitfall #8 Caddy ordering)
- **Multi-arch CI:** HIGH — GitHub Actions pattern matches current `docker/build-push-action@v7` + `metadata-action@v5` recipe verified against docker/build-push-action README
- **Dev workflow (concurrently + dev-pb.js):** MEDIUM — the shape is correct; dev-pb.js as written hasn't been executed and may need iteration. Phase 1 implementation will exercise it

**Research date:** 2026-04-20

**Valid until:** ~2026-05-20 (30 days). PocketBase pre-1.0 moves fast; Next.js 16.x is actively patched. Re-verify exact patch versions just before Phase 1 Wave 0 kickoff.
