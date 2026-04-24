# Security Policy

HomeKeep is a small, self-hosted household-maintenance app. We take security
seriously because the people running it are trusting a weekend project with
their family's data. This document describes what is supported, what we
protect against, how to report a vulnerability, and what you can expect back.

## Supported versions

Security patches are backported to the latest patch of the most recent minor
release only. Older minors do not receive fixes — upgrade to stay covered.

| Version | Supported          |
|---------|--------------------|
| 1.2.x   | :white_check_mark: |
| 1.1.x   | :x: (superseded)   |
| 1.0.x   | :x: (superseded)   |
| < 1.0   | :x:                |

Floating tags (`:latest`, `:rc`, `:edge`, `:1`) track the appropriate stable,
release-candidate, or HEAD build. Pin to an exact semver for reproducible
deployments; pin to `:1` for conservative auto-updates within the major line.

## Threat model summary

**What HomeKeep protects.** Per-household data isolation: a signed-in member
of home A cannot read, write, or enumerate data belonging to home B through
normal app navigation, server actions, or the PocketBase REST API. The
PocketBase rule layer is reinforced by application-layer checks on every
server action (see `lib/actions/*`). Admin credentials and the internal
PocketBase admin UI are not reachable from the public internet on the
baseline compose chain — the reverse proxy blocks `/_/*`, `/api/_superusers`,
and `/api/collections/_superusers/*` with a 404. Build artefacts ship with
cryptographic provenance: cosign keyless signatures, SPDX SBOMs, and SLSA-3
provenance attestations on every tagged release (see `.github/workflows/`).

**What HomeKeep does not protect.** This is a single-household app, not a
multi-tenant SaaS. There is no MFA, no audit log, no account-lockout after
N failed logins beyond the 20-request-per-minute rate bucket, no PII
minimisation on the free-form `notes` field, and no anti-abuse on open
signup beyond a 10-request-per-minute per-IP bucket. The scheduler runs as
a single in-container process with no leader election; running multiple
replicas behind a load balancer is explicitly unsupported and will produce
duplicate notifications. Third-party dependencies (PocketBase, Next.js,
ntfy, node, Alpine) are pinned by digest but their own CVEs are the
operator's responsibility to monitor — report those upstream.

**Deployment model assumptions.** HomeKeep is designed for LAN-only or
tailnet deployments. The Caddy public-domain overlay is supported, but
operators exposing a HomeKeep instance to the public internet MUST follow
every step in [`docs/deployment-hardening.md`](docs/deployment-hardening.md)
— strong secrets, firewall rules, rate-limit posture, log redaction, and
AGPL source-availability are operator responsibilities, not defaults.
A public demo that accepts arbitrary signups is a different risk profile
from a single-household instance; the `docker-compose.demo.yml` overlay
documents the extra isolation required (tmpfs state, per-visitor ephemeral
users, 2h / 24h cleanup cron).

## Reporting a vulnerability

Please email: **security@homekeep.example** *(placeholder — maintainer will
replace with a real contact address before the first public v1.2 tag)*.

PGP key fingerprint: **TBD** *(placeholder — a real key will be published at
`/.well-known/security.txt` and attached to the next annotated release tag)*.

Do **not** open a public GitHub issue for security-sensitive reports. If in
doubt about whether an issue is security-sensitive, email first; we can
always move it to a public issue later.

When you email, please include:

- A concise description of the issue (what, where, impact)
- Reproduction steps or proof-of-concept (even a rough one is fine)
- The HomeKeep version / tag you observed (e.g. `:v1.2.0`, `:edge`, commit SHA)
- Your preferred contact for follow-up and whether you want credit in the
  changelog

### Response SLA

- **Acknowledgement:** within **7 days** of receipt. A human will reply and
  confirm the report is being triaged.
- **Fix or public disclosure:** within **90 days** of acknowledgement for
  confirmed, in-scope vulnerabilities. If a fix lands sooner, we coordinate
  a disclosure date with the reporter. If a fix needs longer, we agree on
  an extension in writing.
- **Out-of-scope reports:** we will reply within 7 days explaining why, and
  point you at the upstream project or operator channel if appropriate.

## Scope

**In scope:**

- HomeKeep source code in this repository (`app/`, `lib/`, `components/`,
  `pocketbase/pb_hooks/`, `pocketbase/pb_migrations/`, `scripts/`)
- Official container images published to
  `ghcr.io/conroyke56/homekeep` (all tags)
- Shipped deployment configuration: `docker/Dockerfile`,
  `docker/docker-compose*.yml`, `docker/Caddyfile*`,
  `docker/s6-rc.d/*`, `.env.example`
- Shipped PocketBase JSVM hooks and migrations
- GitHub Actions workflows under `.github/workflows/` (release, ci, edge)
- Official helper scripts (`scripts/dev-pb.js`, `scripts/check-multiarch.sh`,
  `scripts/check-image-size.sh`)
- Documentation claims in `README.md`, `SPEC.md`, `docs/*`, and this file

**Out of scope:**

- Self-hosted instances running user modifications to the image, the
  Caddy config, the PB hooks, or the Next server actions — report those to
  the operator, not upstream.
- Operator error: leaked `.env` files, reused passwords, unpatched hosts,
  firewall misconfiguration. `docs/deployment-hardening.md` is the
  checklist; failure to follow it is out of scope.
- Third-party dependencies (PocketBase, Next.js, Node, Alpine, ntfy,
  Caddy, Tailscale, shadcn/ui primitives). Report to the upstream
  project. If a HomeKeep-specific misuse of a dependency creates a
  vulnerability, that is in scope for us.
- Social-engineering, physical access, phishing of operators, and any
  attack that assumes host-OS compromise.
- Denial-of-service that requires sustained traffic above the documented
  rate-limit buckets (see `pocketbase/pb_hooks/bootstrap_ratelimits.pb.js`)
  — the per-IP buckets are designed to deter, not absorb, volumetric floods.
  Use Cloudflare / a WAF upstream if that is your threat model.
- Public-demo abuse that the demo overlay is designed to withstand
  (ephemeral tmpfs, 2h/24h reset). We want the demo to be fuzzed; if you
  find a way to escape the isolation, that IS in scope.

## Safe harbor

HomeKeep welcomes good-faith security research. If you:

- make a **good-faith effort** to avoid privacy violations, data destruction,
  and service degradation,
- stop testing and notify us as soon as you identify a vulnerability,
- do **not** access, modify, or retain more data than necessary to
  demonstrate the issue,
- do **not** publicly disclose before a coordinated release date we agree
  on together,

— then we will **not** pursue legal action against you, we will not ask
your ISP or employer to take action, and we will credit you (by name or
handle, your choice) in the changelog entry that ships the fix. The AGPL
licence of this project already guarantees you the right to study and
modify the source; this safe-harbor clause extends the same good-faith
courtesy to the runtime.

This language is modelled on the industry-standard Dropbox and GitHub
disclosure policies.

## Public advisories

No public security advisories have been issued. All findings from the
v1.2-security red-team audit (see `SPEC.md` changelog v0.5) were fixed
prior to the first public tag of the v1.2 line, so there is nothing to
advise against a shipped version yet.

| ID | Severity | Affected versions | Summary | Fixed in |
|----|----------|-------------------|---------|----------|
| — | — | — | *(none yet)* | — |

Future advisories will be published here and linked from the relevant
release's GitHub release notes. Numbered advisory pages at a dedicated
domain are deferred to v1.3.

---

*Last updated: 2026-04-24 (Phase 28, SPEC v0.5).*
