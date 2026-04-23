---
phase: 27
plan: supply-chain-hardening
subsystem: ci-build-supply-chain
tags: [supply-chain, cosign, sbom, slsa, dependabot, digest-pin, telemetry]
requirements: [SUPPLY-01, SUPPLY-02, SUPPLY-03, SUPPLY-04, SUPPLY-05, SUPPLY-06]
dependency_graph:
  requires:
    - Phase 01-02 (docker/Dockerfile, release.yml baseline)
    - Phase 07 (deferred the SHA-pin + cosign work that this phase delivers)
  provides:
    - cryptographic provenance (cosign-signed GHCR images)
    - machine-readable SBOM + SLSA-3 provenance on every release
    - immutable GitHub Action references (SHA pins + Dependabot)
    - reproducible base images (digest-pinned node + caddy)
    - MITM-resistant dev tooling (dev-pb SHA-256 verification)
    - privacy-preserving runtime (Next.js telemetry off)
  affects:
    - .github/workflows/{release,ci,edge}.yml
    - docker/Dockerfile
    - docker/docker-compose.yml
    - scripts/dev-pb.js
    - tests/unit/dev-pb-checksum.test.ts
tech_stack:
  added:
    - sigstore/cosign-installer@v3 (SHA-pinned)
    - dependabot.yml (github-actions + docker ecosystems)
    - crypto.createHash('sha256') streaming verifier in dev-pb
  patterns:
    - keyless OIDC signing (no long-lived keys)
    - BuildKit-native SBOM + provenance attestations (sbom: true, provenance: mode=max)
    - SHA-pinned action refs with `# v<semver>` comment for readability
    - Digest-pinned FROM lines via ARG NODE_DIGEST / CADDY_DIGEST
key_files:
  created:
    - .github/dependabot.yml
    - tests/unit/dev-pb-checksum.test.ts
    - .planning/phases/27-supply-chain-hardening/27-SUMMARY.md
  modified:
    - .github/workflows/release.yml
    - .github/workflows/ci.yml
    - .github/workflows/edge.yml
    - docker/Dockerfile
    - docker/docker-compose.yml
    - scripts/dev-pb.js
decisions:
  - D-01..D-03 kept: cosign keyless via GitHub OIDC, signing step right after build-push, verify docs noted inline in release.yml comment
  - D-04..D-06 kept: sbom + provenance flipped on `docker/build-push-action` in both release.yml AND edge.yml (edge images benefit from attestations too)
  - D-07 refined: current-major SHA pins, not cross-major bumps — actions/checkout stays @v6 (the repo's current major) SHA-pinned, not downgraded to v4 as the original instructions anticipated
  - D-09 kept: .github/dependabot.yml with weekly github-actions + weekly docker schedules
  - D-10 kept: NODE_DIGEST and CADDY_DIGEST declared as ARGs, applied to all three FROM stages + Caddy COPY
  - D-12 extended: dev-pb.js refactored so helpers can be unit-tested without spawning PocketBase (main() guarded by isDirectInvocation)
  - D-13/D-14 kept: NEXT_TELEMETRY_DISABLED=1 in builder stage, runtime stage, and docker-compose.yml
metrics:
  duration_minutes: 26
  tasks_completed: 6
  files_changed: 8
  test_count_before: 664
  test_count_after: 672
  completed_date: 2026-04-22
---

# Phase 27 Plan 1: Supply Chain Hardening Summary

Close six posture gaps surfaced by v1.2-security research — cryptographic
signing, SBOM, provenance, SHA-pinned actions, digest-pinned base images,
checksum-verified dev-pb, and Next.js telemetry disabled — lifting the
supply-chain grade from B- to A-.

## Deliverables

### SUPPLY-01 — Cosign keyless image signing

Commit `37c3a3b` — `.github/workflows/release.yml`.

- Added `id-token: write` to top-level `permissions:` (required for GitHub
  OIDC token, which cosign uses as the SIGSTORE_ID_TOKEN).
- Gave the `docker/build-push-action` step an `id: build` so its
  `outputs.digest` can be referenced downstream.
- New `Install cosign` step (`sigstore/cosign-installer@v3`) followed by
  `cosign sign --yes "ghcr.io/<repo>@<digest>"` — signature is bound to
  workflow identity (repo + branch + workflow name), no long-lived keys.
- Inline comment documents the `cosign verify ...` one-liner for consumers.

### SUPPLY-02 — SBOM + SLSA-3 provenance attestation

Commit `fb93b97` — `.github/workflows/release.yml` + `.github/workflows/edge.yml`.

Single flag flips on `docker/build-push-action`:

```yaml
sbom: true
provenance: mode=max
```

BuildKit emits SPDX SBOM + SLSA-3 provenance attestations attached to the
pushed manifest automatically. Applied to **both** release and edge so
that even bleeding-edge consumers have attestations. Inspect with:

```
docker buildx imagetools inspect <image> --format '{{ json .SBOM }}'
docker buildx imagetools inspect <image> --format '{{ json .Provenance }}'
```

### SUPPLY-03 — SHA-pinned GitHub Actions + Dependabot

Commit `ad64db3` — all three workflow files + `.github/dependabot.yml`.

Every `uses: <action>@v<major>` across release.yml, ci.yml, edge.yml
replaced with full 40-char commit SHA + trailing `# v<tag>` comment:

| Action                         | Pin (abbrev.) | Tag      |
| ------------------------------ | ------------- | -------- |
| actions/checkout               | de0fac2e...   | v6.0.2   |
| actions/setup-node             | a0853c24...   | v5.0.0   |
| actions/cache                  | 0057852b...   | v4.3.0   |
| docker/setup-qemu-action       | ce360397...   | v4.0.0   |
| docker/setup-buildx-action     | 4d04d5d9...   | v4.0.0   |
| docker/login-action            | 4907a6dd...   | v4.1.0   |
| docker/metadata-action         | c299e40c...   | v5.10.0  |
| docker/build-push-action       | bcafcacb...   | v7.1.0   |
| sigstore/cosign-installer      | 7e8b541e...   | v3.10.1  |

`.github/dependabot.yml` configures two ecosystems on weekly schedules:

- `github-actions` at `/` — bumps SHAs + version comments (grouped
  minor+patch so PRs don't spam)
- `docker` at `/docker` — watches Dockerfile base-image digests

Verified: `grep -E 'uses:\s+\S+@v\d+\s*$' .github/workflows/*.yml` → no
matches (no remaining floating majors).

### SUPPLY-04 — Digest-pinned Dockerfile base images

Commit `1036f90` — `docker/Dockerfile`.

- Added `ARG NODE_DIGEST=sha256:8ea2348b...` and
  `ARG CADDY_DIGEST=sha256:834468128c...` at the top of the Dockerfile
  (human-readable version stays in the existing NODE_VERSION / CADDY_VERSION
  ARGs, so `docker buildx imagetools inspect` and Dependabot can both
  reason about the pin).
- Three `FROM node:${NODE_VERSION}@${NODE_DIGEST} AS <stage>` lines
  (deps, builder, runtime).
- `COPY --from=caddy:2.11.2-alpine@sha256:834468128c7696cec...` — digest
  inlined because `COPY --from=` doesn't interpolate ARGs in the image
  reference.
- Verified end-to-end: full multi-stage build succeeds (`docker buildx
  build --platform linux/amd64 --load`), produces a 460MB image with
  `NEXT_TELEMETRY_DISABLED=1` in `docker inspect`.

Digests retrieved via `docker buildx imagetools inspect <tag>` at the
top-level manifest-index SHA (not per-arch manifest SHAs — the index SHA
is stable across both amd64 and arm64).

### SUPPLY-05 — dev-pb SHA-256 verification

Commit `1cec188` — `scripts/dev-pb.js` + `tests/unit/dev-pb-checksum.test.ts`.

Mirror the production Dockerfile pattern in the dev script:

1. After `fetch(url) → pipeline(... createWriteStream(zipPath))`, fetch
   the release's `pocketbase_<ver>_checksums.txt` from the same URL base.
2. `expectedSha256(body, zipName)` parses `<64-hex>  <filename>` lines,
   rejects SHA-1/other hash lengths, handles CRLF, lowercases output.
3. `sha256File(path)` streams the downloaded zip through
   `crypto.createHash('sha256')` and returns the hex digest.
4. Compare; on mismatch/missing-listing, delete the zip and exit 1
   **before** extracting or marking it executable.

To make the helpers unit-testable without spawning PocketBase on every
import, the script's side-effect logic was moved into an `async main()`
guarded by an `isDirectInvocation` check (`fileURLToPath(import.meta.url)
=== process.argv[1]`). Top-level now only executes when invoked as
`node scripts/dev-pb.js`.

New test file (8 cases, all green):
- `expectedSha256`: happy path, not-listed, CRLF, SHA-1-only rejection,
  case normalisation, format sanity
- `sha256File`: matches `createHash('sha256').update(...).digest('hex')`
  on a tmp fixture, and returns the well-known empty-file constant
  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

Test count: 664 → 672 (all passing).

### SUPPLY-06 — Next.js telemetry disabled

Commit `19cea50` — `docker/Dockerfile` + `docker/docker-compose.yml`.

- `ENV NEXT_TELEMETRY_DISABLED=1` added to the builder stage (so
  `next build` in CI does not phone home to telemetry.nextjs.org).
- Same ENV added to the runtime stage's existing ENV block (so the
  running container doesn't emit telemetry either).
- `docker-compose.yml` `environment:` also declares
  `NEXT_TELEMETRY_DISABLED=1` as belt-and-suspenders (a user who
  overrides the base image still gets telemetry off).

Verified via `docker inspect homekeep:supply-test` → `NEXT_TELEMETRY_DISABLED=1`
is present in the runtime image's env.

## Verification Matrix

| Check | Command | Result |
|-------|---------|--------|
| Full test suite | `npm test -- --run` | 672/672 passing |
| New unit tests | `npx vitest run tests/unit/dev-pb-checksum.test.ts` | 8/8 passing |
| Docker build (amd64) | `docker buildx build --platform linux/amd64 --load ...` | builds clean, 460MB |
| Telemetry off in image | `docker inspect ...` | `NEXT_TELEMETRY_DISABLED=1` present |
| YAML syntax | `python3 -c "import yaml; yaml.safe_load(...)"` | all 4 files parse |
| No floating majors | `grep -E 'uses:\s+\S+@v\d+\s*$' .github/workflows/*.yml` | no matches |
| Compose syntax | `docker compose config --quiet` | OK |

Release/signing/SBOM/provenance can only be fully end-to-end verified by
pushing a git tag and running the Release workflow — that will be done
on the next v1.2.x tag cut, per D-16. Documented the `cosign verify`
invocation inline in `release.yml`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] dev-pb.js top-level side effects would break import-based unit tests**

- **Found during:** SUPPLY-05 after writing the test file
- **Issue:** The original script had top-level `mkdirSync`, top-level
  `await fetch(...)`, and top-level `spawn(PB_BIN, ...)`. Importing the
  script from a vitest test would run all of that as a side effect.
- **Fix:** Moved the side-effect logic into `async function main()`
  guarded by an `isDirectInvocation` check using `fileURLToPath(import.meta.url)
  === process.argv[1]`. Only `expectedSha256`, `sha256File`, and module-
  level constants remain at the top level.
- **Files modified:** `scripts/dev-pb.js`
- **Commit:** `1cec188`

**2. [Rule 2 - Critical] SBOM + provenance added to edge.yml in addition to release.yml**

- **Found during:** SUPPLY-02
- **Issue:** The plan instruction described the change only for
  release.yml. But edge images are the ones that get deployed first on
  the VPS testing channel and are what consumers of the `:edge` tag
  pull. Omitting attestations from edge would leave the :edge channel
  unsigned-and-unattested while :latest is strict — asymmetric.
- **Fix:** Flipped `sbom: true` + `provenance: mode=max` on edge.yml's
  build-push-action step too.
- **Files modified:** `.github/workflows/edge.yml`
- **Commit:** `fb93b97`

**3. [Rule 1 - Bug] Preserved current action majors when SHA-pinning**

- **Found during:** SUPPLY-03
- **Issue:** The instructions' "latest v4 / v5 / v3" hints didn't match
  the repo's actual current state — actions/checkout was `@v6`,
  docker/login-action was `@v4`, etc. Downgrading majors during a pin
  operation would be a behaviour change, not a pinning operation.
- **Fix:** Resolved the latest patch SHA *within the current major* for
  each action. E.g., `actions/checkout@v6` → `@de0fac2e... # v6.0.2`
  (not v4.x). Behaviour identical; just immutable.
- **Files modified:** All three workflows
- **Commit:** `ad64db3`

### Auth / External Gates

None encountered. All work was local-file edits + deterministic API
lookups via `gh api` (using the existing GITHUB_PAT in `.env`) and
`docker buildx imagetools inspect` (public DockerHub).

Post-merge, the next `v*` tag push will be the real end-to-end verification
for SUPPLY-01/02 (cosign sign, SBOM attach, provenance attach). That will
show up in the Release workflow logs on GitHub Actions. No manual action
required on the user's side; all flags are declarative.

## Known Stubs

None. Every SUPPLY item is fully wired into the shipping build pipeline —
not deferred to a later phase, not placeholder-marked, not behind a feature
flag. The Dependabot PRs will flow on the next weekly cycle; the cosign
signature will appear on the next `v*` tag push.

## Self-Check: PASSED

Commits verified:
- `37c3a3b` SUPPLY-01 — FOUND (feat(27): cosign keyless image signing)
- `fb93b97` SUPPLY-02 — FOUND (feat(27): SBOM + SLSA-3 provenance attestation)
- `ad64db3` SUPPLY-03 — FOUND (fix(27): pin GitHub Actions to SHA)
- `1036f90` SUPPLY-04 — FOUND (fix(27): digest-pin Dockerfile base images)
- `1cec188` SUPPLY-05 — FOUND (feat(27): dev-pb.js verifies PB download SHA256)
- `19cea50` SUPPLY-06 — FOUND (fix(27): disable Next.js telemetry in Docker + compose)

Files verified present:
- `.github/workflows/release.yml` — FOUND
- `.github/workflows/ci.yml` — FOUND
- `.github/workflows/edge.yml` — FOUND
- `.github/dependabot.yml` — FOUND (created in SUPPLY-03)
- `docker/Dockerfile` — FOUND
- `docker/docker-compose.yml` — FOUND
- `scripts/dev-pb.js` — FOUND
- `tests/unit/dev-pb-checksum.test.ts` — FOUND (created in SUPPLY-05)
