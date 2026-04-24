---
phase: 33
phase_name: VPS-wide Infrastructure Sync
status: shipped
mode: retroactive_with_bidirectional_root_handoff
covered_reqs: [INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05, INFRA-06, INFRA-07, INFRA-08, INFRA-09, INFRA-10]
deferred_reqs: [INFRA-11, INFRA-12, INFRA-13, INFRA-14]
root_execution_report: /opt/vps/reports/root-sync-2026-04-24T11-35-01Z.md
root_exec_timestamp: 2026-04-24T11:35:01Z
---

# Phase 33 Summary — VPS-wide Infrastructure Sync

## Trigger

During the v1.2.1 ship session (Phases 29-32 on 2026-04-24), several
cross-cutting operational items surfaced that needed root-level
execution and apply to **every project on the VPS**, not just
HomeKeep. Rather than letting them drift, this phase formalizes
the sweep via a bidirectional handoff between the `homekeep`-scoped
Claude and a root Claude session.

See `33-CONTEXT.md` for the full problem-space writeup.

## Execution pattern (novel — worth preserving)

This phase pioneered a reusable pattern for cross-user / cross-
privilege infrastructure work in a Claude-driven ops environment:

1. **Spec doc** — `docs/vps-setup/root-infra-sync.md` — idempotent,
   verify-before-apply, language-agnostic enough that any
   adequately-permissioned Claude (or human) could execute it.
2. **Paste prompt** — `docs/vps-setup/ROOT-ONE-LINER.md` — the
   literal single line the operator pastes into their root Claude
   to trigger execution. Names the spec, scopes non-goals, tags
   which tasks are auto-apply vs confirm-first.
3. **Timestamped report** — root Claude writes
   `/opt/vps/reports/root-sync-<ISO-timestamp>.md` with per-task
   outcomes, documented deviations, and a resume prompt.
4. **Resume prompt** — the tail of the report is a paste-ready
   block the operator hands back to the originating (non-root)
   Claude so both sessions share the same view of state.

This pattern worked cleanly; recommend reusing for future
cross-privilege infrastructure changes.

## REQ outcomes

### Completed (10)

**INFRA-01 — `/opt/vps/CLAUDE.md` VPS-wide operating manual.**
Installed by root Claude from the canonical source at
`/srv/homekeep/docs/vps-setup/CLAUDE.md.proposed`. Content covers:
host facts, subdomain convention (`<project>.the-kizz.com`), domain
scope (the-kizz.com = VPS, kizz.space = home-network server,
don't confuse them), TLS / reverse proxy / DNS patterns, secrets
layout (`/etc/secrets/*.creds` root:secrets), per-project onboarding
checklist, backups guidance, Claude Code memory rules, known failure
modes (host bind-mounts + userns remap, docker-group = root-
equivalent, port collisions, PAT expiry).

**INFRA-02 — Per-user `~/.claude/CLAUDE.md` via `@` imports.**
**DEVIATION from spec (deliberate, cleaner than spec).** Each service
user (`sprout`, `homekeep`, `claude-dev`) has a real file in their
home whose first line is `@/opt/vps/CLAUDE.md`. Claude Code's native
import syntax loads the shared manual at session start, then the
rest of the user's local file layers on per-user specifics (ports
they own, legacy pointers, etc.). Reason: `sprout`'s pre-existing
`~/.claude/CLAUDE.md` had 81 lines of unique context (home-server
IP, Sprout M0 port, aom-wiki archive, etc.). Symlink would have
relegated that content to a `.bak-*` sidecar; import keeps it
loaded. Sprout's pre-migration copy preserved at
`/home/sprout/.claude/CLAUDE.md.pre-vpsmanual-20260424-1025`.

**INFRA-03 — `/etc/skel/.claude/CLAUDE.md` bootstrap.**
One-line import + stub for user-specific notes. Future `adduser
<newproj>` auto-populates the new home with the shared manual
import. Replaces INFRA-02's per-user post-create symlink step for
future users.

**INFRA-04 — `/opt/vps/PORTS.md` port allocation ledger.**
Markdown table of reserved ports on the `127.0.0.1:3000-3999` range.
Current entries: `3000` (homekeep personal), `3001` (homekeep-demo).
Allocation policy embedded in the file: reserve before binding,
decommission = strike-through don't reassign.

**INFRA-05 — GoDaddy creds centralized at `/etc/secrets/godaddy.creds`.**
Root-owned, group `secrets`, mode `640`. POSIX ACL grants
`u:sprout:r` and `u:homekeep:r`. Both users added to the `secrets`
group for durability (future shared creds at `/etc/secrets/*.creds`
won't need per-user ACL ceremony — group membership suffices).
Source copies at `/home/sprout/.config/godaddy/credentials` and
`/srv/homekeep/.env` remain unchanged per operator instruction —
they get flipped to `source /etc/secrets/godaddy.creds` on next
natural key rotation, not preemptively.

**INFRA-06 — System-wide git excludesFile at
`/etc/gitignore-vps-baseline`.** Every repo on the VPS (past and
future, every user) now auto-ignores Claude session files, TLS keys,
`.env*`, `.DS_Store`, `*.log`, `*.swp`, `id_rsa`, `id_ed25519`,
`*.gpg`, `*.p12`, `*.pfx`, `*secret*.json`, etc. Wired via
`git config --system core.excludesFile /etc/gitignore-vps-baseline`
in `/etc/gitconfig` (newly created — no prior system-level git
config existed). **Additive** — each repo's own `.gitignore` still
applies in full; this is just the safety net. Does **not**
retroactively untrack already-committed files.

**INFRA-07 — Wildcard DNS `*.the-kizz.com → 46.62.151.57`.**
Applied earlier in the same session via GoDaddy API (from the
homekeep-scoped Claude — GoDaddy creds had been dropped into
`/srv/homekeep/.env` for that call). Every future subdomain on
`the-kizz.com` now resolves instantly without a per-project DNS
step.

**INFRA-08 — GitHub security features enabled on all 4
`the-kizz/*` repos.** Via GitHub REST API from the homekeep-scoped
Claude. Features: secret scanning, secret-scanning push protection
(blocks pushes containing detected token patterns), Dependabot
security updates (auto-PR for CVEs), Dependabot vulnerability
alerts. Applied to `homekeep`, `delivery-carrier`,
`product-attribute`, `geofeed`.

**INFRA-09 — Bidirectional root-Claude handoff pattern.**
`docs/vps-setup/root-infra-sync.md` (the spec),
`docs/vps-setup/ROOT-ONE-LINER.md` (paste prompt),
`/opt/vps/reports/` (report directory with mode 755 so non-root
users can list and read). Proven working end-to-end in this phase;
reusable for future cross-privilege infrastructure work.

**INFRA-10 — Project hygiene documentation committed to homekeep
repo.** Files under `docs/vps-setup/`:
`github-repo-hygiene.md` (day-one checklist),
`gitignore-baseline.md` (starter template + per-stack sections),
`email-setup.md` (Zoho Mail + Outlook-separate pattern, pending
operator Zoho signup).

### Deferred (4 — scheduled follow-up 2026-05-01 10:00 UTC)

**INFRA-11 — Wildcard TLS via `caddy-dns/godaddy` plugin.** Would
collapse per-subdomain HTTP-01 challenges into one DNS-01 wildcard
cert. Requires rebuilding the live `revproxy-caddy-1` image; skipped
to avoid interrupting in-flight project work. Procedure documented
in `/opt/vps/PORTS.md` tail + `root-infra-sync.md` tail.

**INFRA-12 — `sprout-m0.kizz.space` → `sprout-m0.the-kizz.com`
migration.** Legacy explicit A record surviving the domain-split
cleanup. Low priority; migrate when sprout touches that service
next.

**INFRA-13 — Flip inline GoDaddy creds to source
`/etc/secrets/godaddy.creds`.** Operator instruction: do on next
natural key rotation, not preemptively. Applies to
`/srv/homekeep/.env` (inline `GODADDY_API_KEY` + `GODADDY_API_SECRET`
added during Phase 30 demo-domain work) and
`/home/sprout/.config/godaddy/credentials` (the earlier canonical
sprout-only copy).

**INFRA-14 — Nightly backups cron `/etc/cron.daily/backups-projects`.**
Spec's Task 6. Root Claude skipped per operator instruction
because `/var/backups/` had pre-existing content (turned out to
be Ubuntu package-rotation artefacts, not a user backup set —
would have coexisted cleanly). Operator to re-approve on next
sync.

**Scheduling mechanism:** `vps-followup-20260501.timer` (systemd,
one-shot, `Persistent=true`) fires 2026-05-01 10:00 UTC and writes
`/opt/vps/FOLLOWUP-2026-05-01.md` with these four items. Future
Claude sessions pick up the FOLLOWUP file via the `/opt/vps/CLAUDE.md`
"Scheduled follow-ups" section at session start.

## Files + artefacts

### Committed to homekeep repo
```
docs/vps-setup/README.md
docs/vps-setup/CLAUDE.md.proposed         (source for /opt/vps/CLAUDE.md)
docs/vps-setup/ROOT-ONE-LINER.md          (operator paste prompt)
docs/vps-setup/root-infra-sync.md         (idempotent procedure spec)
docs/vps-setup/root-claude-prompt.md      (earlier procedure; kept for reference)
docs/vps-setup/github-repo-hygiene.md     (day-one checklist)
docs/vps-setup/gitignore-baseline.md      (starter .gitignore)
docs/vps-setup/email-setup.md             (Zoho setup, pending operator)
.planning/phases/33-vps-infra-sync/33-CONTEXT.md
.planning/phases/33-vps-infra-sync/33-01-P01-SUMMARY.md   (this file)
```

### Installed on the host (by root Claude)
```
/opt/vps/CLAUDE.md                                       (644)
/opt/vps/PORTS.md                                        (644)
/opt/vps/MIGRATION-2026-04-24.md                         (644)
/opt/vps/bin/followup-20260501.sh                        (755)
/opt/vps/reports/root-sync-2026-04-24T11-35-01Z.md       (644)
/etc/secrets/godaddy.creds                               (root:secrets 640 + ACL)
/etc/skel/.claude/CLAUDE.md                              (644)
/etc/gitignore-vps-baseline                              (644)
/etc/gitconfig                                           (system-level, 644)
/etc/systemd/system/vps-followup-20260501.service
/etc/systemd/system/vps-followup-20260501.timer          (enabled, oneshot, persistent)
/home/sprout/.claude/CLAUDE.md                           (sprout:sprout 644, imports shared)
/home/sprout/.claude/CLAUDE.md.pre-vpsmanual-20260424-1025  (backup of pre-migration)
/home/homekeep/.claude/CLAUDE.md                         (homekeep:homekeep 644, imports shared)
/home/claude-dev/.claude/CLAUDE.md                       (claude-dev:claude-dev 644, imports shared)
```

## Memory updates (Claude Code per-user memory)

- `vps_setup_root_prompt.md` — marked executed 2026-04-24T11:35:01Z;
  points at execution report
- `vps_infra_state_2026_04_24.md` — new reference memory summarizing
  the full as-built state
- `domain_strategy.md` — updated with the kizz.space = home-server
  clarification (was "personal domain" — more specific now:
  `144.6.229.170` home-network server wildcard, not this VPS)
- `github_hygiene.md` — marks "security features enabled on all 4
  repos" as done

## Verification (as of commit time)

```
$ cat /home/homekeep/.claude/CLAUDE.md | head -1
@/opt/vps/CLAUDE.md

$ git config --system --get core.excludesFile
/etc/gitignore-vps-baseline

$ groups homekeep
homekeep : homekeep sudo docker homekeep-dev secrets

$ getfacl /etc/secrets/godaddy.creds | grep ^user
user::rw-
user:homekeep:r--
user:sprout:r--

$ ls /opt/vps/
CLAUDE.md  MIGRATION-2026-04-24.md  PORTS.md  bin  reports

$ dig +short @1.1.1.1 anything.the-kizz.com
46.62.151.57          # wildcard resolving

$ systemctl list-timers 'vps-followup-*' --no-pager
… vps-followup-20260501.timer (fires 2026-05-01 10:00 UTC)
```

## Lessons worth keeping

1. **Import beats symlink for user-level CLAUDE.md.** Preserves
   unique per-user content alongside the shared manual in a single
   loaded-by-default file. No `.bak` sidecar drift.
2. **Group membership + POSIX ACL is the right double-layer.**
   Group is the durable, future-proof path; ACL is the narrow
   per-file override. Neither alone is sufficient for a multi-user
   multi-secret VPS.
3. **Bidirectional report + resume prompt is the right cross-privilege
   handoff shape.** Capture intent in a spec, execute idempotently,
   write verifiable report, end with paste-back block. No "did it
   run?" ambiguity.
4. **`git config --system core.excludesFile` is underused.** One
   `/etc/gitignore-vps-baseline` catches the universal patterns
   (`.env`, Claude session files, SSH/GPG keys, OS cruft) across
   every repo on the host, additive to per-repo `.gitignore`, no
   per-project work. Should be day-one for any multi-project host.
5. **Systemd timer + FOLLOWUP file is an auditable way to surface
   deferred work.** The timer fires, writes a Markdown file the
   next Claude session will find at session start (per the
   "Scheduled follow-ups" section of `/opt/vps/CLAUDE.md`). Better
   than a calendar reminder on an operator's phone.
