# Paste this into a Claude Code session running as root (or sudo)

Open a Claude Code session with `sudo claude` (or as root directly),
`cd /root`, and paste everything below the `---` line. The prompt is
self-contained — the root Claude doesn't need to read any other file
to execute.

---

You're operating on the Hetzner VPS at 46.62.151.57 as root.
This VPS hosts multiple projects for the operator under dedicated
service users (`sprout`, `homekeep`, `claude-dev`, and future ones).
The operator uses Claude Code heavily and wants VPS-wide continuity.

Your job: execute the 5 tasks below. Each is self-contained and
reversible. Prefer safe, idempotent commands.

## Task 1 — Install `/opt/vps/CLAUDE.md` as the VPS-wide Claude memory

The canonical content is at
`/srv/homekeep/docs/vps-setup/CLAUDE.md.proposed` (readable by root).

```bash
mkdir -p /opt/vps
install -m 644 -o root -g root \
  /srv/homekeep/docs/vps-setup/CLAUDE.md.proposed \
  /opt/vps/CLAUDE.md
ls -la /opt/vps/CLAUDE.md
# Expect: -rw-r--r-- 1 root root ... /opt/vps/CLAUDE.md
```

## Task 2 — Symlink each service user's `~/.claude/CLAUDE.md`

Every Claude Code session run by these users should auto-load the
VPS-wide manual.

```bash
for user in sprout homekeep claude-dev; do
  home=$(getent passwd "$user" | cut -d: -f6)
  [ -n "$home" ] || { echo "user $user not found, skipping"; continue; }
  sudo -u "$user" mkdir -p "$home/.claude"
  ln -sfn /opt/vps/CLAUDE.md "$home/.claude/CLAUDE.md"
  ls -la "$home/.claude/CLAUDE.md"
done
# Expect: each prints a symlink -> /opt/vps/CLAUDE.md
```

## Task 3 — Create `/opt/vps/PORTS.md` as the port allocation ledger

```bash
cat > /opt/vps/PORTS.md <<'EOF'
# VPS port allocation ledger

All projects bind `127.0.0.1:<port>` on the host. The shared Caddy
(`revproxy-caddy-1`, host network, sprout-owned) reverse-proxies from
`<project>.the-kizz.com` to the port below.

Reserved range: `127.0.0.1:3000-3999`.

| Port | Project       | Scope     | Notes |
|------|---------------|-----------|-------|
| 3000 | homekeep      | personal  | /srv/homekeep, user homekeep. Direct-exposed today; will move behind revproxy at homekeep.the-kizz.com eventually. |
| 3001 | homekeep-demo | public    | `docker compose -p homekeep-demo` — tmpfs PB, 2h TTL, 127.0.0.1-bound. Vhost ready at docker/revproxy-vhosts/homekeep.demo.the-kizz.com.caddy. |

## Allocation policy

- Reserve by appending a row BEFORE binding. Avoid 80, 443, 8090 (PB
  upstream default), 3306, 5432, 6379 inside containers — the
  127.0.0.1:<port> host binding is what matters, so any free port in
  3000-3999 works.
- Decommission: strike through the row but keep the history — prevents
  reassigning a port that something still references.
EOF
chmod 644 /opt/vps/PORTS.md
cat /opt/vps/PORTS.md | head -10
```

## Task 4 — Centralize the GoDaddy credentials (optional but recommended)

Currently the key is duplicated at:
- `/home/sprout/.config/godaddy/credentials` (source)
- `/srv/homekeep/.env` (copied into the homekeep user's env during
  v1.2.1 session — will drift on rotation)

Move to a single ACL'd location.

```bash
# 1. Create secrets group if missing
getent group secrets >/dev/null || groupadd --system secrets

# 2. Install central file (idempotent — copy from sprout's source)
mkdir -p /etc/secrets
install -m 640 -o root -g secrets \
  /home/sprout/.config/godaddy/credentials \
  /etc/secrets/godaddy.creds

# 3. Grant read to users that currently need it
for user in sprout homekeep; do
  setfacl -m u:"$user":r /etc/secrets/godaddy.creds
done
getfacl /etc/secrets/godaddy.creds
```

Follow-up for the operator (not root-Claude's job): update
`/srv/homekeep/.env` and `/home/sprout/.config/godaddy/credentials` to
`source /etc/secrets/godaddy.creds` instead of holding inline values,
then rotate the key once to prove the flow. The homekeep user's
`.env` currently has inline values — ask before stripping them.

## Task 5 — Caddy godaddy DNS-01 plugin for wildcard TLS (optional)

The shared revproxy currently uses `caddy:2-alpine` (bare image, no
plugins). To enable wildcard `*.the-kizz.com` certs via DNS-01, the
Caddy image needs the `caddy-dns/godaddy` plugin baked in.

```bash
# 1. Build a custom Caddy image with the plugin
docker run --rm \
  -v /home/sprout/revproxy/custom-build:/build \
  caddy:2-builder \
  caddy build --with github.com/caddy-dns/godaddy

# If that's wrong syntax (the :builder image is stdin-based in practice),
# the alternative is a Dockerfile pattern. Check:
#   https://caddyserver.com/docs/build#xcaddy
#
# The modern approach uses `caddy:2-alpine` as a base and `xcaddy build`
# in a builder stage. Write a 10-line Dockerfile that:
#   FROM caddy:2-builder AS builder
#   RUN xcaddy build --with github.com/caddy-dns/godaddy
#   FROM caddy:2-alpine
#   COPY --from=builder /usr/bin/caddy /usr/bin/caddy
# Tag as caddy:2-alpine-godaddy. Edit /home/sprout/revproxy/docker-compose.yml
# to use the new tag.

# 2. Update /home/sprout/revproxy/Caddyfile global block:
#    {
#      email you@the-kizz.com
#      acme_dns godaddy {env.GODADDY_API_KEY}
#    }
#    (and ensure GODADDY_API_KEY + GODADDY_API_SECRET are in the
#    caddy container's env, sourced from /etc/secrets/godaddy.creds)
#
# 3. For each vhost on *.the-kizz.com that wants wildcard:
#    *.the-kizz.com {
#      # same proxy config
#    }
#
# 4. docker compose -p revproxy up -d --build
```

This task has more moving parts; treat as optional. If you hit any
snag, skip it and leave a note in /opt/vps/PORTS.md's end — HTTP-01
works fine for now.

## Report back

After running tasks 1–4 (task 5 optional), print:

```bash
echo "=== /opt/vps/ contents ==="
ls -la /opt/vps/
echo ""
echo "=== symlinked CLAUDE.md targets ==="
for user in sprout homekeep claude-dev; do
  home=$(getent passwd "$user" | cut -d: -f6)
  [ -L "$home/.claude/CLAUDE.md" ] && readlink "$home/.claude/CLAUDE.md" | xargs -I{} echo "  $user -> {}"
done
echo ""
echo "=== /etc/secrets/ ACLs ==="
ls -la /etc/secrets/ 2>/dev/null && getfacl /etc/secrets/godaddy.creds 2>/dev/null | tail -6
```

That's the verification block. Once it looks clean, you're done.
