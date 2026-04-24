# Phase 27: Supply Chain Hardening — Context

**Gathered:** 2026-04-23
**Status:** Ready for planning
**Mode:** Autonomous

<domain>
## Phase Boundary

Close the supply-chain gaps surfaced by research: no cosign signing, no SBOM, no provenance, floating-major GitHub Actions, tag-pinned base images, unverified dev-pb download, Next.js telemetry on by default.

**In scope (6 REQ-IDs):**
- SUPPLY-01 Cosign keyless image signing via `release.yml`
- SUPPLY-02 SBOM (SPDX or CycloneDX) + SLSA-3 provenance attestation
- SUPPLY-03 GitHub Actions SHA-pinned (not `@v4`); Dependabot config for SHA auto-bumps
- SUPPLY-04 Dockerfile base images digest-pinned (`FROM node:22-alpine@sha256:...`)
- SUPPLY-05 `scripts/dev-pb.js` verifies PB download via SHA256 checksum (matches production Dockerfile pattern)
- SUPPLY-06 `NEXT_TELEMETRY_DISABLED=1` set in Dockerfile + compose

**Out of scope:**
- Per-dep SBOM for npm tree (too noisy; deferred to v1.3)
- Custom Docker registry (stay on GHCR)

**Deliverables:**
1. Updated `.github/workflows/release.yml` with cosign sign step + SBOM + provenance
2. Updated `.github/workflows/*.yml` — all `uses:` lines pinned to SHA
3. `.github/dependabot.yml` configured for SHA auto-bumps on github-actions ecosystem
4. Updated `docker/Dockerfile` with `FROM node:22-alpine@sha256:<digest>` + `FROM caddy:2.11.2-alpine@sha256:<digest>`
5. Updated `scripts/dev-pb.js` with SHA256 verification
6. Dockerfile + docker-compose.yml set `NEXT_TELEMETRY_DISABLED=1`
</domain>

<decisions>
## Implementation Decisions

### SUPPLY-01: Cosign keyless signing

- **D-01 (keyless via GitHub OIDC):** Use `cosign sign --yes` with `SIGSTORE_ID_TOKEN` from the GitHub OIDC provider. No long-lived cosign keys to manage; the signature is bound to the workflow identity (repo + branch + workflow).
- **D-02 (release.yml step):** After build-and-push, add a `cosign sign` step that signs the just-pushed image digest. Requires `id-token: write` permission.
- **D-03 (verification doc):** `cosign verify ghcr.io/the-kizz/homekeep:v1.2.0 --certificate-identity-regexp "^https://github.com/the-kizz/homekeep/.github/workflows/release.yml@.+" --certificate-oidc-issuer https://token.actions.githubusercontent.com` — document in SECURITY.md.

### SUPPLY-02: SBOM + provenance

- **D-04 (SBOM via build-push-action):** `docker/build-push-action@v5+` supports `sbom: true` which emits SPDX JSON attached to the image. Single flag flip.
- **D-05 (provenance):** same action supports `provenance: mode=max` for SLSA-3 attestation. Single flag flip.
- **D-06 (verification):** SBOM viewable via `docker buildx imagetools inspect <image> --format '{{ .SBOM.SPDX }}'`. Documented in SECURITY.md.

### SUPPLY-03: SHA-pinned actions

- **D-07 (scope):** every `uses:` in `.github/workflows/*.yml` → pinned to full 40-char SHA instead of `@v4` / `@v5` etc.
- **D-08 (tool):** use `pin-github-action` or manually grep + update. Record the version alongside: `uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2` so humans can still see the semantic version.
- **D-09 (Dependabot config):** `.github/dependabot.yml` with `package-ecosystem: github-actions` + update schedule weekly. Dependabot will open PRs that bump SHA + version comment.

### SUPPLY-04: Digest-pinned base images

- **D-10 (Dockerfile FROM lines):** `FROM node:22-alpine@sha256:<digest>` + `FROM caddy:2.11.2-alpine@sha256:<digest>`. Get current digests via `docker buildx imagetools inspect <tag>` or GHCR/DockerHub API.
- **D-11 (Dependabot docker):** add `package-ecosystem: docker` to dependabot.yml.

### SUPPLY-05: dev-pb checksum

- **D-12 (implementation):** In `scripts/dev-pb.js`, after downloading the zip, compute SHA256 and compare against a hardcoded expected value per platform/arch combination. PB releases include `pocketbase_*_checksums.txt` — fetch that too and parse.

### SUPPLY-06: Telemetry off

- **D-13 (Dockerfile ENV):** `ENV NEXT_TELEMETRY_DISABLED=1` — set in builder stage AND runtime stage so both build + runtime don't phone home.
- **D-14 (docker-compose.yml):** add `NEXT_TELEMETRY_DISABLED=1` to default environment for belt+suspenders.

### Test scope

- **D-15 (~3 unit tests, mostly doc/config):**
  - Dev-pb checksum helper unit test (SUPPLY-05)
  - Workflow config validation (actionlint in CI — grep-based "no floating majors")
  - Smoke: `docker build` still succeeds with digest-pinned bases (CI covers)
- **D-16 (release verification post-merge):** `cosign verify` on next tag push → signature validates.

### Risk
- **SUPPLY-03 risk:** SHA pinning is tedious; a typo = broken workflow. Use a tool; double-check after.
- **SUPPLY-04 risk:** digest drift — every `node:22-alpine` patch release has a new digest. Dependabot handles via scheduled PRs.

### Claude's Discretion
- Whether to add `.github/CODEOWNERS` to require review on supply-chain-affecting PRs (workflows, Dockerfile). Defer.
- Whether to add trivy/grype scan step in CI — good idea, defer to v1.3.
</decisions>

<canonical_refs>
- `.planning/v1.2-security/research/supply-chain.md` — the research report
- `.github/workflows/release.yml` + `ci.yml` + `edge.yml`
- `docker/Dockerfile`
- `scripts/dev-pb.js`
- `package.json` — NEXT_TELEMETRY_DISABLED may already be in scripts; check
</canonical_refs>

<deferred>
- Trivy/grype scan step (v1.3)
- npm SBOM (v1.3)
- CODEOWNERS (v1.3)
</deferred>

---

*Phase: 27-supply-chain-hardening*
