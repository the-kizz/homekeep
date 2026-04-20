---
phase: 01-scaffold-infrastructure
plan: 04
subsystem: infra
tags: [caddy, reverse-proxy, caddyfile, sse, flush-interval, health-check, pocketbase-admin, ingress]

requires:
  - phase: 01-01
    provides: "project skeleton (wave-dependency marker; no direct file dependency in this plan)"
  - phase: 01-02
    provides: "docker/Dockerfile that COPYs docker/Caddyfile -> /etc/caddy/Caddyfile, EXPOSE 3000, HEALTHCHECK curling 127.0.0.1:3000/api/health (depends on this Caddyfile to land)"
  - phase: 01-03
    provides: "docker/s6-rc.d/caddy/run exec'ing `caddy run --config /etc/caddy/Caddyfile --adapter caddyfile` (this Caddyfile is the --config arg)"
provides:
  - Single-listener (:3000) Caddy 2.11.2 reverse-proxy configuration with four source-ordered handle blocks
  - `/api/health` -> Next.js localhost:3001 BEFORE `/api/*` -> PocketBase localhost:8090 (Pitfall #8 mitigation)
  - `flush_interval -1` on both PB-bound routes (`/api/*` and `/_/*`) -- SSE realtime + admin UI streams not buffered (Pitfall #10 mitigation)
  - `/_/*` -> PocketBase admin UI (D-05: accessible in production, protected by PB's own admin auth)
  - Catch-all `handle {}` -> Next.js localhost:3001 for pages and `/_next/static/` assets
  - Global options block: `auto_https off` (HTTP-only on internal port; Phase 7 owns TLS) + `admin off` (Caddy :2019 admin API disabled; attack-surface reduction)
  - Zero external hostnames; only localhost loopback upstreams (INFR-10)
  - Tab-indented per Caddyfile convention, matching RESEARCH.md §Critical Design Choice verbatim
affects: [01-05, 01-06, 01-07, phase-2-pb-schema, phase-7-compose-variants]

tech-stack:
  added:
    - caddyfile@caddy-2.11.2 (adapter syntax; binary itself provisioned by 01-02)
  patterns:
    - "Source-ordered matchers: specific path (`handle /api/health`) BEFORE wildcard (`handle /api/*`) -- Caddy matches top-to-bottom, so ordering resolves the combined-health-vs-PB-health collision"
    - "SSE-safe reverse proxy: `flush_interval -1` disables Caddy's default output buffer; each `data: ...\\n\\n` frame is flushed immediately to the browser (mandatory for PB realtime)"
    - "Global options block as attack-surface control: `admin off` disables :2019 (unused), `auto_https off` prevents TLS-cert contention with the internal port (TLS lives at Phase 7's external proxy tier)"
    - "Single-port ingress + loopback upstreams: Caddy is the only process bound to a Docker-exposed port; Next.js and PB bind 127.0.0.1 only (enforced by 01-03's run scripts)"

key-files:
  created:
    - docker/Caddyfile
  modified: []

key-decisions:
  - "Followed plan's <action> block verbatim for the :3000 site block (matches RESEARCH.md §Critical Design Choice byte-for-byte); added only the global options (auto_https off + admin off) the plan explicitly specified"
  - "Used tab indentation (Caddyfile convention + RESEARCH.md snippet convention); cat -A confirmed all indents are ^I, no space-indent contamination"
  - "Did NOT add `encode gzip`, `header` directives, `tls` block, or additional listeners (:80/:443) -- the plan's <action> explicitly forbids each; compression is Next.js's responsibility; CSP/HSTS live at Phase 7's external proxy; no TLS until Phase 7"

patterns-established:
  - "Caddyfile source-order matcher pattern: specific routes first, wildcards second, catch-all `handle {}` last -- any future internal routes (e.g. a dedicated /api/realtime handler, /metrics, /debug) must follow the same ordering convention or they will be shadowed"
  - "flush_interval -1 as the standard PB-upstream block decoration -- any new PB-bound Caddy route (e.g. /api/collections in phase 2, /api/files in phase 3) must include it or SSE/stream endpoints will appear broken"

requirements-completed:
  - INFR-01
  - INFR-05

duration: 1min
completed: 2026-04-20
---

# Phase 01 Plan 01-04: Internal Caddy Reverse-Proxy Configuration Summary

**Caddy 2.11.2 internal reverse-proxy Caddyfile on :3000 with four source-ordered handle blocks (`/api/health` -> Next.js, `/api/*` -> PB+SSE, `/_/*` -> PB admin+SSE, catch-all -> Next.js) and a hardened global options block (auto_https off, admin off).**

## Performance

- **Duration:** ~1 min (50 s wall-clock)
- **Started:** 2026-04-20T21:46:47Z
- **Completed:** 2026-04-20T21:47:37Z
- **Tasks:** 1
- **Files created:** 1
- **Files modified:** 0

## Accomplishments

- `docker/Caddyfile` (26 lines, exceeds min_lines=20) containing exactly the snippet prescribed by RESEARCH.md §Critical Design Choice: /api/health ownership, wrapped in a global options block the plan specified separately.
- **Matcher ordering per Pitfall #8:** `handle /api/health` appears at line 7, `handle /api/*` at line 11, `handle /_/*` at line 17, catch-all `handle {}` at line 23 -- strictly monotonically increasing source position, so Caddy's top-to-bottom matcher evaluation routes `/api/health` to Next.js (our combined-health handler) and every other `/api/*` path to PocketBase.
- **SSE-safe flush behaviour per Pitfall #10:** `flush_interval -1` appears exactly twice -- once inside the `/api/*` block (PB realtime) and once inside the `/_/*` block (PB admin UI, which also streams). Absent from `/api/health` and the catch-all (short responses don't need it; keeps config minimal as plan requires).
- **Loopback-only upstreams (INFR-10):** every `reverse_proxy` target is `localhost:<port>` -- `localhost:3001` for Next.js (twice: /api/health + catch-all) and `localhost:8090` for PocketBase (twice: /api/* + /_/*). No external hostnames whatsoever; matches the internal-port contract set by 01-02 (Next.js HOSTNAME=127.0.0.1 PORT=3001) and 01-03 (PB binds 127.0.0.1:8090).
- **Attack-surface minimisation via global options:**
  - `auto_https off` stops Caddy from trying to provision a TLS cert on the internal port (would otherwise log-spam and block startup). TLS is Phase 7's concern at the external proxy tier.
  - `admin off` disables Caddy's :2019 admin API entirely. The container doesn't need it, so turning it off reduces attack surface per T-01-04-02.
- **No forbidden directives:** zero `encode`, zero `header`, zero `tls`, zero listeners other than `:3000`. `! grep -qE 'https?://[a-z0-9.-]+\.[a-z]+'` passes (no external hostnames), `! grep -q ':443'` passes (no TLS listener), `! grep -qE 'tls\s'` passes (no tls directive).
- **Tab indentation verified:** `cat -A docker/Caddyfile` shows every indent level is `^I` (tab), matching Caddyfile convention and the RESEARCH.md snippet byte-for-byte. No space-indent contamination.

## Task Commits

Each task was committed atomically on `master`:

1. **Task 1: Write docker/Caddyfile with path-ordered reverse_proxy rules and SSE-safe flush_interval** -- `d899543` (feat)

_No TDD in this plan; single task is a static-config deliverable validated by 15 acceptance-criteria greps + 4 `<verify>` block checks + 4 `<verification>` static-block checks (22 green, 0 red)._

## Files Created/Modified

- `docker/Caddyfile` -- 26 lines:
  - Lines 1-4: global options block (`auto_https off`, `admin off`)
  - Line 6: site block opener `:3000 {`
  - Lines 7-9: `handle /api/health { reverse_proxy localhost:3001 }`
  - Lines 11-15: `handle /api/* { reverse_proxy localhost:8090 { flush_interval -1 } }`
  - Lines 17-21: `handle /_/* { reverse_proxy localhost:8090 { flush_interval -1 } }`
  - Lines 23-25: catch-all `handle { reverse_proxy localhost:3001 }`
  - Line 26: closing `}`

## Decisions Made

- **Followed plan verbatim.** The `<action>` block prescribed every byte (global options, the `:3000` site block content verbatim from RESEARCH.md §Critical Design Choice, tab indentation, exact flush_interval count, exact handle ordering). Plan's 15 acceptance criteria, 1 `<verify>` conjunction, and 4-line `<verification>` static block are all internally consistent -- no contradictions to reconcile, no gaps to interpret.
- **Tab indentation.** Caddyfile convention (and the RESEARCH.md snippet) uses tabs. Verified via `cat -A docker/Caddyfile`: every indent is `^I`, every line ends `$`, no CRLF contamination.
- **No `caddy validate` run.** The `caddy` binary is not installed on this host (`which caddy` -> empty; `caddy version` -> command-not-found). Per the plan's execution-context note and the orchestrator prompt, image-level validation is deferred to 01-06 CI -- acceptance via grep is sufficient at this wave position, and all 22 static checks pass green.

## Deviations from Plan

None -- plan executed exactly as written.

The plan's `<action>` block specified every file byte inside the `:3000` site block (copied verbatim from RESEARCH.md) plus the two-line global options header. The `<verify>` block was an 8-condition conjunction. The `<acceptance_criteria>` block listed 15 independent greps + two awk-based ordering checks + three negative-assertion greps. All three gates plus the `<verification>` static block passed on the first attempt without any auto-fix.

**Total deviations:** 0 (no Rule 1/2/3/4 invocations).
**Impact on plan:** None.

## Issues Encountered

None. The plan's inter-reference consistency (must_haves.artifacts <-> must_haves.key_links <-> action block <-> acceptance_criteria <-> verification static block) was exact, and the deliverable is a single static 26-line text file with no network, no daemon, no state.

## Known Gaps (deferred to later plans)

- **No runtime boot validation in this plan.** `caddy validate --config docker/Caddyfile --adapter caddyfile` was not executed because the `caddy` binary is not installed on this host. Static-grep + awk ordering checks are the strongest gate available at wave-1 position -- all 22 plan-authoritative checks pass. Runtime validation is the 01-06 CI concern: `docker buildx build` will bake this file into the image at `/etc/caddy/Caddyfile`, and 01-03's caddy `run` script will exec `caddy run --config /etc/caddy/Caddyfile --adapter caddyfile` inside the container. If Caddy rejects the syntax at container start, 01-06's HEALTHCHECK will fail fast (30 s start-period then 502/timeout) -- that's the first end-to-end validation moment.
- **No smoke-test of the routing itself.** The plan `<verification>` explicitly defers live `curl` tests to 01-06: `curl http://localhost:3000/api/health | grep -q '"nextjs":"ok"'` (Pitfall #8 regression gate), `curl http://localhost:3000/_/` (D-05 admin reachable), and `curl -N --max-time 2 http://localhost:3000/api/realtime` (SSE passthrough smoke). Those require the full multi-service container (01-03's services tree + 01-02's Dockerfile + this Caddyfile) plus the app-level `/api/health` route from 01-01. Flagging for 01-06 so it can wire them into the CI workflow.
- **No `/api/realtime`-specific block.** PB's realtime SSE endpoint (`/api/realtime`) is covered by the general `handle /api/* { ... flush_interval -1 }` block -- the wildcard matches, flush behaviour is correct. If profiling in Phase 4+ reveals any realtime-specific tuning needed (e.g. read_timeout bump for long-lived connections), a dedicated `handle /api/realtime` block can be added ABOVE `handle /api/*` (same ordering discipline as `/api/health`). Not a phase-1 blocker -- noting the extension point.

## User Setup Required

None -- no external service configuration, no credentials, no environment variables. `docker/Caddyfile` is inert on disk until 01-02's Dockerfile COPYs it into the image at build time (`COPY docker/Caddyfile /etc/caddy/Caddyfile`) and 01-03's caddy run script execs caddy against it at container start.

## Threat Surface Scan

All six threat-register entries in the plan's `<threat_model>` are addressed:

| ID | Disposition | Addressed in this plan |
|----|-------------|------------------------|
| T-01-04-01 | mitigate | Yes -- upstreams are hardcoded `localhost:3001` and `localhost:8090`; no path templating, no user input in upstream resolution (SSRF surface zero) |
| T-01-04-02 | mitigate | Yes -- `admin off` in global options block disables Caddy's :2019 admin endpoint |
| T-01-04-03 | accept (phase 1) | Per D-05, PB admin at /_/ is intentionally accessible in production; PB has its own rate-limited admin auth; revisit in Phase 7 if LAN exposure changes |
| T-01-04-04 | mitigate | Yes -- `/api/health` is routed to Next.js (not PB), and Next's combined-health handler does its own loopback fetch to PB; PB cannot self-report healthy if it's dead because Next's fetch will fail (Pitfall #4 + #8 jointly mitigated) |
| T-01-04-05 | mitigate | Yes -- `flush_interval -1` appears on both `/api/*` and `/_/*`; exactly 2 occurrences per grep count |
| T-01-04-06 | mitigate | Yes -- `auto_https off` in global options disables Caddy's automatic TLS provisioning attempt |

**No new threat surface introduced beyond the plan's register.** Zero new network endpoints (the sole listener is :3000, already in 01-02's `EXPOSE`). Zero new auth paths (`/_/*` reachability is D-05's accepted choice, not a new surface). Zero new filesystem surface. No schema changes.

## Next Phase Readiness

Wave 1 of Phase 1 is now complete with 01-02 + 01-03 + 01-04 all landed. 01-05 (dev scripts) and 01-06 (CI + Docker Compose) can proceed:

- **01-02 <-> 01-04 contract honoured:** Dockerfile expects `docker/Caddyfile` at build time for `COPY docker/Caddyfile /etc/caddy/Caddyfile`. File exists, 26 lines, syntactically Caddyfile-adapter-compatible (grep-valid -- runtime-valid pending 01-06).
- **01-03 <-> 01-04 contract honoured:** `docker/s6-rc.d/caddy/run` execs `caddy run --config /etc/caddy/Caddyfile --adapter caddyfile`. The `--adapter caddyfile` flag matches what this file uses (directive syntax, not JSON).
- **Port contract honoured:** this Caddyfile listens on `:3000` (matches 01-02 `EXPOSE 3000` + HEALTHCHECK curl target). Upstreams `localhost:3001` for Next.js (matches 01-02 `HOSTNAME=127.0.0.1 PORT=3001` ENV) and `localhost:8090` for PocketBase (matches 01-03 `pocketbase serve --http=127.0.0.1:8090`).
- **01-06 CI readiness:** with 01-02 + 01-03 + 01-04 all present, 01-06 can run `docker buildx build --platform linux/amd64 -t homekeep:test -f docker/Dockerfile . --load` end-to-end. Expected sequence: build succeeds, container starts, s6 spawns all three services in parallel, Caddy begins listening on :3000, HEALTHCHECK's start-period=30s absorbs PB+Next startup race, `curl -fsS http://localhost:3000/api/health` returns 200 with combined JSON body.
- **INFR-01 delivered:** single exposed port with internal reverse proxy routing the three ingress paths per D-02.
- **INFR-05 delivered:** `/api/health` routes to Next.js combined health handler (not to PB's own health), so the handler in 01-01 (app/api/health/route.ts) is what answers Docker's HEALTHCHECK curl -- resolving the Pitfall #8 ownership collision.

## Self-Check: PASSED

Verified claims on disk (2026-04-20T21:47:37Z):

- `test -f docker/Caddyfile` -- exists (26 lines).
- `grep -c 'flush_interval -1' docker/Caddyfile` = 2 (expected 2).
- `grep -c 'localhost:3001' docker/Caddyfile` = 2 (api/health + catch-all).
- `grep -c 'localhost:8090' docker/Caddyfile` = 2 (api/* + _/*).
- `awk '/handle \/api\/health/{a=NR} /handle \/api\/\*/{b=NR} /handle \/_\/\*/{c=NR} /handle[[:space:]]*\{/{d=NR} END{print (a<b && b<c && c<d) ? "OK" : "FAIL"}' docker/Caddyfile` -> `OK`.
- `cat -A docker/Caddyfile` shows tab (`^I`) indentation throughout; no CRLF (every line ends `$`).
- All 15 Task 1 acceptance criteria pass (including negative assertions: no external hostnames, no :443 listener, no tls directive).
- Task 1 `<verify>` conjunction passes.
- Plan `<verification>` static block passes (handle ordering OK; flush_interval=2; localhost:3001=2; localhost:8090=2).
- Must_haves artifact constraint: min_lines=20 satisfied (26 >= 20); contains "handle /api/health" satisfied.
- Must_haves key_links patterns all match: `handle /api/health`, `handle /api/\*`, `handle /_/\*`, `reverse_proxy localhost:3001`.
- Commit `d899543` (Task 1) present in `git log --oneline` on master.

---
*Phase: 01-scaffold-infrastructure*
*Completed: 2026-04-20*
