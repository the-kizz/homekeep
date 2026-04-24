---
phase: 22
phase_name: emergency-deployment-hotfix
plan: 22-01-P01
executed: 2026-04-23
status: passed (HOTFIX-01, HOTFIX-02 shipped; HOTFIX-03 pending user action)
requirements_completed:
  - HOTFIX-01
  - HOTFIX-02
requirements_pending_user:
  - HOTFIX-03
test_delta: 0 (ops + config only, no unit/E2E impact)
---

# Phase 22 Summary — Emergency Deployment Hotfix

**Executed:** 2026-04-23 (same-day triage of 3 CRITICAL deployment exposures from v1.2-security research)

## HOTFIX-01 — PB admin /_/ blocked from public ✓

**Files modified:**
- `docker/Caddyfile` — new `@admin_path` matcher blocks `/_/*`, `/api/_superusers`, `/api/_superusers/*`, `/api/collections/_superusers/*`; env flag `ALLOW_PUBLIC_ADMIN_UI=true` bypasses
- `docker/Caddyfile.prod` — same block at external proxy layer (defense-in-depth)

**Commit:** `279b379` fix(22): block PB admin /_/ from public (HOTFIX-01)

**Build + deploy:**
- Edge workflow rebuilt `ghcr.io/the-kizz/homekeep:edge` with new Caddyfile (commit 279b379)
- VPS pulled `:edge`, redeployed via `docker-compose.yml + docker-compose.vps.yml`
- Live verification:
  - `curl -sI http://46.62.151.57:3000/_/` → HTTP/1.1 **404 Not Found** ✓
  - `curl -sI http://46.62.151.57:3000/api/_superusers` → HTTP/1.1 **404 Not Found** ✓
  - `curl -sI http://46.62.151.57:3000/` → HTTP/1.1 **200 OK** ✓
  - `curl -s http://46.62.151.57:3000/api/health` → `{"status":"ok","nextjs":"ok","pocketbase":"ok"}` ✓

## HOTFIX-02 — Live VPS secrets rotated ✓

**Changes (docker/.env on VPS — gitignored, local-only):**
- `PB_ADMIN_PASSWORD` regenerated via `openssl rand -base64 32` (43-char base64)
- `ADMIN_SCHEDULER_TOKEN` regenerated via `openssl rand -hex 32` (64-char hex)
- File permissions `chmod 600`
- Backup saved to `docker/.env.pre-22-backup` (also 600)

**PB superuser password updated:**
```
docker exec homekeep pocketbase superuser update "$PB_ADMIN_EMAIL" "$PB_ADMIN_PASSWORD" --dir /app/data/pb_data
# → Successfully changed superuser "admin@homekeep.local" password!
```

**Container restarted** with new env vars. Health endpoint confirms PB + Next.js reconnect correctly with new password.

**Note:** Since HOTFIX-01 blocks `/_/` from public, the PB admin password is now only needed for `docker exec` ops work. The block provides defense-in-depth beyond the password strength alone.

## HOTFIX-03 — GitHub PAT rotation ⏳ PENDING USER ACTION

**Status:** Not completed — requires user-driven GitHub UI action.

**Required steps (user, via browser):**
1. Go to https://github.com/settings/tokens?type=beta (Fine-grained tokens)
2. Generate new token: Repository access = `the-kizz/homekeep` only; Permissions: contents rw, packages rw, issues rw, pull requests rw, actions read
3. Copy new token, update `/root/projects/homekeep/.env` on VPS (replace `GITHUB_PAT=...`)
4. Go to https://github.com/settings/tokens (classic PAT page), revoke the old token (scopes: admin:org, delete_repo, packages)
5. Verify: `git fetch origin` with new PAT succeeds

**Until done:** the classic PAT with overscoped permissions remains exfiltration-risk if the VPS is compromised. Priority: HIGH.

## Commits

- `b16eaf6` docs(22): capture phase context
- `279b379` fix(22): block PB admin /_/ from public (HOTFIX-01)
- `05eca53` docs(v1.2): lock personal-vs-demo architecture decision
- `6cb918a` docs(v1.2): record the-kizz.com subdomain + godaddy API architecture
- `5c7c4f5` docs(v1.2): refine subdomain convention + VPS role

## Architecture decisions captured during Phase 22

Recorded in STATE.md:

1. **Personal vs demo:** Personal instance goes to user's homelab (LAN/Tailscale), not VPS. VPS is development + public demo host.
2. **Subdomain convention:** `<project>.demo.the-kizz.com` for demos. HomeKeep demo target: `homekeep.demo.the-kizz.com`.
3. **Wildcard cert:** `*.demo.the-kizz.com` via Let's Encrypt DNS-01 + godaddy plugin covers all future project demos with one cert.
4. **VPS retirement of IP:3000:** Current `46.62.151.57:3000` path retired once subdomain cuts over in Phase 26.

## Verification checklist

- [x] Internal Caddyfile blocks `/_/*` with 404 (grep-verified)
- [x] External Caddyfile.prod blocks same paths (defense-in-depth)
- [x] `ALLOW_PUBLIC_ADMIN_UI` env flag works as bypass (untested live but grep-confirmed in both files)
- [x] Edge image rebuild on commit 279b379 succeeded
- [x] VPS pulled + restarted with new image
- [x] Live `/_/` returns 404
- [x] Live `/api/_superusers` returns 404
- [x] Live `/` returns 200
- [x] Live `/api/health` returns ok
- [x] PB_ADMIN_PASSWORD rotated in .env
- [x] ADMIN_SCHEDULER_TOKEN rotated in .env
- [x] docker/.env perms 600
- [x] PB superuser password updated in PB DB
- [x] Container restarted with new env
- [ ] HOTFIX-03: GitHub PAT rotated (user action pending)

## Phase close status

**Blocking pending:** HOTFIX-03 requires user to rotate PAT via GitHub UI. Phase 22 can be marked formally complete once done. Meanwhile, Phase 23+ proceeds — HOTFIX-03 is orthogonal to code-level work.
