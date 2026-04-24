# HomeKeep deployment guide

HomeKeep ships one container with three supported deployment modes. Pick one and stick with it — they all use the same image (`ghcr.io/OWNER/homekeep:latest`) and the same `./data` volume, so you can switch later by changing compose files without touching data.

| Mode | HTTPS | PWA install | Setup time | Best for |
|---|---|---|---|---|
| LAN only (default) | No | No | 2 min | Single-home, inside-house usage |
| Caddy (public domain) | Yes, auto | Yes | 15 min | Public-facing self-host with a domain |
| Tailscale (tailnet) | Yes, auto | Yes | 10 min | Private access from anywhere without a public IP |

> The file `docker/docker-compose.yml` is the baseline shared by every mode. The Caddy and Tailscale modes layer an overlay file on top via Compose's `-f` merge. The baseline file is never modified by the overlays.

## LAN only (default)

Start:

```bash
cp .env.example .env
docker compose -f docker/docker-compose.yml up -d
```

HomeKeep is then reachable at `http://HOST_IP:3000` on your local network (change `HOST_PORT` in `.env` to map a different host port, e.g. `HOST_PORT=80`).

### Verify

```bash
curl -s http://localhost:3000/api/health
# { "status": "ok", "nextjs": "ok", "pocketbase": "ok", "pbCode": 200 }
```

### Limitations

- **No HTTPS** — the in-container Caddy serves plain HTTP on port 3000. Browsers will correctly refuse to install HomeKeep as a PWA or register a service worker.
- **No offline support** — the service worker only registers on HTTPS or `http://localhost` contexts.
- The HTTP-only banner shipped in Phase 7 Plan 1 (`components/insecure-context-banner.tsx`) explains this to users automatically and links back to this guide.

### One-line refresh (per Phase 2.1 pattern)

```bash
git pull && docker compose -f docker/docker-compose.yml pull && docker compose -f docker/docker-compose.yml up -d
```

## Caddy (public domain)

This mode terminates TLS at an external Caddy sidecar in front of the homekeep container. Caddy manages the cert lifecycle automatically via Let's Encrypt.

### Prereqs (`user_setup`)

1. **A domain you control**, e.g. `homekeep.example.com`.
2. **DNS A record** pointing the domain at your VPS public IP.
3. **Ports 80 + 443 open** on the VPS firewall (ACME HTTP-01 uses 80; HTTPS is on 443; UDP 443 is used by HTTP/3).
4. **A `.env` file** with `DOMAIN=homekeep.example.com`. Optionally set `CADDY_EMAIL=you@example.com` for Let's Encrypt renewal notices (defaults to `admin@${DOMAIN}` if omitted).

### Start

```bash
cp .env.example .env
# edit .env and set DOMAIN=your-domain.example.com (and optionally CADDY_EMAIL)

docker compose \
  -f docker/docker-compose.yml \
  -f docker/docker-compose.caddy.yml \
  up -d
```

The first request to `https://DOMAIN/` triggers an ACME HTTP-01 challenge; Caddy obtains a cert within about 15 seconds and thereafter serves HTTPS with automatic renewal. The cert and ACME account key persist in the `caddy_data` named volume.

> **Do NOT delete the `caddy_data` volume.** Let's Encrypt rate-limits certificate issuance to 5 per week per domain. Losing the volume will force Caddy to re-request a cert on next boot and can lock you out for a week if you cycle deployments too fast. If you suspect rate-limit trouble, use the staging directory temporarily — see Troubleshooting below.

### Verify

```bash
curl -sS https://$DOMAIN/api/health
# { "status": "ok", "nextjs": "ok", "pocketbase": "ok", "pbCode": 200 }
```

On success you can now install HomeKeep as a PWA — see `docs/pwa-install.md`.

### One-line refresh

```bash
git pull && \
  docker compose -f docker/docker-compose.yml -f docker/docker-compose.caddy.yml pull && \
  docker compose -f docker/docker-compose.yml -f docker/docker-compose.caddy.yml up -d
```

### How this overlay works

- `docker/Caddyfile.prod` is a separate Caddy config from `docker/Caddyfile` (which stays inside the homekeep container for `/api` vs `/_/` routing). The prod file uses Caddy's automatic HTTPS — it does NOT set `auto_https off`.
- The overlay hides the homekeep service's host port via Compose's `!reset []` directive (requires Compose v2.24+). Only Caddy binds host ports 80 + 443 + 443/udp. The two containers communicate on the internal compose network at `homekeep:3000`.
- `DOMAIN` is interpolated into Caddyfile.prod via Caddy's env-substitution (`{$DOMAIN}`). If unset, the overlay fails fast with a clear error rather than silently serving a self-signed localhost cert.

## Tailscale (private tailnet)

This mode joins the homekeep container to your tailnet via a sidecar running the official Tailscale image. No public IP or open ports are needed — only tailscale peers can reach the service.

### Prereqs

1. **A Tailscale account** (free for personal use up to 100 devices; sign up at https://tailscale.com ).
2. **A reusable auth-key** from https://login.tailscale.com/admin/settings/keys — tick **Reusable** when generating (Ephemeral is optional, it auto-removes the node when the container exits).
3. **MagicDNS + HTTPS enabled** on the tailnet at https://login.tailscale.com/admin/dns — this is what gives the container a `https://homekeep.<tailnet>.ts.net` URL.

### Start

```bash
cp .env.example .env
# edit .env and set TS_AUTHKEY=tskey-auth-...

docker compose \
  -f docker/docker-compose.yml \
  -f docker/docker-compose.tailscale.yml \
  up -d
```

Once the sidecar authenticates (about 5 seconds), HomeKeep is reachable at `https://homekeep.<tailnet>.ts.net` on any tailscale-connected device. The TLS cert is provisioned by Tailscale directly; no further action is needed.

### Verify

```bash
# from any tailnet peer:
curl -sS https://homekeep.<your-tailnet>.ts.net/api/health
```

### Funnel (optional: expose to public internet)

You can expose the tailnet HomeKeep publicly over HTTPS by dropping a Tailscale `serve.json` configuration into the tailscale_state volume and setting `TS_SERVE_CONFIG=/config/serve.json`. This is an advanced option; see https://tailscale.com/kb/1223/funnel for configuration details.

### How this overlay works

- `docker/docker-compose.tailscale.yml` shares the sidecar's network namespace with the homekeep service via `network_mode: "service:tailscale"`. The tailscale IP fronts the Next.js server directly; no host port is published.
- Kernel networking is enabled (`TS_USERSPACE=false` + `cap_add: [net_admin, sys_module]` + `/dev/net/tun` mount). If your host lacks `/dev/net/tun` — e.g. certain locked-down container hosts — set `TS_USERSPACE=true` and drop the cap_add/volume entries. Kernel mode is faster.
- `TS_AUTHKEY` uses Compose's `:?` fail-fast directive, matching the `DOMAIN` pattern in the Caddy overlay.

### One-line refresh

```bash
git pull && \
  docker compose -f docker/docker-compose.yml -f docker/docker-compose.tailscale.yml pull && \
  docker compose -f docker/docker-compose.yml -f docker/docker-compose.tailscale.yml up -d
```

## Deploying a public demo (Phase 26)

A separate overlay, `docker/docker-compose.demo.yml`, stands up a public-facing ephemeral-data demo of HomeKeep. Every visitor gets their own throwaway user + home + 15 seed tasks on first load; data lives in tmpfs and is wiped after 2 hours of idle time OR 24 hours absolute, whichever comes first.

This is **NOT** the mode to run your personal household on. For personal use, run the LAN or Tailscale overlays above.

### What the overlay does

- Swaps the baseline `./data:/app/data` bind-mount for a **tmpfs** volume (256 MB cap). PB state never touches disk.
- Sets `DEMO_MODE=true`, which activates:
  - `lib/demo-session.ts` — per-visitor ephemeral home seeding at `/api/demo/session`.
  - `components/demo-banner.tsx` — the amber warning banner in the app layout.
  - `pocketbase/pb_hooks/demo_cleanup.pb.js` — 15-minute cron that sweeps idle / absolute-TTL-expired demo users.
- Sets `DISABLE_SCHEDULER=true` + `HK_BUILD_STEALTH=true` + `NTFY_URL=""` so the demo emits no outbound notifications and redacts build-id metadata.
- Pins the image via `GHCR_OWNER` + `TAG` env vars (`the-kizz/latest` by default; `edge` during active dev).

### Prereqs (`user_setup`)

1. **DNS A record** for `homekeep.demo.the-kizz.com` → VPS IP (`46.62.151.57`). GoDaddy manual step for now; DNS-01 + godaddy plugin automation is deferred to v1.3.
2. **Ports 80 + 443** open on the VPS firewall (ACME HTTP-01 on 80, HTTPS on 443, HTTP/3 on UDP 443).
3. **`docker/.env.demo`** populated locally (the checked-in template is the starting point — you MUST rotate `PB_ADMIN_PASSWORD` via `openssl rand -hex 24` before `compose up` or the admin client fails fast).
4. **Caddyfile swap**: by default the `docker-compose.caddy.yml` overlay mounts `Caddyfile.prod`. For the demo host, swap to `Caddyfile.demo` via an ad-hoc compose override (see below) or run a single demo instance where `DOMAIN=homekeep.demo.the-kizz.com` is set in `.env.demo` — Caddyfile.prod's `{$DOMAIN}` substitution works just as well for the demo host (the hostnames in the block are env-driven).

### Start

```bash
# On the VPS, from the repo root:
cp docker/.env.demo docker/.env.demo.local  # keep the template intact
# edit docker/.env.demo.local and set PB_ADMIN_PASSWORD=$(openssl rand -hex 24)

docker compose \
  -f docker/docker-compose.yml \
  -f docker/docker-compose.caddy.yml \
  -f docker/docker-compose.demo.yml \
  --env-file docker/.env.demo.local \
  up -d
```

The first request to `https://homekeep.demo.the-kizz.com/api/demo/session` triggers:

1. ACME HTTP-01 challenge on port 80 (Caddy auto-fetches a Let's Encrypt cert — ~15s on first run, persisted in the `caddy_data` volume).
2. `lib/demo-session.ts` spawns a throwaway user + "Demo House" + Kitchen + Outdoor + Whole Home areas + 15 seed tasks.
3. 303 redirect to `/h/<homeId>` with the user already authenticated.

### Verify

```bash
# from anywhere — TLS should auto-negotiate within 15s of first hit:
curl -sS https://homekeep.demo.the-kizz.com/api/health

# first-visit flow returns a 303 to /h/<id>:
curl -sSI https://homekeep.demo.the-kizz.com/api/demo/session
```

### Expected resource usage

- tmpfs peak: ~50 MB for ~20 concurrent demo sessions (well under the 256 MB cap).
- Cleanup cron runs every 15 min; the log line `[demo-cleanup] swept N demo users (M homes)` indicates it's working.
- Admin UI (`/_/*`, `/api/_superusers/*`) is blocked at the edge with 404 (no escape hatch on the demo Caddyfile — Phase 22 HOTFIX-01 stays locked).

### Tear down / reset the demo

```bash
docker compose \
  -f docker/docker-compose.yml \
  -f docker/docker-compose.caddy.yml \
  -f docker/docker-compose.demo.yml \
  down

# Everything in tmpfs is already gone. The caddy_data volume (Let's
# Encrypt cert + ACME key) stays — DO NOT delete it or you'll hit the
# 5/wk LE rate limit on re-issuance.
```

### Don't run demo + personal on the same VPS

The VPS `46.62.151.57` is a **public-demo host only** (per STATE.md v1.2-security Architecture Decision). The personal instance lives on the home-lab server behind Tailscale. Running both on the same VPS would share the `caddy_data` volume between hosts and accidentally expose the personal instance's admin UI if the Caddy config drifted.

## Public deployment hardening

Running HomeKeep on a public domain is NOT a one-command experience. The
Caddy overlay above gives you TLS and the basic reverse-proxy wiring, but
every production instance also needs strong secrets, a tight firewall,
rate-limit posture, and a rotation plan.

See [`docs/deployment-hardening.md`](deployment-hardening.md) for the
full 15-item operator checklist. Work through it top-to-bottom before
your first public cut-over, and revisit it quarterly alongside the
90-day secret rotation.

For vulnerability reporting and the project's threat model, see
[`SECURITY.md`](../SECURITY.md).

## Release + tagging (INFR-09)

HomeKeep ships multi-arch container images to GitHub Container Registry (GHCR) via `.github/workflows/release.yml`. The workflow is triggered by a git tag matching `v*` and publishes:

- `ghcr.io/OWNER/homekeep:v1.0.0-rc1` (exact semver)
- `ghcr.io/OWNER/homekeep:1.0` (major.minor)
- `ghcr.io/OWNER/homekeep:latest` (only when the tag is on the default branch)

Both `linux/amd64` and `linux/arm64` architectures are built in the same manifest list.

### Cut a release

```bash
git tag v1.0.0-rc1
git push origin v1.0.0-rc1
# Watch: https://github.com/OWNER/homekeep/actions/workflows/release.yml
```

### Verify multi-arch published

After the workflow completes, verify both architectures landed in the manifest:

```bash
sh scripts/check-multiarch.sh ghcr.io/OWNER/homekeep:v1.0.0-rc1
# should output linux/amd64 and linux/arm64 present
```

The same `scripts/check-multiarch.sh` is what the release workflow itself runs as its last step — operator-side verification is just a re-run.

### One-time GitHub setup (from Phase 1 operator notes)

1. **Workflow permissions.** `Settings / Actions / General / Workflow permissions` → **Read and write**. Required so the release job can push to GHCR using the default `GITHUB_TOKEN`.
2. **Branch protection on `main`.** Require the `lint-test-build` status check from `.github/workflows/ci.yml` to pass before merging. Prevents merging a broken main that would then get tagged.
3. **GHCR package visibility.** After the first `v*` tag push lands an image, flip the package to Public so `docker pull` works without credentials: GitHub profile or org / Packages / homekeep / Package settings / Change visibility.

### INFR-09 proof (2026-04-21 re-validation)

Phase 7 Plan 2 re-validated the Phase 1 pipeline without modifying it. Smoke-check commands:

```bash
# release.yml still parses as YAML
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"

# trigger is still v* tag push
grep -E "tags:\s*\[\s*'v\*'\s*\]" .github/workflows/release.yml

# actions are still pinned to major versions; no floating refs
grep -E "@v[0-9]" .github/workflows/release.yml
grep -E "@(master|latest)" .github/workflows/release.yml && echo FAIL || echo OK

# helper scripts still executable
test -x scripts/check-multiarch.sh
test -x scripts/check-image-size.sh
```

All six checks passed on 2026-04-21; no drift since Phase 1 Plan 6 shipped the workflow. See `07-02-SUMMARY.md` for the exact `docker compose config` hashes captured for the two overlay variants.

## Troubleshooting

- **Caddy returns `429 Too Many Requests` from Let's Encrypt.** The `caddy_data` volume was deleted or cycled too fast and the rate limit (5 certs/week/domain) kicked in. Either wait a week, or temporarily switch Caddy to the staging CA by adding `acme_ca https://acme-staging-v02.api.letsencrypt.org/directory` to the global block in `docker/Caddyfile.prod`. The staging cert is untrusted but unblocks iteration.
- **Tailscale sidecar exits immediately.** Almost always a rejected `TS_AUTHKEY`. Re-generate a fresh reusable key at https://login.tailscale.com/admin/settings/keys and update `.env`. If the key is valid but the sidecar still fails, check host-side `/dev/net/tun` permissions or fall back to `TS_USERSPACE=true`.
- **PWA install prompt never appears.** You are on HTTP. The `InsecureContextBanner` component (Phase 7 Plan 1) will explain this to the user. Switch to the Caddy or Tailscale overlay.
- **Compose `!reset []` unrecognised.** Your Docker Compose is older than v2.24. Update Compose, or replace `ports: !reset []` with `ports: []` in the overlay (older Compose merges list-merge the same way).
- **`docker compose config --quiet` fails with `DOMAIN is unset`.** The overlay intentionally fails fast. Either `export DOMAIN=...` in the shell before running `config`, or put `DOMAIN=...` in `.env` before running `up -d`.
