# Root infrastructure sync — bidirectional handoff

**Audience:** a Claude Code session running as root (or a user with
full sudo) on the Hetzner VPS `aom-wiki` (46.62.151.57).

**Purpose:** apply VPS-wide infrastructure changes that the
`homekeep` service-user Claude couldn't do from its own home
(`/srv/homekeep`). The changes are additive and idempotent — running
this doc a second time should be a no-op except for the timestamped
report.

**Non-goals:** do NOT touch running services (revproxy-caddy-1, the
personal HomeKeep container on port 3000, the HomeKeep-demo container
if it's been started). Don't restart Docker. Don't modify UFW. Don't
apt-upgrade. Don't rebuild Caddy with DNS-01 plugin (separate, more
invasive task).

**Upstream state (read-only context you should assume is already
correct):**

- HomeKeep v1.2.1 is live at `http://46.62.151.57:3000/` (personal
  instance) with GHCR `:latest` digest
  `sha256:3fef5b40c8a722df4d2502945a6677fe794e5f1cc177a70510998ec51d09107b`.
- All 4 `github.com/the-kizz/*` repos have secret scanning + push
  protection + Dependabot enabled (done via API from the homekeep
  session).
- DNS: wildcard `*.the-kizz.com` + explicit `homekeep.demo` both
  point at `46.62.151.57`.
- GoDaddy API creds are at `/home/sprout/.config/godaddy/credentials`
  (mode 600, sprout-only) AND duplicated at `/srv/homekeep/.env`
  (mode 600, homekeep-only). Task 4 below consolidates them.

---

## Procedure

Work in order. Each task has a **verify** step first — skip to the
next task if the "already done" condition is met.

### Task 1 — Install `/opt/vps/CLAUDE.md` from the canonical source

**Verify:**
```bash
[ -f /opt/vps/CLAUDE.md ] && \
  diff -q /opt/vps/CLAUDE.md /srv/homekeep/docs/vps-setup/CLAUDE.md.proposed
```
If the file exists and `diff` prints nothing, it's already current → skip.
If it exists but differs, the source has been updated → apply below.
If it doesn't exist, apply below.

**Apply:**
```bash
mkdir -p /opt/vps
install -m 644 -o root -g root \
  /srv/homekeep/docs/vps-setup/CLAUDE.md.proposed \
  /opt/vps/CLAUDE.md
```

### Task 2 — Install `/opt/vps/PORTS.md` (port allocation ledger)

**Verify:**
```bash
[ -f /opt/vps/PORTS.md ]
```
If exists → skip (don't overwrite; might have operator-added rows).

**Apply:**
```bash
cat > /opt/vps/PORTS.md <<'EOF'
# VPS port allocation ledger

All projects bind `127.0.0.1:<port>` on the host. The shared Caddy
(`revproxy-caddy-1`, host network, sprout-owned) reverse-proxies
from `<project>.the-kizz.com` to the port below.

Reserved range: `127.0.0.1:3000-3999`.

| Port | Project       | Scope     | Notes |
|------|---------------|-----------|-------|
| 3000 | homekeep      | personal  | /srv/homekeep, user homekeep. Currently host-exposed on 0.0.0.0:3000; eventually moves behind revproxy at homekeep.the-kizz.com. |
| 3001 | homekeep-demo | public    | `docker compose -p homekeep-demo` — tmpfs PB, 2h TTL, 127.0.0.1-bound. Vhost at /srv/homekeep/docker/revproxy-vhosts/homekeep.demo.the-kizz.com.caddy. |

## Allocation policy

- Reserve a port by appending a row BEFORE binding. Avoid 22/80/443
  (host services) and 8090 (PB default inside containers is fine —
  host binding is what matters).
- Decommission: strike through the row but keep the history to
  prevent accidental reassignment.
EOF
chmod 644 /opt/vps/PORTS.md
```

### Task 3 — Symlink each service user's `~/.claude/CLAUDE.md` to the canonical

**Verify (per user):**
```bash
readlink /home/<user>/.claude/CLAUDE.md 2>/dev/null
# If prints "/opt/vps/CLAUDE.md" → already symlinked, skip
```

**Apply (for each of: sprout, homekeep, claude-dev):**
```bash
for user in sprout homekeep claude-dev; do
  home=$(getent passwd "$user" | cut -d: -f6)
  [ -n "$home" ] || { echo "skip: user $user not found"; continue; }
  sudo -u "$user" mkdir -p "$home/.claude" 2>/dev/null || mkdir -p "$home/.claude"
  # If a real file (not symlink) exists, back it up before replacing.
  if [ -f "$home/.claude/CLAUDE.md" ] && [ ! -L "$home/.claude/CLAUDE.md" ]; then
    mv "$home/.claude/CLAUDE.md" "$home/.claude/CLAUDE.md.bak-$(date +%s)"
  fi
  ln -sfn /opt/vps/CLAUDE.md "$home/.claude/CLAUDE.md"
  chown -h "$user":"$user" "$home/.claude/CLAUDE.md" 2>/dev/null || true
done
```

### Task 4 — Centralize GoDaddy creds at `/etc/secrets/`

**Verify:**
```bash
[ -f /etc/secrets/godaddy.creds ] && getfacl /etc/secrets/godaddy.creds
```
If exists and ACL already grants `u:homekeep:r` and `u:sprout:r` →
skip. Otherwise apply.

**Apply:**
```bash
# 1. Create 'secrets' group if missing
getent group secrets >/dev/null || groupadd --system secrets

# 2. Install central file from sprout's canonical source
mkdir -p /etc/secrets
chmod 755 /etc/secrets
install -m 640 -o root -g secrets \
  /home/sprout/.config/godaddy/credentials \
  /etc/secrets/godaddy.creds

# 3. Grant read to consumers
for user in sprout homekeep; do
  setfacl -m u:"$user":r /etc/secrets/godaddy.creds
done

# 4. Print current ACLs for the report
getfacl /etc/secrets/godaddy.creds
```

**Follow-up that root Claude should NOT automate** (needs operator
judgement on when to rotate):

- Update `/srv/homekeep/.env` to replace the inline `GODADDY_API_KEY`
  and `GODADDY_API_SECRET` lines with `. /etc/secrets/godaddy.creds`
  (sourcing the central file). Leave the inline values in place for
  now — next human rotation is the natural moment to cut over.
- Same update for `/home/sprout/.config/godaddy/credentials` if sprout
  wants to collapse to the central file too.

### Task 5 — Nightly backups cron (OPTIONAL, only if operator agrees)

**Verify:**
```bash
ls /etc/cron.daily/backups-projects 2>&1
```
If present → skip.

**Apply only if /var/backups is empty or operator approves:**
```bash
mkdir -p /var/backups
cat > /etc/cron.daily/backups-projects <<'EOF'
#!/bin/sh
# Nightly per-project tar backups. Runs via /etc/cron.daily,
# which systemd's anacron scheduler kicks between 06:00-06:30 UTC.
# Retention: 14 days. Add off-site sync below when restic is set up.

set -eu
STAMP=$(date +%Y%m%d)
for dir in /srv/*; do
  project=$(basename "$dir")
  [ -d "$dir" ] || continue
  tar czf "/var/backups/${project}-${STAMP}.tgz" \
    --exclude='*/node_modules' \
    --exclude='*/.next' \
    --exclude='*/data' \
    "$dir" 2>/dev/null
done
# Retention
find /var/backups -maxdepth 1 -name '*.tgz' -mtime +14 -delete
EOF
chmod 755 /etc/cron.daily/backups-projects
# Dry-run once to confirm it works
sh -n /etc/cron.daily/backups-projects
```

If /var/backups already has content under non-root ownership → skip
this task and leave a note in the report, since the operator may have
a backup strategy already in flight.

---

## Reporting

After completing (or skipping) each task, write a report to
`/opt/vps/reports/root-sync-<timestamp>.md`. The homekeep Claude
reads this to stay in sync.

**Report template:**

```bash
mkdir -p /opt/vps/reports
REPORT="/opt/vps/reports/root-sync-$(date -u +'%Y-%m-%dT%H-%M-%SZ').md"
chmod 755 /opt/vps/reports

{
  echo "# Root infra sync report"
  echo ""
  echo "- timestamp: $(date -u -Iseconds)"
  echo "- executed as: $(id)"
  echo "- source doc version: $(sha256sum /srv/homekeep/docs/vps-setup/root-infra-sync.md | cut -d' ' -f1 | head -c 12)"
  echo ""
  echo "## Task outcomes"
  echo ""
  echo "### Task 1 — /opt/vps/CLAUDE.md"
  echo "\`\`\`"
  ls -la /opt/vps/CLAUDE.md 2>&1
  diff -q /opt/vps/CLAUDE.md /srv/homekeep/docs/vps-setup/CLAUDE.md.proposed 2>&1 && echo "in sync with source"
  echo "\`\`\`"
  echo ""
  echo "### Task 2 — /opt/vps/PORTS.md"
  echo "\`\`\`"
  ls -la /opt/vps/PORTS.md 2>&1
  wc -l /opt/vps/PORTS.md 2>&1
  echo "\`\`\`"
  echo ""
  echo "### Task 3 — per-user CLAUDE.md symlinks"
  echo "\`\`\`"
  for user in sprout homekeep claude-dev; do
    home=$(getent passwd "$user" | cut -d: -f6)
    [ -n "$home" ] || { echo "$user: not found"; continue; }
    if [ -L "$home/.claude/CLAUDE.md" ]; then
      target=$(readlink "$home/.claude/CLAUDE.md")
      echo "$user: -> $target"
    elif [ -f "$home/.claude/CLAUDE.md" ]; then
      echo "$user: plain file (NOT symlinked)"
    else
      echo "$user: missing"
    fi
  done
  echo "\`\`\`"
  echo ""
  echo "### Task 4 — /etc/secrets/godaddy.creds"
  echo "\`\`\`"
  ls -la /etc/secrets/godaddy.creds 2>&1
  getfacl /etc/secrets/godaddy.creds 2>&1 | grep -E '^(user|group|other)' 2>&1
  echo "\`\`\`"
  echo ""
  echo "### Task 5 — nightly backups cron"
  echo "\`\`\`"
  ls -la /etc/cron.daily/backups-projects 2>&1
  ls /var/backups/ 2>&1 | head -5
  echo "\`\`\`"
  echo ""
  echo "## Observations / anomalies"
  echo ""
  echo "(fill in anything unexpected — permission surprises, files"
  echo "you chose not to overwrite, tasks skipped and why)"
  echo ""
  echo "---"
  echo ""
  echo "## Resume prompt for homekeep Claude"
  echo ""
  echo "Paste the block below into the homekeep Claude session so it"
  echo "picks up the infra sync state without re-scanning."
  echo ""
  echo '```'
  echo "Root infra sync completed at $(date -u -Iseconds). Report at $REPORT."
  echo ""
  echo "Apply these state updates:"
  echo "1. /opt/vps/CLAUDE.md and per-user symlinks are LIVE — future Claude sessions on any service user (sprout, homekeep, claude-dev) auto-load the VPS operating manual."
  echo "2. /etc/secrets/godaddy.creds is the canonical GoDaddy location (ACL'd for sprout + homekeep). The inline GODADDY_* lines in /srv/homekeep/.env are now REDUNDANT — clean them up in /srv/homekeep/.env on next human rotation (not now)."
  echo "3. /opt/vps/PORTS.md is the port-allocation ledger — future project onboarding must append to it before binding."
  echo "4. /var/backups/ nightly tarball is (present/not present — check report Task 5)."
  echo ""
  echo "Update memory file vps_setup_root_prompt.md to mark executed; add a new reference memory pointing at $REPORT so the full history survives."
  echo '```'
} > "$REPORT"

chmod 644 "$REPORT"
echo ""
echo "=== Report written to $REPORT ==="
cat "$REPORT"
```

The final `cat` dumps the report so the operator sees the summary
in their terminal. The file stays at `/opt/vps/reports/` (mode 644,
world-readable) so any future Claude session — homekeep or otherwise
— can read it.

---

## One-line trigger (for the operator to paste into their root Claude)

```
Read @/srv/homekeep/docs/vps-setup/root-infra-sync.md and execute the Procedure section end-to-end. Write the report to /opt/vps/reports/ per the template. Do not modify currently-running services. Ask me before running Task 5 (backups cron) if /var/backups/ has pre-existing content. At the end, print the Resume prompt so I can paste it back.
```

That's it. All tasks are idempotent; safe to re-run at any time.
