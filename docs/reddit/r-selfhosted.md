**Title options (pick one):**

- HomeKeep — self-hosted household maintenance tracker, built for my first house
- I built a self-hosted household-maintenance app while getting my head around owning a home
- HomeKeep — first-time homeowner's "what needs doing this year" app (self-hosted, single container)

---

**Post body:**

We recently bought our first house. I started getting suggestions from everyone — keep a spreadsheet for pest control, gutter cleaning, smoke alarms, air filters, all the stuff houses quietly demand. None of the existing task apps handled long-cycle recurring work well (a task due in 365 days sits in the same list as one due today), so I built one.

Mostly I wanted to test what I could actually ship using Claude Code as a side-project. Figured the timing was right — I had a real problem to solve, and I've taken a lot from this community over the years, so maybe it's useful for someone else in the same spot.

**What it does**

- Separates what's due now from what's coming eventually — three-band view (Overdue / This Week / 12-month Horizon)
- Spreads the year's work evenly across weeks so six annual tasks don't all pile up in March
- Per-area coverage % so you can see at a glance what's maintained and what's neglected
- Shared household — invite partner, cascading assignment (task → area → "anyone")
- Snooze, reschedule, seasonal tasks (winter-only gutters etc.), one-off tasks, manual rebalance
- Push notifications via ntfy (no Firebase, no paid services)
- Installable PWA on HTTPS

**Stack**

- Next.js 16 + PocketBase 0.37 in one container (supervisord via s6-overlay)
- Caddy bundled for TLS, optional Tailscale sidecar
- Multi-arch: amd64 + arm64 (Pi-friendly)
- Single `./data` volume — backup = copy the folder
- No telemetry, no cloud deps, AGPL-3.0

**Install**

```bash
docker run -d -p 3000:3000 \
  -v homekeep_data:/app/data \
  -e SITE_URL=http://localhost:3000 \
  --name homekeep ghcr.io/conroyke56/homekeep:latest
```

Repo: https://github.com/conroyke56/homekeep
Screenshots in the README.

Feedback welcome — happy to hear what's missing or what would make it more useful. Cheers.
