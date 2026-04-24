# Public-facing deployment hardening

HomeKeep's defaults are tuned for LAN or tailnet deployments. Exposing an
instance to the public internet requires extra operator steps — the items
below are mandatory, in order, before your first public DNS cut-over.

If you can't tick every box, run HomeKeep behind Tailscale instead. See
[`docs/deployment.md`](deployment.md) for the tailnet overlay. The tailnet
path has far fewer sharp edges than public exposure.

> **Scope:** this checklist covers a single-household or small-family
> public instance. For the public **demo** instance (ephemeral per-visitor
> data, 2h/24h reset), see the "Deploying a public demo" section of
> [`docs/deployment.md`](deployment.md) — the demo overlay layers on top
> of the items below but adds its own gates.

---

## 1. Set `DOMAIN` and use the Caddy overlay

**Description.** Run the `docker-compose.caddy.yml` overlay so Caddy
terminates TLS on ports 80/443 and the Next.js + PocketBase stack is never
directly reachable.

**Why it matters.** The baseline LAN compose serves plain HTTP on port 3000
with `auto_https off`. Running that file alone on a public IP means auth
cookies travel in cleartext, browsers refuse PWA install, and there is no
HSTS protection.

**How.**

```bash
# .env (at repo root or docker/.env)
DOMAIN=homekeep.example.com
CADDY_EMAIL=you@example.com   # optional; defaults to admin@${DOMAIN}

docker compose \
  -f docker/docker-compose.yml \
  -f docker/docker-compose.caddy.yml \
  up -d
```

**Verify.**

```bash
curl -sSI https://homekeep.example.com/ | head -n 1
# Expect: HTTP/2 200 (or HTTP/1.1 200 behind an HTTP/3-less client)

curl -sS https://homekeep.example.com/api/health
# Expect: {"status":"ok","nextjs":"ok","pocketbase":"ok"}
```

---

## 2. Generate a high-entropy `PB_ADMIN_PASSWORD`

**Description.** The PocketBase superuser password must be strong and
unique per deployment. The default bundled in the repo's `.env.example`
placeholder is a trigger for a fail-fast boot assertion, not a secret.

**Why it matters.** `PB_ADMIN_PASSWORD` grants the full-privilege admin
client that the Next.js app uses for invite acceptance and scheduler cron.
Anyone who recovers it from logs, backups, or a leaked `.env` gets
database-level impersonation over every user.

**How.**

```bash
# Generate:
openssl rand -base64 32

# Paste into docker/.env:
PB_ADMIN_PASSWORD=<paste-here>

# Then update the live PB superuser record to match:
docker exec homekeep pocketbase superuser update \
  "$PB_ADMIN_EMAIL" "$PB_ADMIN_PASSWORD" --dir /app/data/pb_data
```

**Verify.**

```bash
# The admin client boot probe logs a cache hit on first use:
docker logs homekeep 2>&1 | grep -i 'pocketbase-admin'

# And your invite-acceptance flow should succeed without a 500.
```

---

## 3. Generate a high-entropy `ADMIN_SCHEDULER_TOKEN`

**Description.** The admin scheduler route requires a 32+ character random
token. Generate it with a cryptographic RNG, not a keyboard-mashed string.

**Why it matters.** `POST /api/admin/run-scheduler` fires the overdue-task
notification cron. A stolen token lets an attacker trigger the cron loop
arbitrarily, spam ntfy topics, and (through the cron's side effects) probe
the task-state graph for timing leaks. The token comparison is
timing-safe (Phase 23 SEC-03), but the best defence is a token that never
leaks in the first place.

**How.**

```bash
openssl rand -hex 32     # 64-char hex (= 256 bits of entropy)

# Paste into docker/.env:
ADMIN_SCHEDULER_TOKEN=<paste-here>
```

**Verify.**

```bash
# Missing / wrong token → 401:
curl -sX POST https://homekeep.example.com/api/admin/run-scheduler -w '%{http_code}\n'
# Expect: 401

# Correct token → 200 with a result body:
curl -sX POST https://homekeep.example.com/api/admin/run-scheduler \
  -H "x-admin-token: $ADMIN_SCHEDULER_TOKEN" -w '%{http_code}\n'
# Expect: 200
```

---

## 4. Lock `docker/.env` permissions to 600

**Description.** The `docker/.env` file holds `PB_ADMIN_PASSWORD`,
`ADMIN_SCHEDULER_TOKEN`, SMTP credentials, and (in some installs) a
GitHub PAT for image-pull. Set file mode to `600` and owner to the
deploying user only.

**Why it matters.** A world-readable `.env` is the single fastest path
from shell-level compromise to full environment takeover. `600` means
only the file owner can read or write, and no other user on the host can
even `cat` it.

**How.**

```bash
chown <deploy-user>:<deploy-user> docker/.env
chmod 600 docker/.env

# Confirm:
ls -la docker/.env
# Expect: -rw------- 1 <user> <user> ... docker/.env
```

**Verify.**

```bash
stat -c '%a' docker/.env
# Expect: 600
```

---

## 5. Confirm `/_/` returns 404 at the edge

**Description.** The PocketBase admin UI at `/_/` is blocked at the Caddy
layer by default (Phase 22 HOTFIX-01). Verify the block is live on your
deployment.

**Why it matters.** PB's admin UI is a full-privilege login page. Public
exposure fingerprints the PB version, creates a credential-stuffing target,
and becomes directly exploitable the day a PB CVE ships. The block covers
`/_/*`, `/api/_superusers`, `/api/_superusers/*`, and
`/api/collections/_superusers/*`.

**How.** This is already the default. Do **not** set
`ALLOW_PUBLIC_ADMIN_UI=true` in production. That env flag exists only for
one-off admin access from a trusted IP and must be set back to `false`
(or removed) before rejoining public traffic.

**Verify.**

```bash
curl -sI https://homekeep.example.com/_/                           | head -n 1
curl -sI https://homekeep.example.com/api/_superusers              | head -n 1
curl -sI https://homekeep.example.com/api/collections/_superusers/ | head -n 1
# Expect all three: HTTP/2 404
```

---

## 6. Confirm security headers are served

**Description.** HomeKeep ships 5 baseline security headers at every
response layer: `X-Frame-Options`, `X-Content-Type-Options`,
`Referrer-Policy`, `Permissions-Policy`, and `Content-Security-Policy-Report-Only`.
HTTPS deployments also serve `Strict-Transport-Security`.

**Why it matters.** These headers block clickjacking, MIME-sniff XSS,
referrer leakage (invite tokens!), powerful-feature access, and TLS
downgrade attacks. CSP is currently Report-Only during a 30-day soak
window; monitoring `/api/csp-report` (item 13 below) lets you flip to
enforced in a future minor version without breaking any real page.

**How.** The headers are wired at three layers — Next.js (`next.config.ts`),
internal Caddy (`docker/Caddyfile`), and external Caddy
(`docker/Caddyfile.prod`). No operator config needed; just don't strip
them at an upstream proxy.

**Verify.**

```bash
curl -sI https://homekeep.example.com/ | grep -iE \
  '(strict-transport-security|content-security-policy-report-only|x-frame-options|x-content-type-options|referrer-policy|permissions-policy)'

# Expect all six headers present (HSTS only on HTTPS).
```

---

## 7. Configure the host firewall — only 80/443 open

**Description.** Close every port on the VPS firewall except 80 (ACME HTTP-01
challenges) and 443 (HTTPS, including UDP 443 for HTTP/3). Explicitly close
3000 (direct Next.js) and 8090 (PocketBase).

**Why it matters.** Defense-in-depth. Even though Caddy is the only
service bound to a host port in the overlay, a misconfigured compose
restart, a forgotten `ports:` directive, or a rogue colocated service
can expose internal ports. The firewall is the last line.

**How (Ubuntu / Debian with `ufw`).**

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp          # SSH (restrict further via AllowUsers if possible)
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp         # HTTP/3
ufw enable
```

**Verify.**

```bash
sudo ufw status verbose
# Expect: 22, 80, 443/tcp, 443/udp ALLOW — nothing else on 3000 / 8090.

# External probe:
nmap -Pn -p 3000,8090 homekeep.example.com
# Expect: both filtered / closed.
```

---

## 8. Keep `ALLOW_PUBLIC_ADMIN_UI=false` (or unset) in production

**Description.** Never set `ALLOW_PUBLIC_ADMIN_UI=true` on a public host.
The flag exists as an explicit escape hatch for one-off admin ops from a
trusted IP (you should instead use `docker exec` or a Tailscale jumpbox).

**Why it matters.** `true` disables the `/_/` block at the edge Caddy.
Even with a strong `PB_ADMIN_PASSWORD`, exposing the admin login surface
gives attackers a target for credential stuffing, timing probes, and
future-CVE pre-mapping.

**How.**

```bash
# In docker/.env, ensure the line is absent OR explicitly false:
grep -i ALLOW_PUBLIC_ADMIN_UI docker/.env
# Expect: no match, or ALLOW_PUBLIC_ADMIN_UI=false
```

**Verify.** Same as item 5 — `curl -sI https://your-domain/_/` must return
`404`. If it returns `200` (the PB admin HTML), the flag is on. Turn it off.

---

## 9. Rotate the GitHub PAT to a fine-grained scope

**Description.** If you deploy from CI or use a GitHub PAT to `git pull`
on the VPS, the token must be a fine-grained PAT scoped to this repository
only — not a classic PAT with `admin:org`, `delete_repo`, or `packages`
across your account.

**Why it matters.** A host compromise reads `.env` (item 4) regardless of
permissions. If that file contains an over-scoped classic PAT, the
blast radius is the entire GitHub account: the attacker can rewrite the
repo, replace the GHCR image (supply-chain attack on every downstream
installer), or delete the project entirely.

**How.**

1. https://github.com/settings/tokens?type=beta → Generate new token
2. **Repository access:** only `conroyke56/homekeep` (or your fork)
3. **Repository permissions:** contents rw, packages rw, issues rw,
   pull requests rw, actions read. Nothing else.
4. Copy the new token, replace `GITHUB_PAT` in your deploy `.env`, then
   revoke the old classic token at https://github.com/settings/tokens.

**Verify.**

```bash
# From the VPS, using the new token:
GITHUB_PAT=<new> git fetch origin master
# Expect: fetches without auth error.

# The classic PAT should no longer work:
GITHUB_PAT=<old-revoked> git fetch origin master 2>&1 | head -n 3
# Expect: 401 / revoked error.
```

---

## 10. Set `HK_BUILD_STEALTH=true` to redact build-id headers

**Description.** Set the `HK_BUILD_STEALTH` env var to `true` to redact
the `HomeKeep-Build` response header, the `<meta name="hk-build">` tag,
and the `build` field in `/.well-known/homekeep.json`. All three emit
the literal string `hk-hidden` when stealth is on.

**Why it matters.** The build-id fingerprint is a provenance signal for
LAN / tailnet deployments but a free recon gift for public-facing ones.
Attackers can cross-reference the build ID against the HomeKeep release
history, pin your exact Next.js and PocketBase versions, and then check
those versions against public CVE databases.

**How.**

```yaml
# docker-compose.caddy.yml (or your compose override):
services:
  homekeep:
    environment:
      HK_BUILD_STEALTH: "true"
```

No image rebuild is required — the env is read on every request via
`getBuildIdPublic()` in `lib/constants.ts`.

**Verify.**

```bash
curl -sI https://homekeep.example.com/ | grep -i 'HomeKeep-Build'
# Expect: HomeKeep-Build: hk-hidden

curl -sS https://homekeep.example.com/.well-known/homekeep.json | jq -r '.build'
# Expect: hk-hidden
```

---

## 11. Review and customise row quotas

**Description.** Per-owner row-creation quotas prevent one malicious or
runaway user from DoS-ing the database. Defaults ship as: 5 homes per
owner, 500 tasks per home, 10 areas per home.

**Why it matters.** Without quotas, a signed-up bot could seed 100,000
tasks and exhaust the SQLite volume. Even legitimate users occasionally
create runaway loops via API integrations — quotas keep the blast radius
bounded.

**How.** Override via env vars in `docker/.env` (or your compose override):

```bash
MAX_HOMES_PER_OWNER=5    # default 5
MAX_TASKS_PER_HOME=500   # default 500 (archived tasks do not count)
MAX_AREAS_PER_HOME=10    # default 10 (Whole Home exempt)
```

For a single-household deployment the defaults are appropriate. For a
small-family hub with multiple properties, consider raising
`MAX_HOMES_PER_OWNER` to 10.

**Verify.**

```bash
# Read the env surface inside the container:
docker exec homekeep env | grep -E '^MAX_(HOMES|TASKS|AREAS)'
# Expect: all three set, or the defaults from lib/quotas.ts.
```

An integration test at `tests/unit/actions/quotas.test.ts` exercises the
ceilings end-to-end; adjust and re-run if you change the defaults.

---

## 12. Plan 90-day rotation for `PB_ADMIN_PASSWORD` and `ADMIN_SCHEDULER_TOKEN`

**Description.** Both secrets should be rotated at least quarterly, and
immediately on any suspected compromise. Calendar the rotation now so it
doesn't become "that thing we meant to do".

**Why it matters.** Long-lived secrets accumulate exposure surface: log
lines, memory dumps, forgotten backup files, rotated-out operators with
residual access. A 90-day cadence caps the value of any single leaked
secret to ~45 days of average attacker utility.

**How.**

```bash
# 1. Rotate:
PB_ADMIN_PASSWORD=$(openssl rand -base64 32)
ADMIN_SCHEDULER_TOKEN=$(openssl rand -hex 32)

# 2. Update docker/.env (keep 600 perms from item 4).

# 3. Update the live PB superuser:
docker exec homekeep pocketbase superuser update \
  "$PB_ADMIN_EMAIL" "$PB_ADMIN_PASSWORD" --dir /app/data/pb_data

# 4. Restart:
docker compose \
  -f docker/docker-compose.yml \
  -f docker/docker-compose.caddy.yml \
  up -d
```

The admin client cache TTL inside the app is 30 minutes
(`lib/pocketbase-admin.ts`), so rotation propagates within that window
without a restart — but restarting avoids any stale in-process state.

**Verify.**

```bash
# Health endpoint returns ok with the new creds:
curl -sS https://homekeep.example.com/api/health
# Expect: {"status":"ok","nextjs":"ok","pocketbase":"ok"}

# Calendar the next rotation:
date -d '+90 days' +%Y-%m-%d
```

---

## 12b. Set `PASSWORD_POLICY=strong` for public exposure

**Description.** HomeKeep's default password policy is `simple` — an 8-char
minimum on signup and reset — tuned for single-household LAN/Tailscale
deployments where credential stuffing isn't in the threat model. Public
internet exposure should tighten to `strong` (12-char minimum on signup
and reset).

**Why it matters.** An 8-char floor is survivable against a cached-bcrypt
offline attack but is shallow coverage against modern GPU-accelerated
online stuffing lists. The 12-char bar matches Phase 23 SEC-06 and brings
every NEW credential well above the commonly-leaked-credential median.
Existing accounts keep logging in with their current password regardless
of policy (the login schema always accepts 8+ chars).

**How.**

```bash
# docker/.env — set BOTH so client-side validation and server-action
# validation see the same policy:
PASSWORD_POLICY=strong
NEXT_PUBLIC_PASSWORD_POLICY=strong

docker compose \
  -f docker/docker-compose.yml \
  -f docker/docker-compose.caddy.yml \
  up -d --force-recreate
```

**Verify.**

```bash
# Signup form should reject < 12 char passwords with the "at least 12
# characters" message. A quick check via curl against the Server Action
# endpoint is simplest with a form submission; inspect the DevTools
# response body on the /signup page for { fieldErrors: { password: ... } }.
```

---

## 13. Monitor the `/api/csp-report` endpoint

**Description.** The CSP is currently deployed in Report-Only mode. The
`/api/csp-report` route (Phase 24 HDR-03) accepts violation POSTs and
logs them to stdout with the prefix `[CSP-REPORT]`, capped at 4096 chars,
never 500-ing.

**Why it matters.** Before flipping CSP to enforced in a future release,
we need a soak corpus of real violations from real browsers on real
pages. Operators running public deployments provide the most diverse
corpus. Spotting a violation now lets us add the missing allowlist entry
before it breaks anyone.

**How.** Pipe container logs to your log aggregator and alert on
`[CSP-REPORT]` lines that contain unexpected `violated-directive` or
`blocked-uri` values.

```bash
docker logs homekeep 2>&1 | grep '\[CSP-REPORT\]' | tail -n 20
```

Or stream to an external collector:

```bash
docker logs -f homekeep 2>&1 | grep --line-buffered '\[CSP-REPORT\]' \
  | curl -sX POST https://your-log-sink.example/logs --data-binary @-
```

**Verify.**

```bash
# Manually trip a report:
curl -sX POST https://homekeep.example.com/api/csp-report \
  -H 'Content-Type: application/csp-report' \
  -d '{"csp-report":{"violated-directive":"test","blocked-uri":"https://example.invalid/"}}' \
  -w '%{http_code}\n'
# Expect: 204

# And then:
docker logs homekeep 2>&1 | grep '\[CSP-REPORT\]' | tail -n 1
# Expect: a line echoing the payload.
```

---

## 14. Subscribe to the release feed for security updates

**Description.** Watch the HomeKeep GitHub repo for security-relevant
releases and subscribe to the upstream dependencies you care about.

**Why it matters.** Security patches only help if you know they exist.
HomeKeep follows semver: any security patch within a minor line ships as
a patch bump (`1.2.1`, `1.2.2`, …) and an updated `:1` / `:1.2` tag.
Watching releases catches those in your notification feed.

**How.**

- **HomeKeep:** https://github.com/conroyke56/homekeep → Watch → Custom → Releases
- **PocketBase:** https://github.com/pocketbase/pocketbase/releases
  (security advisories at
  https://github.com/pocketbase/pocketbase/security)
- **Node 22 LTS:** https://nodejs.org/en/about/previous-releases
- **Next.js:** https://github.com/vercel/next.js/security
- **Caddy:** https://github.com/caddyserver/caddy/security

**Verify.** On release, pull the new image and redeploy:

```bash
docker compose -f docker/docker-compose.yml -f docker/docker-compose.caddy.yml pull
docker compose -f docker/docker-compose.yml -f docker/docker-compose.caddy.yml up -d
```

---

## 15. Verify image signatures via `cosign verify`

**Description.** Every tagged HomeKeep release image is signed via cosign
keyless OIDC (Phase 27 SUPPLY-01). Before pulling a new tag onto a public
host, verify the signature is bound to the expected GitHub workflow.

**Why it matters.** A cosign-verified pull proves the image was built by
the upstream GitHub Actions workflow, not tampered with in transit or
replaced in a compromised registry. Combined with SBOM + SLSA-3
provenance (SUPPLY-02), this gives you cryptographic assurance of
where the bits came from.

**How.**

```bash
# Install cosign if not already present:
# https://docs.sigstore.dev/cosign/system_config/installation/

TAG=v1.2.0   # or whatever you're about to deploy

cosign verify \
  --certificate-identity-regexp '^https://github\.com/conroyke56/homekeep/\.github/workflows/release\.yml@' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/conroyke56/homekeep:${TAG}
```

Replace `conroyke56/homekeep` with your fork if relevant. The
`--certificate-identity-regexp` pin ensures the signature is bound to the
`release.yml` workflow on a tag-triggered run, not a rogue branch build.

**Verify.** Cosign prints `Verification for ghcr.io/…/homekeep:v1.2.0 --`
followed by a block of matched claims. If verification fails, **do not
deploy**. Open an issue or email security@homekeep.example.

To inspect the SBOM + provenance after a successful verify:

```bash
docker buildx imagetools inspect ghcr.io/conroyke56/homekeep:${TAG} \
  --format '{{ json .SBOM }}'       | jq '.amd64.SPDX.name' 2>/dev/null
docker buildx imagetools inspect ghcr.io/conroyke56/homekeep:${TAG} \
  --format '{{ json .Provenance }}' | jq '.amd64.SLSA.predicate.builder.id' 2>/dev/null
```

---

## Summary

| # | Item | One-line check |
|---|------|----------------|
| 1 | DOMAIN + Caddy overlay | `curl https://$DOMAIN/api/health` returns 200 |
| 2 | `PB_ADMIN_PASSWORD` via `openssl rand -base64 32` | invite flow works |
| 3 | `ADMIN_SCHEDULER_TOKEN` via `openssl rand -hex 32` | scheduler returns 401 without token, 200 with |
| 4 | `docker/.env` perms `600` | `stat -c '%a' docker/.env` == `600` |
| 5 | `/_/` returns 404 | `curl -sI https://$DOMAIN/_/` HTTP 404 |
| 6 | Security headers present | `curl -I` shows CSP-Report-Only + HSTS + 4 more |
| 7 | Firewall: only 80/443 | `nmap` shows 3000/8090 closed |
| 8 | `ALLOW_PUBLIC_ADMIN_UI` unset / false | item 5 still holds |
| 9 | Fine-grained PAT | no classic PAT in `.env` |
| 10 | `HK_BUILD_STEALTH=true` | `HomeKeep-Build: hk-hidden` |
| 11 | Row quotas reviewed | `env` shows MAX_* values |
| 12 | 90-day rotation planned | next rotation date on calendar |
| 12b | `PASSWORD_POLICY=strong` | signup rejects 11-char passwords |
| 13 | CSP reports monitored | `docker logs` shows `[CSP-REPORT]` pipeline |
| 14 | Release feed subscribed | GitHub Watch → Releases |
| 15 | `cosign verify` on pull | cosign prints matched claims |

Work the list top-to-bottom on first deploy. Revisit quarterly (item 12 is
your reminder anchor) to confirm nothing has drifted.

---

*Cross-reference: overall deployment modes and compose file reference live
in [`docs/deployment.md`](deployment.md). The reporting process and threat
model summary live in [`SECURITY.md`](../SECURITY.md).*
