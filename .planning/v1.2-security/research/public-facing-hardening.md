# Public-Facing Deployment Security

## Executive summary

**Today, HomeKeep is NOT safe to expose on the public internet as shipped.** The baseline compose (`docker/docker-compose.yml`) and Caddy overlay (`docker/docker-compose.caddy.yml`) both reverse-proxy the PocketBase admin UI at `/_/` to the public internet, accept unthrottled open signup at `POST /api/collections/users/records`, ship no security headers (no CSP, no HSTS, no X-Frame-Options), and the live `docker/.env` committed to this VPS contains a weak-entropy `ADMIN_SCHEDULER_TOKEN` and a guessable `PB_ADMIN_PASSWORD` — neither of which the docker-compose flow forces the operator to change.

Before a public demo or public operator deployment can happen, six blockers must land:

1. Block `/_/` at the edge (Caddy) unless explicitly opted-in, and bind PB to loopback only (already done — `docker/s6-rc.d/pocketbase/run:3` uses `--http=127.0.0.1:8090`, good) while also blocking the path at the internal Caddyfile.
2. Add a strong security-headers block to `Caddyfile.prod` (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy).
3. Rotate / regenerate `ADMIN_SCHEDULER_TOKEN` and `PB_ADMIN_PASSWORD` on every deploy, and fail-closed at boot if they are still the defaults.
4. Force the Next origin check for server actions via an explicit `SITE_URL` / `allowedOrigins` config.
5. Gate public signup behind either (a) an invite-only toggle or (b) an aggressive per-IP bucket on `POST /api/collections/users/records`.
6. Remove the `/root/projects/homekeep/.env` GitHub PAT from the production host (it is gitignored but present; if the host is ever compromised the PAT grants `repo, workflow, admin:org, delete_repo, packages` on the HomeKeep repo).

A DEMO instance adds three more requirements: ephemeral per-session homes, a `/reset` cron that wipes data every N hours, and SMTP/ntfy fully disabled so the demo cannot be weaponised as a spam relay.

## Deployment model review

The project ships three compose modes; each exposes a different surface:

| Mode | File | Exposed to internet | Auth / TLS |
|---|---|---|---|
| **LAN (default)** | `docker-compose.yml` | TCP 3000 on host — plain HTTP | None at transport. `auto_https off` in `docker/Caddyfile:2`. Cookies flagged `Secure=false` (`lib/actions/auth.ts:50`). |
| **Caddy overlay** | `docker-compose.caddy.yml` | TCP 80/443 on host, container `:3000` internal-only via `ports: !reset []` (line 20) | Let's Encrypt via ACME HTTP-01. `docker-compose.caddy.yml:38` fails fast if `DOMAIN` unset. |
| **Tailscale overlay** | `docker-compose.tailscale.yml` | Only tailnet IPs. Host publishes nothing. | Tailscale auth; HTTPS via MagicDNS. Private by default. Tailscale Funnel (`TS_SERVE_CONFIG=/config/serve.json`, line 32) can opt-in to public HTTPS but the file is not shipped. |

**Only the Tailscale mode is fit-for-purpose for a "public" deployment today without further hardening** — it leverages Tailscale's identity layer and makes the surface non-public by default.

LAN mode is explicitly unsafe for internet exposure (plain HTTP, no TLS, no HSTS). The VPS currently runs in exactly this mode per `docker/.env:7` (`SITE_URL=http://46.62.151.57:3000`).

Caddy mode is the intended production path but ships without security headers (see audit below) and still reverse-proxies `/_/` to PB admin (via the internal `docker/Caddyfile:17-21`).

## Admin UI exposure

**Finding: PocketBase admin UI at `/_/` is reachable from the public internet in both LAN and Caddy modes.**

Path:
- `docker/Caddyfile:17-21` reverse-proxies `/_/*` to `localhost:8090`. This internal Caddy terminates `:3000`, which is then exposed by `docker-compose.yml:8` directly (LAN) or fronted by the external Caddy in `Caddyfile.prod:10-17` (Caddy overlay). The external Caddy does not strip `/_/` — it is a catch-all `reverse_proxy homekeep:3000`. So in Caddy mode, `https://your-domain/_/` hits the PB admin login.

PB 0.37 does not ship a single env flag to disable the admin UI. Options, ordered by preference:

1. **Edge-block** (recommended). Add `@deny path /_/* /_/` in Caddyfile.prod and `respond 404` before the reverse_proxy. Same in the internal `docker/Caddyfile`.
2. **IP allowlist**. Caddy `@admin_ip remote_ip 1.2.3.4/32` with `reverse_proxy @admin_ip localhost:8090` and catch-all deny.
3. **Basic-auth in front of `/_/*`**. Caddy's `basic_auth` directive with a bcrypt-hashed password adds a second factor in front of PB's own login.

Even with PB's rate-limit on `*:authWithPassword` at 60/60s (`bootstrap_ratelimits.pb.js:45-49`), a public admin endpoint is a fingerprint-and-prep target — a future PB 0.37.x CVE would give attackers a pre-mapped surface. Block it.

**Note: PB is already bound to loopback** (`docker/s6-rc.d/pocketbase/run:3` passes `--http=127.0.0.1:8090`), so there is no way to reach PB except through the reverse-proxy chain — good defence-in-depth, but the reverse-proxy currently forwards `/_/*`.

## Findings (severity-ordered)

### CRITICAL

**C-1. PocketBase admin UI exposed on public domain in Caddy mode.**
Location: `docker/Caddyfile:17-21`, `docker/Caddyfile.prod:10-17`.
Evidence: `/_/*` handler in internal Caddy forwards to `localhost:8090` unconditionally; external Caddy catches everything and forwards to `homekeep:3000` including `/_/`.
Impact: Public admin login surface; future PB CVE becomes directly exploitable; credential-stuffing surface with only `60 req/60s` bucket.
Fix: Add an explicit `@admin path /_/*` matcher in `Caddyfile.prod` with `respond @admin 404` placed BEFORE the `reverse_proxy`. For home-use, add an IP allowlist branch.

**C-2. Default `PB_ADMIN_PASSWORD` and `ADMIN_SCHEDULER_TOKEN` in committed-shape `docker/.env` are weak.**
Location: `docker/.env:6` (`HomekeepAdmin2026!` — dictionary-adjacent), `docker/.env:10` (`homekeep_sched_token_abc123xyz456789deadbeef0123` — low-entropy prefix).
Evidence: Observed on VPS at time of audit.
Impact: `PB_ADMIN_PASSWORD` grants superuser to PocketBase — full DB, full user-impersonation via superuser auth. The 32-char min-length check in `app/api/admin/run-scheduler/route.ts:33` passes but a visibly-patterned token still fails in an entropy audit.
Fix: Add a boot-time check that both values pass an entropy threshold (e.g. ≥ 128 bits shannon entropy) and refuse to start otherwise. Document `openssl rand -base64 48` in `.env.example`.

**C-3. `/root/projects/homekeep/.env` on VPS contains a GitHub PAT with `repo, workflow, admin:org, delete_repo, packages` scopes.**
Location: `/root/projects/homekeep/.env:9`.
Evidence: File mode `600` (good) but resident on a host that runs a public service. Any RCE in the Next.js or PB stack reads that file.
Impact: Host compromise → full repo takeover, GHCR image-replacement (supply-chain attack on every downstream installer), ability to delete the repo.
Fix: Do not keep the PAT on the production/demo host. Use a deploy-only token in a separate account with minimum scopes (packages:read only for pulling published images), stored outside `/root/projects/homekeep/`.

### HIGH

**H-1. No security headers set anywhere.**
Location: `next.config.ts` has no `async headers()`; `docker/Caddyfile.prod` has no `header` directive.
Evidence: Response to `curl -I http://46.62.151.57:3000/` would return no CSP, no HSTS, no X-Frame-Options, no X-Content-Type-Options, no Referrer-Policy, no Permissions-Policy.
Impact: Clickjacking via iframe; MIME-sniffing XSS; no TLS downgrade protection; full referrer leakage to ntfy.sh and any third-party resource.
Fix: Add a `header` block to `Caddyfile.prod` (table below for exact values).

**H-2. Open signup against `POST /api/collections/users/records` with no per-IP bucket beyond the generic `/api/` 300/60s guest ceiling.**
Location: `pocketbase/pb_hooks/bootstrap_ratelimits.pb.js:51-56` sets `/api/` → 300/60s guest bucket. No specific rule for user-creation.
Impact: Bot can mint 300 accounts / minute / IP / 4,320,000 per day from a /20. Each account can then create homes and bloat the DB (no row-count cap exists on homes / areas / tasks collections — see migration rules in `1714780800_init_homekeep.js` which permit creates freely for the owner).
Fix: Add a targeted `users:create` bucket at 3/60s guest. For a demo, disable signup entirely and issue one-shot demo tokens.

**H-3. `SITE_URL=http://46.62.151.57:3000` in `docker/.env:7` means auth cookies are set without `Secure` flag.**
Location: `lib/actions/auth.ts:50` (`secure: process.env.NODE_ENV === 'production'`) — `Secure` is on in prod, but on plain HTTP the browser ignores `Secure` and transmits cleartext anyway. `exportToCookie` in `lib/actions/auth.ts:95-97` uses the same flag.
Impact: Session-hijack via passive observer on any upstream hop. Documented in 02-03 D-03.
Fix: Front with Caddy + real domain OR switch to Tailscale overlay. Never expose plain HTTP public-facing.

**H-4. No Next.js server-action origin check configured.**
Location: `next.config.ts:22-24` — no `experimental.serverActions.allowedOrigins`.
Evidence: Next 16 checks `Origin` against the request host by default; behind a reverse proxy this can succeed for any `Host` header the proxy forwards.
Impact: In theory, cross-origin server-action invocation via DNS-rebinding if the reverse proxy forwards `Host`. In practice Next 16 requires `Origin` to match, but explicit `allowedOrigins` hardening is missing.
Fix: Add `experimental.serverActions.allowedOrigins: [process.env.SITE_URL_HOST]` to `next.config.ts`, derived at boot.

**H-5. Public signup leads to unbounded home / area / task / completion creation.**
Location: Migration rules in `1714780800_init_homekeep.js:21-23` (homes), `:56-59` (areas), `:104-106` (tasks) — all permit unlimited creates as long as `owner_id = @request.auth.id`. No row-count cap.
Impact: One signed-up bot can seed 100k tasks to DoS the DB volume.
Fix: Add a per-owner row-count cap in a pre-create hook (e.g. max 10 homes / 200 areas per home / 2000 tasks per home) or surface this as a setting. For the demo, hard-cap at 3 / 20 / 100.

### MEDIUM

**M-1. `HomeKeep-Build: hk-<sha>` build fingerprint leaked in every response.**
Location: `app/layout.tsx:57-58` emits `<meta name="generator">` and `<meta name="hk-build">`; `app/.well-known/homekeep.json/route.ts:45-51` returns it as JSON.
Impact: Version-fingerprinting lets an attacker target a specific PB / Next.js release's CVE list. Advertised intentionally per Phase 8 D-04 as a provenance signal, but on public internet this is free recon.
Fix: Keep the `<meta>` tags (cheap provenance) but drop the `/.well-known/homekeep.json` route from the demo build, or return only `app` + `license` without `build`.

**M-2. `/api/health` leaks PB upstream status code.**
Location: `app/api/health/route.ts:23-26` returns `{ status, nextjs, pocketbase, pbCode }`.
Impact: A non-2xx from PB is relayed as `pbCode: 503` (or whatever). Attackers can probe for PB-version-specific error patterns. Minor.
Fix: Coerce to `ok | degraded` only; drop `pbCode` on public demo.

**M-3. Invite tokens are single-use but not rate-limited per token on accept.**
Location: `lib/actions/invites.ts:109-225`. PB's `300/60s` generic bucket applies, but an attacker with a scraped token can brute-force per-call flags within that bucket.
Impact: Token is 192-bit — brute-forcing is infeasible anyway. But a leaked invite URL (gist, forum, Slack paste) works until `expires_at` (14 days per `lib/actions/invites.ts:42`). There is no "revoke all pending invites" UI.
Fix: Add a bulk-revoke button in `/h/[homeId]/settings`. Consider shortening default TTL to 3 days for public deployments.

**M-4. ntfy topics are a per-user shared secret, displayed to co-members.**
Location: `pocketbase/pb_migrations/1714953603_users_view_rule_shared_home.js:31-34` — co-members can `view` each other's user records, which includes the `ntfy_topic` field.
Impact: A malicious co-member (e.g. ex-partner who still has home access) can read the other's ntfy topic and spam their phone. The scheduler itself never logs topics (`lib/ntfy.ts:27-33`), good.
Fix: Exclude `ntfy_topic` from the expanded `user_id` projection. Add a `hidden` field flag in the migration — PB supports `System()` / `hidden: true` field options. Alternative: compute-only topic via HMAC(home_id, user_id, server-secret) so it is not stored.

**M-5. Caddy access-log PII.**
Location: `docker/Caddyfile.prod` does not enable access logs explicitly, but Caddy's default is stdout-JSON including full URI. Invite URLs contain the token path `/invite/<32-char-token>`.
Impact: Tokens in logs → log-theft = invite-takeover.
Fix: Configure `log { format filter { wrap single_field path > redact ...` to strip the token path in `Caddyfile.prod`.

**M-6. No Content Security Policy; Next 16's Google Fonts import pulls from `fonts.googleapis.com` and `fonts.gstatic.com`.**
Location: `app/layout.tsx:3` (`next/font/google`).
Impact: CSP that lists these origins is feasible; without CSP, XSS in any Server Component output becomes escalation-ready.
Fix: Set a strict CSP in `Caddyfile.prod` (`default-src 'self'; font-src 'self' fonts.gstatic.com; style-src 'self' 'unsafe-inline' fonts.googleapis.com; img-src 'self' data:; script-src 'self'; connect-src 'self' ntfy.sh`). Validate against Next's inline-style usage.

### LOW

**L-1. Base images are floating tags.**
Location: `docker/Dockerfile:3` (`node:22-alpine`), `:23` (`caddy:2.11.2-alpine` — better, pinned). `node:22-alpine` picks up whatever `22.x.y-alpine` is latest at build time.
Impact: A compromised or buggy upstream node minor version is auto-inherited on the next build.
Fix: Pin `node` by digest (`@sha256:...`) in the `ARG NODE_VERSION`.

**L-2. GitHub Actions pinned to major version, not commit SHA.**
Location: `.github/workflows/release.yml:21` (`actions/checkout@v6`), `:24` (`docker/setup-qemu-action@v4`), etc.
Impact: Action repo-compromise = supply-chain. Documented as deferred per 01-06 roadmap.
Fix: SHA-pin actions in a follow-up phase. Dependabot can auto-update while preserving the SHA contract.

**L-3. PB rate-limit bucket for `*:authWithPassword` is 60/60s per IP.**
Location: `pocketbase/pb_hooks/bootstrap_ratelimits.pb.js:44-49`.
Impact: 60 password attempts / minute / IP. For a 6-char common-password dictionary (~1M entries), that is 277 hours per IP — still deterring but not strong. An attacker with a /24 pool gets 4× faster.
Fix: Drop to 10/60s per IP for public deployments (demo does not need high rate). Document the `DEVIATION` trade-off more clearly.

**L-4. No CSRF-token requirement on PB auth endpoints; Next server actions use Next's built-in origin check only.**
Location: PB's default is to rely on CORS + cookie `SameSite=Lax` for CSRF. Server actions in `lib/actions/*.ts` rely on Next's form-action contract.
Impact: `SameSite=Lax` protects top-level POSTs from cross-site but not same-site-but-different-subdomain. If a demo co-tenant hosts anything on a subdomain, CSRF surface exists.
Fix: Enforce single-domain deployment. Document `SameSite=Strict` override as a demo-hardening flag.

**L-5. Healthcheck uses `localhost` which is fine; but `/api/health` itself has no auth and returns process info.**
Location: `docker/Dockerfile:120` uses it for healthcheck — fine. Public readability of the endpoint is the issue (see M-2).

### INFO

**I-1. `docker/Caddyfile:2` correctly turns off `auto_https` because it runs inside the container at `:3000` (no cert needed internally). Operators who copy this file to a public-facing Caddy without understanding the architecture will MITM themselves.** Add a big comment block warning.

**I-2. AGPL-3.0 licensing surface.** `docker/Dockerfile:115` labels the image AGPL. Any operator who runs a modified version publicly must make source available. Document in operator checklist.

**I-3. Demo-mode telemetry.** `app/.well-known/homekeep.json` is intentionally no-telemetry (per the route's own docstring at `route.ts:19-21`) — this is good. Keep it that way.

**I-4. The scheduler admin token is compared with `!==` (`app/api/admin/run-scheduler/route.ts:41`).** Not timing-safe. In practice the 32-char random string is astronomically unlikely to leak via timing, but a `crypto.timingSafeEqual` call is a one-liner fix for defence-in-depth.

**I-5. PB `_superusers` auth in `lib/pocketbase-admin.ts:47` is memoised for 30 minutes.** Reasonable. The client is never exposed to the browser per the module's JSDoc contract. Good.

## Security headers audit

| Header | Current value | Recommended | Gap |
|---|---|---|---|
| Content-Security-Policy | **none** | `default-src 'self'; font-src 'self' fonts.gstatic.com; style-src 'self' 'unsafe-inline' fonts.googleapis.com; img-src 'self' data:; script-src 'self'; connect-src 'self' https://ntfy.sh; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` | Full. Next fonts + ntfy require listed origins. |
| Strict-Transport-Security | **none** | `max-age=31536000; includeSubDomains; preload` | Full. Only set once cert is stable (Caddy overlay). |
| X-Frame-Options | **none** | `DENY` (or rely on CSP `frame-ancestors 'none'`) | Full. |
| X-Content-Type-Options | **none** | `nosniff` | Full. |
| Referrer-Policy | **none** | `strict-origin-when-cross-origin` | Full. Leaks full URL (incl. invite tokens) otherwise. |
| Permissions-Policy | **none** | `camera=(), microphone=(), geolocation=(), interest-cohort=()` | Full. PWA does not need any of these today. |

Concrete `Caddyfile.prod` block:

```
{$DOMAIN} {
    encode zstd gzip

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        Content-Security-Policy "default-src 'self'; font-src 'self' https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:; script-src 'self'; connect-src 'self' https://ntfy.sh; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "camera=(), microphone=(), geolocation=(), interest-cohort=()"
        -Server
    }

    @admin path /_/*
    respond @admin 404

    reverse_proxy homekeep:3000 {
        flush_interval -1
    }
}
```

## TLS / cert posture

- `docker-compose.caddy.yml:34` mounts named volume `caddy_data:/data` — certificates persist across restarts. Good.
- ACME HTTP-01 via port 80 — fragile if port 80 is blocked by a corporate firewall. No fallback to DNS-01 configured. Document.
- Let's Encrypt rate limits: 50 new certs / domain / week, 5 failed validations / hostname / hour. If someone mis-configures DNS and spam-restarts, they can be rate-limited out of renewal. Add a docs note on "wait 1 hour, then retry".
- HSTS preload readiness: needs `max-age=31536000; includeSubDomains; preload` + submission to `hstspreload.org`. Offer as optional operator step.
- **Tailscale mode uses Tailscale's own LE cert via MagicDNS** — no ACME rate-limit pressure, no preload story needed for tailnet-only deployments.

## Rate-limit map

| Endpoint / path | Rate limit | Source | Bypass-able? |
|---|---|---|---|
| `POST /api/collections/users/auth-with-password` | 60 req / 60s per IP guest | `bootstrap_ratelimits.pb.js:44-49` | Rotate IP (VPN / botnet). No user-level lockout after N failures. |
| `POST /api/collections/users/records` (signup) | 300 req / 60s per IP guest (generic `/api/` bucket) | `bootstrap_ratelimits.pb.js:51-56` | Yes — generic bucket only. No user-create-specific rule. **H-2**. |
| `POST /api/collections/invites/records` (create) | Owner-only, no extra limit beyond generic | `pb_migrations/1714953601_invites.js:29` | Owner can spam invite creation — low impact (their own home). |
| `GET /invite/[token]` (accept UI) | 300 req / 60s generic | — | Attacker with guessed-token can try 300/minute; token space is 2^192, intractable. |
| `POST /api/admin/run-scheduler` | Token-gated, not rate-limited | `app/api/admin/run-scheduler/route.ts` | Token leak = full scheduler hijack, but scheduler is side-effect-light (sends ntfy, writes idempotent rows). |
| Next server actions | Per-session via Next's built-in; no explicit bucket | N/A | Authed users can hammer their own home. |
| `GET /api/health` | Generic `/api/` 300/60s | — | Fine. |
| `GET /.well-known/homekeep.json` | No limit (non-PB path goes to Next default) | — | Small. Leaks build ID (**M-1**). |

## Demo-instance architecture

Recommended architecture for a safe public demo at `demo.homekeep.example`:

**Isolation model: "ephemeral home per visitor"**

1. Landing page `/demo` shows a single button "Try HomeKeep". No signup, no email.
2. Click → server action mints a per-session demo user via admin client: `demo-<uuid>@demo.local` + random 32-byte password. Cookie-issue the session.
3. Server action creates a pre-seeded home with 3 areas + 20 tasks (copy from the seed-library — `lib/seed-library.ts` already exists per the Phase 14 roadmap).
4. User explores their own home only. PB's `listRule` already enforces `@request.auth.id` equality, so one demo user cannot see another's home.
5. After 2 hours idle: a cron (docker `deploy` container or a separate compose service) runs a PB admin script that deletes all `demo-*@demo.local` users older than 2h. Cascade-delete handles their homes/areas/tasks/completions.
6. No SMTP — password reset disabled. No real email. `SMTP_HOST` unset → `bootstrap_smtp.pb.js:12-14` prints the disabled log and moves on.
7. No ntfy — set `DISABLE_SCHEDULER=true` in compose env so `instrumentation.ts:28` short-circuits. Also blank `NTFY_URL` so any stray send fails closed at the invalid-URL guard.
8. Admin UI blocked at Caddy (see C-1 fix). Scheduler admin token unset → `/api/admin/run-scheduler` returns 401 per `route.ts:33-37`.
9. PB `PB_DATA` on a tmpfs mount so full-reset on container restart is a full wipe. Alternative: a nightly `pocketbase reset` job.
10. Build identifier replaced with `hk-demo` (not a real SHA) to reduce version-targeting.

**Compose diff for demo mode** (overlay `docker-compose.demo.yml`):

```yaml
services:
  homekeep:
    environment:
      - DISABLE_SCHEDULER=true
      - NTFY_URL=  # blank — scheduler can't reach ntfy even if re-enabled
      - SMTP_HOST= # blank — password reset off
      - HK_BUILD_ID=hk-demo
      - HOMEKEEP_DEMO_MODE=true  # new env; gates the /demo landing page
    tmpfs:
      - /app/data/pb_data:rw,size=256m  # ephemeral, lost on restart
```

**Per-user rate limits on top of PB's existing buckets** (add to `bootstrap_ratelimits.pb.js`):

- `users:create` guest: 0/60s (demo disables direct signup entirely; only `/demo` landing creates users)
- All authed-user endpoints: 60 req / 60s / user for first hour of session, raising to 600/60s (prevents a demo visitor from running load tests against your VPS).

## Operator hardening checklist

For someone running HomeKeep publicly on their own domain — MUST configure beyond `docker compose up`:

1. **Set `DOMAIN`, `CADDY_EMAIL` in `.env`** and use `docker-compose.caddy.yml` overlay. Do NOT expose LAN compose (`docker-compose.yml` alone) to the internet.
2. **Point an A-record** at the VPS. Open only TCP 80, 443 on the firewall. Close 3000, 8090 explicitly.
3. **Generate high-entropy secrets**:
   - `openssl rand -base64 48` → `PB_ADMIN_PASSWORD`
   - `openssl rand -hex 32` → `ADMIN_SCHEDULER_TOKEN`
   - Do not reuse across environments.
4. **Add the security-headers block** to `Caddyfile.prod` (see audit table above).
5. **Block `/_/*` at the edge** (see C-1 fix). If you need admin UI, restrict to a VPN / Tailscale exit node and set up an IP allowlist.
6. **Verify cookies are `Secure`** — requires HTTPS (Caddy overlay handles this).
7. **Configure SMTP** for password resets, or accept that users cannot recover accounts. If SMTP is unset, document "contact admin" path.
8. **Set per-IP rate limits on signup** (H-2 fix). For single-household deployments, consider disabling signup entirely and handling invites only.
9. **Set up log rotation / redaction** — Caddy access logs contain full URIs including invite tokens. Redact `/invite/*` path segment.
10. **Rotate `PB_ADMIN_PASSWORD` every 90 days** and after any suspected compromise. The admin client cache TTL (`lib/pocketbase-admin.ts:27`, 30 min) means rotation takes effect within the next cache miss.
11. **Back up `/app/data`** externally — PB's SQLite + uploaded files. AGPL compliance: keep source of any local modifications available.
12. **Subscribe to PocketBase security advisories** (github.com/pocketbase/pocketbase/security) and Node 22 LTS patch announcements.
13. **Disable `HK_BUILD_ID` header exposure in public responses** if you do not want version-pinning attacks (M-1).
14. **Monitor `/api/health`** via external uptime check (e.g. Uptime Kuma). Alert on `status: degraded`.
15. **Do not run `docker compose up` as root on a multi-user VPS**. The s6 init runs processes as `node` (UID 1000) internally (`docker/Dockerfile:101`), but the host-side docker daemon still has root.

## Next steps

A pentester should probe a live demo for:

1. **`/_/` accessibility** — curl both `https://demo.example.com/_/` and direct `https://demo.example.com:8090/_/` (should be closed). Confirm 404.
2. **Signup flood** — 500 concurrent `POST /api/collections/users/records` from a single IP; confirm rate-limit trips at the configured bucket and returns 429.
3. **Row-count exhaustion** — authenticated user tries to create 10,000 homes. Verify per-owner cap kicks in (H-5).
4. **Invite token brute-force** — 10,000 random tokens against `/invite/<token>`. Confirm 404 on all (token space is 2^192; any hit would indicate a clock/RNG bug).
5. **Admin scheduler token guessing** — fuzz `x-admin-token` header against `/api/admin/run-scheduler`. Timing-attack measurement; confirm no variance across wrong tokens (I-4 fix).
6. **ntfy topic exfiltration** — as demo user A, view demo user B's profile via PB `/api/collections/users/<id>`. Confirm `ntfy_topic` is not returned for co-members (M-4 fix).
7. **Session fixation** — login on one browser, copy cookie, paste into another, verify PB-side token still scoped and rejects on IP change (it will not — document as expected behaviour).
8. **Clickjacking** — embed `demo.example.com` in an iframe from a third-party origin. Confirm `frame-ancestors 'none'` blocks.
9. **CSP report mode** first — deploy CSP with `Content-Security-Policy-Report-Only` for one week, collect violations, then switch to enforcement.
10. **HSTS preload submission** — only after 30 days of zero-downtime HTTPS, submit to `hstspreload.org`.
11. **Dependency audit** — `npm audit --audit-level=high` in CI (not currently gated in `.github/workflows/ci.yml`). Add as a step.
12. **Container-image scan** — Trivy or Grype against `ghcr.io/conroyke56/homekeep:latest`. Alpine + Node 22 base currently has no known CVEs, but add to release workflow.
