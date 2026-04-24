# VPS-wide setup for the-kizz.com multi-project host

This directory is **not specific to HomeKeep** — it lives here because
HomeKeep is the first tenant on this VPS and the operator uses Claude
Code (scoped to `/srv/homekeep`) heavily, so putting the VPS-wide
context here makes it findable.

Future projects should reference these files from their own
`CLAUDE.md` rather than duplicating the content.

## Files

- **[`CLAUDE.md.proposed`](CLAUDE.md.proposed)** — draft content for
  `/opt/vps/CLAUDE.md`. A root user (or the operator's primary dev user
  with `sudo`) should install this at `/opt/vps/CLAUDE.md` and
  symlink each service user's `~/.claude/CLAUDE.md` to it.
- **[`root-claude-prompt.md`](root-claude-prompt.md)** — a
  self-contained prompt to paste into a Claude Code session **running
  as root** (or as the operator's primary dev user with `sudo` access).
  Executes the items this Claude (running as the `homekeep` service
  user) cannot do itself: create `/opt/vps/CLAUDE.md`, wire ACLs for
  centralized secrets, optionally install the Caddy godaddy DNS-01
  plugin.
- **[`github-repo-hygiene.md`](github-repo-hygiene.md)** — the
  checklist every new public repo should satisfy on day one: secret
  scanning, push protection, Dependabot, gitignore hygiene, PAT
  convention, Claude-files-on-GitHub rules. Includes copy-pastable API
  calls for enabling security features across multiple repos.
- **[`gitignore-baseline.md`](gitignore-baseline.md)** — recommended
  starter `.gitignore` for every project (language-agnostic section +
  stack-specific additions for Next.js, Python, Docker, PocketBase).
  Start every new repo from this.
- **[`email-setup.md`](email-setup.md)** — how to set up
  `security@the-kizz.com` / `<project>@the-kizz.com` using Zoho Mail
  free tier + Gmail "Send mail as". Gives you full-mailbox semantics
  (can reply from alias, personal email stays invisible) for free,
  without migrating DNS off GoDaddy.

## Context for a future reader

- The VPS hosts **multiple projects**, one Unix service user per project:
  - `sprout` — primary operator + owns the shared reverse-proxy Caddy
    (`revproxy-caddy-1`) at `/home/sprout/revproxy/`
  - `homekeep` — runs HomeKeep at `/srv/homekeep/`; this directory
  - `claude-dev` — runs aom-wiki at `/opt/aom-wiki/`
  - future projects follow the same shape
- **Shared infrastructure under `sprout`**:
  - `revproxy-caddy-1` on `--network host` (binds 80/443)
  - Vhost snippets import from `/home/sprout/revproxy/vhosts/*.caddy`
  - GoDaddy API creds at `/home/sprout/.config/godaddy/credentials`
- **the-kizz.com** is the user's project-facing domain. Pattern:
  `<project>.the-kizz.com` (prod) + `<project>.demo.the-kizz.com`
  (public demo) + `<project>.dev.the-kizz.com` (staging).
- **Wildcard DNS**: `*.the-kizz.com` → `46.62.151.57` exists (created
  2026-04-24). Any new subdomain works without a DNS step if the
  Caddy vhost references it and a wildcard TLS cert is available.

## Outcomes once the root-prompt is executed

1. `/opt/vps/CLAUDE.md` (mode 644, root-owned) installed
2. Each service user's `~/.claude/CLAUDE.md` symlinked to it
3. (optional) GoDaddy creds centralized at `/etc/secrets/godaddy.creds`
   with POSIX ACLs per project
4. (optional) `revproxy-caddy-1` rebuilt with `caddy-dns/godaddy`
   plugin so it can issue wildcard certs via DNS-01
5. `/opt/vps/PORTS.md` created — port allocation ledger for
   `127.0.0.1:3000-3999` range

Until root executes the prompt, nothing here takes effect — these
files are just artifacts for handoff.
