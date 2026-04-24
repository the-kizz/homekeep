<!-- gitleaks:allow (report filenames + ACME context — no real secrets) -->
---
phase: 34
phase_name: Revproxy Decouple from Sprout User
status: shipped
mode: bidirectional_root_handoff
covered_reqs: [INFRA-15, INFRA-16, INFRA-17, INFRA-18]
root_exec_timestamp: 2026-04-24 at 12:44 UTC
---

# Phase 34 Summary — Revproxy Decouple from Sprout User

Root execution report at `/opt/vps/reports/` (host-local,
timestamped 2026-04-24 around 12:44 UTC).

## Trigger

During the Phase 33 aftermath, HomeKeep's demo deploy surfaced an
architectural problem: **shared infrastructure (the reverse proxy)
was living inside one tenant's home dir** (`/home/sprout/revproxy/`),
which meant every project's edge-config change required sprout's
write permission on their own filesystem. That's a false coupling —
the revproxy serves every project on the VPS, not just sprout's.

Operator framed it plainly: "sprout is a completely separate project
though. I'm confused why anything needs to be done there. it's
running its own project."

Right call. Phase 34 decouples.

## REQ outcomes

**INFRA-15 — Move `/home/sprout/revproxy/` → `/opt/vps/revproxy/`.**
Compose file, Caddyfile, `data/` (ACME state — Let's Encrypt account +
issued certs), and `config/` all rsync'd across. Caddy picked up the
preserved state on recreate → no Let's Encrypt re-registration, no
cert re-fetch, instant resume. Container name unchanged
(`revproxy-caddy-1`), compose project unchanged (`revproxy`). Total
edge downtime during stop/start: within the announced 10-30 sec
window.

**INFRA-16 — Create `/opt/vps/vhosts/` with POSIX ACL for self-serve
drops.** Mode `775`, owned `root:secrets`. Default ACL grants
`rwx` to `homekeep`, `sprout`, `claude-dev` so files they create there
inherit their own writability + the shared group-readable posture.
Named ACLs on the directory itself mirror the default so existing
files are also reachable. Each project user now drops their own
project's vhost snippet directly — no cross-user permission handoff.

**INFRA-17 — Update `/opt/vps/CLAUDE.md` to codify the new layout.**
Root edited the installed manual to replace every `/home/sprout/revproxy/`
reference with the new `/opt/vps/revproxy/` + `/opt/vps/vhosts/`
pattern. Onboarding checklist step 5 now points at `/opt/vps/vhosts/`
as the vhost drop target. Post-verify copied the installed version
back to `/srv/homekeep/docs/vps-setup/CLAUDE.md.proposed` so source
and installed stay in sync (next root sync = empty diff). Every
future Claude session on any service user learns the new layout
automatically through the shared manual import.

**INFRA-18 — Mark old location deprecated + schedule cleanup reminder.**
`/home/sprout/revproxy/MIGRATED-TO-OPT-VPS.md` dropped with
explanation that the old dir is a 7-day rollback fallback. Systemd
timer `vps-followup-phase34-cleanup.timer` enabled (one-shot,
`Persistent=true`) — fires 2026-05-01 10:00 UTC and writes
`/opt/vps/FOLLOWUP-PHASE34-CLEANUP.md` with a live health-check +
"safe to delete" signal. The VPS-wide manual already instructs
future Claude sessions to check for FOLLOWUP files at session start,
so the reminder surfaces automatically.

## Execution pattern (same as Phase 33 — now proven twice)

1. Spec in `docs/vps-setup/phase-34-directive.md` (idempotent,
   verify-before-apply, risk register, rollback per task)
2. Paste prompt in `docs/vps-setup/PHASE-34-ONE-LINER.md`
3. Root Claude executes, writes timestamped report to
   `/opt/vps/reports/phase-34-<ISO>.md`
4. Report ends with TWO resume prompts — one per affected user's
   Claude session — so state propagates without re-scanning

Phase 33 had one resume prompt (just homekeep); Phase 34 had two
(homekeep + sprout). Pattern scales to N.

## Files changed in this commit

- `.planning/phases/34-revproxy-decouple/34-01-P01-SUMMARY.md` — this
  file
- `docs/vps-setup/CLAUDE.md.proposed` — synced from the installed
  `/opt/vps/CLAUDE.md` (root copied it back during Task 6
  post-verify; owner `homekeep:homekeep-dev`)
- `docker/docker-compose.demo-vps.yml` — comment block updated:
  vhost drop target is `/opt/vps/vhosts/`, not sprout's home
- `.planning/HANDOFF-2026-04-24-03.md` — sprout-side 3-command
  sequence retargeted (the commands no longer need sprout at all
  now that homekeep has direct write access to `/opt/vps/vhosts/`)
- `docs/vps-setup/README.md` — "Shared infrastructure under sprout"
  section rewritten as "Shared infrastructure under `/opt/vps/`"
  reflecting the decoupled state

## What's NOT in this phase

- **Wildcard TLS plugin rebuild** — separate deferred follow-up,
  will surface via the 2026-05-01 systemd timer
- **Deletion of `/home/sprout/revproxy/`** — 7-day cooling-off
  period, sprout removes when ready (or the Phase 34 cleanup timer
  prompt will confirm safety)
- **Promoting `gd-add-subdomain` to `/opt/vps/bin/`** — sprout's
  call; mentioned in resume prompt B as optional

## Verification (homekeep-user perspective, post-commit)

```bash
docker inspect revproxy-caddy-1 --format '{{range .Mounts}}{{.Source}}{{"\n"}}{{end}}'
# All 4 mounts point at /opt/vps/revproxy/* or /opt/vps/vhosts

[ -w /opt/vps/vhosts ] && echo "I can drop vhosts here"

diff /opt/vps/CLAUDE.md /srv/homekeep/docs/vps-setup/CLAUDE.md.proposed \
  && echo "source ↔ installed in sync"

systemctl list-timers 'vps-followup-*' --no-pager
# vps-followup-phase34-cleanup.timer armed for 2026-05-01 10:00 UTC
```

## Lessons worth keeping (additive to Phase 33's lessons)

- **"Shared infrastructure should have neutral ownership."** The root
  CLAUDE.md convention already puts shared things under `/opt/vps/`
  (CLAUDE.md, PORTS.md, reports/, bin/). Extending that to
  `/opt/vps/revproxy/` + `/opt/vps/vhosts/` is the natural evolution.
  Future: any resource serving more than one project belongs under
  `/opt/vps/` or `/etc/secrets/`, not in a user's home.
- **ACL with default entries is the self-serve mechanism.**
  `setfacl -d -m u:X:rwx <dir>` means files CREATED in that dir
  inherit write-back-to-X. Combine with a named group (`secrets`,
  or a future `vhost-writers`) for durability.
- **Bidirectional handoff scales to N users.** Phase 33 had 1
  affected Claude (homekeep); Phase 34 had 2 (homekeep + sprout).
  The pattern (spec → execute → report → N resume prompts) is the
  same; just increment N as the blast radius grows.
