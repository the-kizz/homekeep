---
phase: 30
phase_name: Caddy Next.js API Routing
status: shipped
mode: retroactive
commit: 731acc5
covered_reqs: [PATCH2-03]
---

# Phase 30 Summary — Caddy Next.js API Routing *(retroactive)*

## Trigger

v1.2 live-smoke run exposed console 404s on `/api/csp-report`. Direct test confirmed the split:

```
$ curl -sI -X POST http://127.0.0.1:3001/api/csp-report   # Next directly
HTTP/1.1 204 No Content

$ curl -sI -X POST http://127.0.0.1:3000/api/csp-report   # via Caddy
HTTP/1.1 404 Not Found
```

## Root cause

`docker/Caddyfile` had a single `/api/*` matcher routing to PocketBase:

```
handle /api/* {
  reverse_proxy localhost:8090 { flush_interval -1 }
}
```

This was correct for PB's own endpoints (`/api/collections/*`, `/api/files/*`, etc.) but starved Next.js of the API routes it owns:
- `/api/health` (Phase 1 INFR-05 — liveness/readiness)
- `/api/csp-report` (Phase 24 HDR-03 — CSP violation sink)
- `/api/admin/*` (Phase 6 scheduler + future admin-auth actions)
- `/api/demo/*` (Phase 26 DEMO-02 demo session seeder)

All of those 404'd under port 3000 because Caddy handed them to PB first and PB didn't recognize them.

## Fix

Explicit allow-list ordered before the PB catch-all:

```
handle /api/health      { reverse_proxy localhost:3001 }
handle /api/csp-report  { reverse_proxy localhost:3001 }
handle /api/admin/*     { reverse_proxy localhost:3001 }
handle /api/demo/*      { reverse_proxy localhost:3001 }

# Everything else under /api/* → PocketBase
handle /api/* {
  reverse_proxy localhost:8090 { flush_interval -1 }
}
```

Caddy evaluates `handle` blocks top-to-bottom first-match-wins, so Next-owned paths are routed first; anything unknown falls through to PB where it always did.

## Bundled: live-smoke spec

Same commit adds `tests/e2e/v1.2-live-smoke.spec.ts` — the full-journey spec that found both v1.2.1 bugs. The spec is runnable against any deployed instance via `E2E_BASE_URL=http://...`.

## Files changed

- `docker/Caddyfile` — Next.js API allow-list
- `tests/e2e/v1.2-live-smoke.spec.ts` — new

## Verification

- Post-deploy: `curl -sI -X POST http://127.0.0.1:3000/api/csp-report | head -1` → `204 No Content` ✓
- Post-deploy: `curl -s http://127.0.0.1:3000/api/health` → `{"status":"ok",...}` ✓
- Post-deploy: `curl -sI http://127.0.0.1:3000/_/` → `404` (admin still blocked) ✓
- Live-smoke re-run on clean `:edge` image: 0 page errors, 0 5XX, 12 console 404s (down from 13 — `/api/csp-report` fix accounts for 1) ✓

## Commit

```
731acc5  fix(caddy): route Next.js API paths
```

## REQ-IDs

- **PATCH2-03** ✓ — Caddyfile explicit allow-list before PB catch-all
