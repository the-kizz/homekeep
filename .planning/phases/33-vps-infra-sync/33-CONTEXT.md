# Phase 33 — VPS-wide infrastructure sync

**Initiated:** 2026-04-24
**Mode:** infra / cross-cutting (retroactive GSD formalization)
**Parent milestone:** v1.2.1 (follow-up ops; not a PATCH2 REQ)

## Why this phase exists

HomeKeep is the first tenant of a multi-project VPS (Hetzner
`aom-wiki`, 46.62.151.57) that already hosts `aom-wiki` under user
`claude-dev` and the operator's primary dev work under user `sprout`.
During the v1.2.1 session (Phases 29-32), several cross-cutting
infrastructure items surfaced that apply to **all projects** on this
VPS, present and future — not just HomeKeep:

1. **No shared VPS-wide Claude memory.** Each service user's Claude
   sessions ran with no cross-project operating context. Every new
   project would re-learn the same patterns (reverse proxy layout,
   port allocation, GoDaddy creds location, host bind-mount quirks).
2. **GoDaddy API creds duplicated.** Canonical file at
   `/home/sprout/.config/godaddy/credentials` + inline copy at
   `/srv/homekeep/.env` (added during the Phase 30 demo-domain
   work). Future projects would accumulate more copies → rotation
   becomes a multi-file ritual; drift is inevitable.
3. **No system-wide `.gitignore` safety net.** Each repo's own
   `.gitignore` is the only barrier to accidentally committing
   Claude session files, TLS keys, `.env` copies, etc. One missed
   line in one repo = leak.
4. **No port allocation ledger.** Port collisions on `127.0.0.1:3000-
   3999` waiting to happen once the second project lands.
5. **No onboarding checklist for future service users.** Every new
   project required operator memory of the convention; no `/etc/skel`
   bootstrap to inherit the shared manual automatically.

Separately, the operator flagged:

6. **GitHub hygiene gap.** Secret scanning, push protection, and
   Dependabot were off on all 4 `github.com/the-kizz/*` repos until
   this session.
7. **Project email identity.** No `security@the-kizz.com` or
   per-project email aliases — SECURITY.md still had the
   `security@homekeep.example` placeholder.

This phase formalizes the work that addressed items 1-7. Most of
items 1-5 required root access (Claude runs as `homekeep` user,
uid 999); those were executed via a bidirectional root-Claude
handoff pattern (spec doc → root session → timestamped report →
resume prompt back to homekeep Claude).

## Scope

### Completed in this session (2026-04-24)

- INFRA-01: VPS-wide operating manual at `/opt/vps/CLAUDE.md`
- INFRA-02: Per-user `~/.claude/CLAUDE.md` imports via `@` syntax
  (deliberate deviation from the spec's symlink approach — see
  SUMMARY for rationale)
- INFRA-03: `/etc/skel/.claude/CLAUDE.md` bootstrap so `adduser`
  auto-populates new service users with the import
- INFRA-04: `/opt/vps/PORTS.md` port allocation ledger
- INFRA-05: GoDaddy creds centralized at `/etc/secrets/godaddy.creds`
  (`root:secrets 640`, POSIX ACL `u:sprout:r` + `u:homekeep:r`,
  both users added to `secrets` group for durability)
- INFRA-06: System-wide `git config --system core.excludesFile
  /etc/gitignore-vps-baseline` — every repo on the VPS auto-ignores
  the lowest-common-denominator patterns (Claude sessions, TLS keys,
  `.env`, OS cruft) without touching per-repo `.gitignore`
- INFRA-07: Wildcard DNS `*.the-kizz.com → 46.62.151.57` via GoDaddy
  API (makes future subdomain provisioning zero-DNS-step)
- INFRA-08: GitHub security features enabled on all 4 `the-kizz/*`
  repos (secret scanning, push protection, Dependabot security
  updates, vulnerability alerts)
- INFRA-09: Bidirectional root-Claude handoff pattern
  (`docs/vps-setup/root-infra-sync.md` spec → `/opt/vps/reports/`
  timestamped reports → resume prompts back to the project Claude).
  Reusable pattern for future root-level infrastructure work.
- INFRA-10: Drafting docs for future project hygiene:
  `docs/vps-setup/github-repo-hygiene.md`,
  `docs/vps-setup/gitignore-baseline.md`,
  `docs/vps-setup/email-setup.md`.

### Deferred (scheduled follow-ups, systemd timer at 2026-05-01 10:00 UTC)

- INFRA-11: Wildcard TLS via `caddy-dns/godaddy` plugin for the
  shared revproxy. Currently using per-subdomain HTTP-01. Plugin
  install requires rebuilding the live Caddy image; deferred to
  avoid interrupting in-flight services.
- INFRA-12: `sprout-m0.kizz.space` DNS migration → `sprout-m0.the-kizz.com`.
  Legacy explicit A record surviving the domain-split cleanup.
- INFRA-13: Flip `/srv/homekeep/.env` (and
  `/home/sprout/.config/godaddy/credentials`) to `source
  /etc/secrets/godaddy.creds` instead of inline values. Operator
  instruction is to do this on next natural key rotation, not
  preemptively.
- INFRA-14 (separate): Nightly backups cron
  `/etc/cron.daily/backups-projects`. Spec's Task 6; root skipped
  pending operator confirmation on pre-existing `/var/backups/`
  content (turned out to be Ubuntu rotation artefacts, not a
  conflict — just needed operator sign-off).

### Out of scope for this phase (tracked elsewhere)

- **Email setup** (Zoho Mail free + Gmail/Outlook integration) —
  documented in `docs/vps-setup/email-setup.md` but waits on
  operator Zoho signup. Will become its own phase when executed.
- **HOTFIX-03** — fine-grained GitHub PAT rotation. Still pending.
- **HomeKeep-personal migration VPS → homelab** — architectural
  decision, belongs to a separate milestone.

## Deliverables

1. Phase `33-01-P01-SUMMARY.md` (this phase's operator-visible
   outcome record)
2. Files in `/srv/homekeep/docs/vps-setup/` (committed to homekeep
   repo so future sessions + projects can reference):
   - `README.md` (directory index)
   - `CLAUDE.md.proposed` (canonical source for `/opt/vps/CLAUDE.md`)
   - `ROOT-ONE-LINER.md` (operator paste prompt)
   - `root-infra-sync.md` (idempotent procedure)
   - `root-claude-prompt.md` (earlier procedure; superseded but kept
     as reference)
   - `github-repo-hygiene.md` (day-one checklist for new repos)
   - `gitignore-baseline.md` (starter `.gitignore` + per-stack additions)
   - `email-setup.md` (Zoho+Outlook pattern, pending operator action)
3. Files installed on the host (via root-Claude execution):
   - `/opt/vps/CLAUDE.md`
   - `/opt/vps/PORTS.md`
   - `/opt/vps/bin/followup-20260501.sh` (scheduled follow-up
     executor, one-shot, writes `/opt/vps/FOLLOWUP-2026-05-01.md`)
   - `/opt/vps/MIGRATION-2026-04-24.md` (paste-in for pre-migration
     running Claude sessions)
   - `/opt/vps/reports/root-sync-2026-04-24T11-35-01Z.md` (execution
     report)
   - `/etc/secrets/godaddy.creds`
   - `/etc/skel/.claude/CLAUDE.md`
   - `/etc/gitignore-vps-baseline`
   - `/etc/gitconfig` (newly created with `core.excludesFile`)
   - `/etc/systemd/system/vps-followup-20260501.{service,timer}`
4. Memory updates for continuity across Claude sessions
   (`github_hygiene.md`, `vps_setup_root_prompt.md` marked executed,
   new `vps_infra_state_2026_04_24.md`)

## Success criteria (for SUMMARY)

- [x] All 10 completed INFRA items verified on the live VPS
- [x] Root sync report written, readable by homekeep user, archived
- [x] Resume prompt applied to homekeep Claude memory
- [x] Source `CLAUDE.md.proposed` synced to match installed version
  (idempotency preserved for future root sync re-runs)
- [x] `/opt/vps/MIGRATION-2026-04-24.md` pasted into the two
  running Claude sessions (or those sessions were restarted)
- [ ] 4 deferred items (INFRA-11..14) either executed by
  2026-05-01 10:00 UTC or surfaced via the systemd-timer FOLLOWUP
  file on that date
