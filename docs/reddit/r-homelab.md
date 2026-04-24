**Title options (pick one):**

- Built a household-maintenance tracker for my homelab — one container, Pi-friendly
- HomeKeep — self-hosted household maintenance app, runs on a Pi, one container
- Shipped my first self-hosted side project: household maintenance tracker

---

**Post body:**

Just bought our first house. Between the gutter cleaning, pest control, smoke alarms, HVAC service — the reasonable advice was "keep a spreadsheet". I wanted something that actually lived on the homelab instead.

Was also a good excuse to test what I could build with Claude Code. Figured I'd share in case anyone else wants a home-maintenance thing running on their stack.

**What it is**

Self-hosted app. Tracks recurring home maintenance tasks with frequencies (daily → annual), spreads the load across the year so you don't get six annual jobs all landing the same week, and shows you a three-band view: overdue / this week / 12-month horizon.

Shared household (invite your partner), cascading assignment, seasonal tasks, one-off tasks, snooze/reschedule from any view, manual rebalance. Push via ntfy. Installs as a PWA.

**Infra**

- Single container: Next.js 16 + PocketBase 0.37 + Caddy, all supervised by s6-overlay
- `ghcr.io/the-kizz/homekeep` — multi-arch (amd64 + arm64)
- Tiered tags: `:latest`, `:1.1`, `:1`, `:v1.1.1` — pick your update channel (Plex/Grafana convention)
- Single `./data` volume for everything (SQLite via PB + uploads). Backup = copy the folder.
- Compose variants: LAN-only, Caddy (public domain, auto-TLS via Let's Encrypt), Tailscale sidecar
- No telemetry, no cloud deps, AGPL-3.0
- Runs fine on a Pi 4 single-home deployment

**Quickstart**

LAN-only:

```yaml
services:
  homekeep:
    image: ghcr.io/the-kizz/homekeep:latest
    ports: ["3000:3000"]
    volumes: ["homekeep_data:/app/data"]
    environment:
      SITE_URL: http://localhost:3000
      NTFY_URL: https://ntfy.sh
volumes:
  homekeep_data:
```

`docker compose up -d`. Data survives restarts and upgrades.

Full deployment docs (Caddy + Tailscale overlays, env vars, fork checklist) in the README.

Repo: https://github.com/the-kizz/homekeep

Open to feedback on the infra side — compose ergonomics, healthcheck behavior, anything that would make it easier to run alongside other self-hosted stuff.
