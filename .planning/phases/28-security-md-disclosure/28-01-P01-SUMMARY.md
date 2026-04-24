---
phase: 28
plan: 28-01-P01
subsystem: documentation
tags: [docs, security, disclosure, threat-model, operator-hardening, spec-changelog]
requirements: [SECDOC-01, SECDOC-02, SECDOC-03, SECDOC-04]
dependency_graph:
  requires:
    - Phase 22 (HOTFIX-01..03 — admin UI block + secret rotation)
    - Phase 23 (SEC-01..07 — code attack surface sweep)
    - Phase 24 (HDR-01..04 — headers + CSP-Report-Only + stealth build)
    - Phase 25 (RATE-01..06 — quotas + bucket tightening + invite lockout)
    - Phase 26 (DEMO-01..05 — demo instance architecture)
    - Phase 27 (SUPPLY-01..06 — cosign + SBOM + SHA-pin + telemetry off)
  provides:
    - Public disclosure policy (SECURITY.md at repo root)
    - 15-item operator checklist (docs/deployment-hardening.md)
    - Cross-link graph from README + SPEC + deployment.md → SECURITY.md
    - SPEC v0.5 changelog documenting every SEC/HDR/RATE/DEMO/SUPPLY/SECDOC item
  affects:
    - README.md (new "Security" section before "Provenance")
    - SPEC.md (version 0.4 → 0.5; status → Release-ready for v1.2.0; License line references SECURITY.md; new v0.5 changelog entry)
    - docs/deployment.md (new "Public deployment hardening" subsection)
tech_stack:
  added: []
  patterns:
    - Dropbox + GitHub style safe-harbor language
    - Staged-disclosure SLA (7-day ack, 90-day fix-or-disclose)
    - Placeholder contact pattern (security@homekeep.example + PGP TBD) for user-driven post-release fill-in
    - 15-item operator checklist format: description / why / how / verify per item
key_files:
  created:
    - SECURITY.md
    - docs/deployment-hardening.md
    - .planning/phases/28-security-md-disclosure/28-01-P01-SUMMARY.md
  modified:
    - README.md (+ Security section)
    - SPEC.md (version bump + changelog + license line cross-link)
    - docs/deployment.md (+ hardening subsection)
decisions:
  - Email + PGP key kept as placeholders (security@homekeep.example / TBD). User action post-release to fill in real contact.
  - Safe-harbor language modelled on Dropbox + GitHub (industry standard; reassuring without over-committing).
  - SECDOC-01 Supported Versions table lists v1.2.x as the only supported minor (older minors superseded) — matches the project's "patch the latest minor only" backport policy.
  - SECDOC-01 Public Advisories table ships empty — every v1.2-security finding was fixed pre-publication, so there is nothing to advise against a shipped version yet.
  - SECDOC-02 ordered the 15 items in Phase 22-27 dependency order (DOMAIN first, cosign verify last) so an operator working the list can sanity-check each prior item's state before moving on.
  - SECDOC-02 used the exact env var names surfaced by the code sweep (MAX_HOMES_PER_OWNER etc.) rather than shorter generic names, so ctrl-F across the repo finds the single source of truth.
  - SECDOC-03 inserted the README "Security" section BEFORE "Provenance" to keep the operator-visible order: Contributing → License → Security → Provenance → Credits.
  - SECDOC-03 SPEC.md "License" cross-link appended to the existing single-line header (no new section) because SPEC.md has no dedicated "## License" heading and the top-of-doc metadata is the canonical license location.
  - SECDOC-04 changelog modelled on the v0.4 format: discovery paragraph → phase-grouped bullet lists → test delta → deferred. Each REQ-ID gets one bullet; implementation details that matter for future forensic review (PB datetime format quirk, JSVM handler re-dispatch, cosign identity regexp) are inlined.
metrics:
  duration_minutes: ~25
  tasks_completed: 4
  files_created: 3
  files_modified: 3
  commits: 4 (+ 1 completion commit)
  test_delta: 0 (pure docs)
---

# Phase 28 Plan 01-P01: SECURITY.md + Responsible Disclosure — Summary

Close the v1.2-security milestone with the public face of the hardening
work: a disclosure policy at the repo root, a 15-item operator checklist
for public deployments, cross-links from README + SPEC + deployment.md,
and SPEC.md v0.5 documenting every shipped SEC/HDR/RATE/DEMO/SUPPLY item.

## Deliverables

### SECDOC-01 — `SECURITY.md` at repo root (commit `7b739d9`)

New top-level policy file with the following sections:

- **Supported versions** — table marking v1.2.x supported, older minors
  superseded. Patch-latest-minor-only backport policy documented.
- **Threat model summary** — three paragraphs: what HomeKeep protects
  (per-household isolation, admin-UI edge block, cosign-signed builds),
  what it does not (no MFA, no audit log, no PII minimisation on notes,
  single-scheduler assumption), and deployment-model assumptions
  (LAN / tailnet default; public requires `docs/deployment-hardening.md`;
  demo is its own risk profile).
- **Reporting a vulnerability** — placeholder email
  `security@homekeep.example`, PGP fingerprint `TBD`, submission
  guidance, and the 7-day ack / 90-day fix-or-disclose SLA. User-driven
  post-release fill-in for the real contact.
- **Scope** — explicit in-scope (HomeKeep source, GHCR images, compose +
  Caddy + PB hooks + migrations, release workflows, helper scripts,
  shipped docs) and out-of-scope (self-hosted custom modifications,
  operator error, third-party deps, social engineering, sustained DoS
  above the rate-limit buckets).
- **Safe harbor** — Dropbox + GitHub style good-faith language. No
  legal threats, credit via changelog, conditional on good-faith
  research practices.
- **Public advisories** — empty table (all v1.2-security findings
  fixed pre-publication). Forward-looking placeholder for future
  advisories.

### SECDOC-02 — `docs/deployment-hardening.md` (commit `e271b53`)

15-item operator checklist for public-facing deployments. Each item has
four subsections: Description, Why it matters, How (command + config),
Verify. Item order follows Phase 22-27 dependency chain so an operator
working top-to-bottom validates each prior item before advancing.

| # | Item | Source phase |
|---|------|--------------|
| 1 | DOMAIN + Caddy overlay | Phase 07 baseline |
| 2 | `PB_ADMIN_PASSWORD` via `openssl rand -base64 32` | Phase 22 HOTFIX-02 |
| 3 | `ADMIN_SCHEDULER_TOKEN` via `openssl rand -hex 32` | Phase 22 + Phase 23 SEC-03 |
| 4 | `docker/.env` perms `600` | Phase 22 HOTFIX-02 |
| 5 | `/_/` returns 404 | Phase 22 HOTFIX-01 |
| 6 | Security headers present | Phase 24 HDR-01..02 |
| 7 | Firewall: only 80/443 open | Phase 22 deployment decision |
| 8 | `ALLOW_PUBLIC_ADMIN_UI=false` | Phase 22 HOTFIX-01 escape hatch |
| 9 | Fine-grained PAT | Phase 22 HOTFIX-03 |
| 10 | `HK_BUILD_STEALTH=true` | Phase 24 HDR-04 |
| 11 | Row quotas (`MAX_*_PER_*`) | Phase 25 RATE-01 |
| 12 | 90-day rotation plan | Phase 22 + industry norm |
| 13 | Monitor `/api/csp-report` | Phase 24 HDR-03 |
| 14 | Subscribe to release feed | Operator hygiene |
| 15 | `cosign verify` on pull | Phase 27 SUPPLY-01..02 |

Summary table at the end of the file lets an operator ctrl-F the
one-line check for any item. 580 lines total.

### SECDOC-03 — Cross-links (commit `dde76c9`)

Three cross-link insertions, all non-destructive to surrounding prose:

- **README.md** — new "## Security" section inserted between
  "## License" and "## Provenance". Short blurb: "Found a vulnerability?
  See SECURITY.md...". Also references `docs/deployment-hardening.md`
  for operators.
- **SPEC.md** — License line at the top-of-doc metadata block appended
  with `(see SECURITY.md for reporting security issues)`. No new section
  because SPEC.md has no dedicated `## License` heading.
- **docs/deployment.md** — new "## Public deployment hardening"
  subsection inserted before "## Release + tagging (INFR-09)". Two-
  paragraph pointer to `docs/deployment-hardening.md` + `SECURITY.md`.

### SECDOC-04 — SPEC.md v0.5 bump + changelog (commit `39f7ee9`)

Version header updated:

- `**Version:** 0.4` → `**Version:** 0.5 (v1.2 Red Team Audit & Public-Facing Hardening)`
- `**Status:** Release-ready for v1.1.0-rc1` → `**Status:** Release-ready for v1.2.0`

New `### v0.5 — Red Team Audit & Public-Facing Hardening (2026-04-24)`
changelog section prepended to the Changelog (before the existing v0.4
entry). Format mirrors v0.4: discovery paragraph → phase-grouped bullet
lists → test delta → deferred items.

Phase coverage in the changelog (all 35 v1.2-security REQ-IDs mentioned
by name):

- Phase 22 HOTFIX-01..03 (3)
- Phase 23 SEC-01..07 (7)
- Phase 24 HDR-01..04 (4)
- Phase 25 RATE-01..06 (6)
- Phase 26 DEMO-01..05 (5)
- Phase 27 SUPPLY-01..06 (6)
- Phase 28 SECDOC-01..04 (4)

Test-delta section totals +62 tests cumulative across Phases 22-27
(610 pre → 672 post).

## Validation

```
=== SECURITY.md section check ===
## Supported versions
## Threat model summary
## Reporting a vulnerability
## Scope
## Safe harbor
## Public advisories

=== deployment-hardening.md items check ===
15

=== SPEC.md v0.5 header ===
### v0.5 — Red Team Audit & Public-Facing Hardening (2026-04-24)
### v0.4 — v1.1 Scheduling & Flexibility (2026-04-22)

=== Cross-links ===
README.md: [SECURITY.md](SECURITY.md)
SPEC.md:   [SECURITY.md](SECURITY.md)
docs/deployment.md:        [SECURITY.md](../SECURITY.md)
docs/deployment-hardening.md: [SECURITY.md](../SECURITY.md)
```

All 4 deliverables present. All cross-references resolve to correct
paths (root-relative from README + SPEC; one-up from docs/). No
markdown syntax errors. Pure docs — zero test impact, so no test suite
run required.

## Deviations from Plan

### Scope adjustments

**1. SECURITY.md supported-versions table scope**

- **Plan text:** "v1.1.x (supported), v1.1.0-rc1 (no longer supported), earlier (none)"
- **Actual:** v1.2.x (supported), v1.1.x (superseded), v1.0.x (superseded), <1.0 (no)
- **Why:** the plan text was drafted before Phase 27 shipped. By the time Phase 28 runs, v1.2.0 is the imminent tag — so the table has to describe the post-publication state, not the pre-Phase-28 state. Backport policy unchanged ("patch the latest minor only").

**2. README "## Security" section placement**

- **Plan text (CONTEXT D-01):** "linking SECURITY.md (under 'What it is' or a new top-level section)"
- **Actual:** new top-level section between "## License" and "## Provenance"
- **Why:** inserting under "What it is" would bury it; users looking for a disclosure policy scroll to the end of a README, not the opening pitch. Placement mirrors industry convention (most well-known OSS README docs put Security near License).

**3. SPEC.md cross-link technique**

- **Plan text (CONTEXT D-01):** "'License' section follow-up: 'See SECURITY.md for reporting vulnerabilities'"
- **Actual:** appended a parenthetical reference to the existing top-of-doc License metadata line (line 5)
- **Why:** SPEC.md has no dedicated `## License` heading. The top-of-doc `**License:** AGPL-3.0-or-later` line IS the canonical license location; adding a follow-up section would duplicate it. The parenthetical preserves the one-line metadata convention used by the existing v0.4 format.

## Known Stubs

- **Email address `security@homekeep.example`** — placeholder. User action post-release to replace with a real maintainer contact.
- **PGP key fingerprint `TBD`** — placeholder. User action post-release to generate a key, publish at `/.well-known/security.txt`, and attach to the next annotated release tag.
- **Numbered advisory site** — deferred to v1.3. Current plan: attach advisories to GitHub release notes as they arise.

None of these block a v1.2.0 tag cut; they are user-driven maintenance
items captured in the SECURITY.md body itself ("TBD" / "placeholder")
so downstream readers know what is intentional.

## Commits

| Requirement | Subject                                                            | SHA      |
|-------------|--------------------------------------------------------------------|----------|
| SECDOC-01   | `docs(28): add SECURITY.md (SECDOC-01)`                             | 7b739d9  |
| SECDOC-02   | `docs(28): add operator hardening checklist (SECDOC-02)`            | e271b53  |
| SECDOC-03   | `docs(28): cross-link SECURITY.md from README + SPEC + deployment docs (SECDOC-03)` | dde76c9  |
| SECDOC-04   | `docs(28): SPEC.md v0.5 + v1.2-security changelog (SECDOC-04)`      | 39f7ee9  |

Plus one phase-close commit for the summary file.

## Self-Check: PASSED

Created files verified on disk:

```
FOUND: SECURITY.md
FOUND: docs/deployment-hardening.md
FOUND: .planning/phases/28-security-md-disclosure/28-01-P01-SUMMARY.md
```

Modified files verified:

```
FOUND: README.md (SECURITY.md reference on line 290)
FOUND: SPEC.md (version 0.5 on line 3; changelog v0.5 header present)
FOUND: docs/deployment.md (hardening subsection links deployment-hardening.md)
```

All 4 REQ-IDs (SECDOC-01..04) ready for mark-complete. v1.2-security
milestone closes with this phase.
