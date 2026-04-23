# Supply Chain & Dependency Security

Scope: `package.json`, `package-lock.json` (lockfileVersion 3, 770 integrity hashes), `docker/Dockerfile`, `docker/Caddyfile`, `.github/workflows/{ci,release,edge}.yml`, `scripts/dev-pb.js`, `pocketbase/pb_migrations/`, `pocketbase/pb_hooks/`. Audit date: 2026-04-22. Sandbox prevented live `npm audit`, so vulnerability judgments are static — exact lockfile pins were verified and cross-checked against publicly-disclosed GHSA/CVE patterns known through Jan 2026.

## Executive summary

- **0 critical, 0 high** directly-attributable CVEs found in the pinned runtime dependency tree. Node.js/Next.js/React/Radix/Zod/PocketBase-JS are all on current (Q1 2026) releases.
- **5 high-severity findings** on *posture*, not dep CVEs: no cosign signatures, no SBOM, no build provenance attestation, `node:22-alpine` and `caddy:2.11.2-alpine` are tag-pinned (not digest-pinned) allowing silent rebase, Next.js telemetry is not disabled in the runtime image.
- **2 medium findings:** GitHub Actions pinned to floating majors (not SHAs); dev-only PB download in `scripts/dev-pb.js` has **no** checksum (only the production Dockerfile does).
- **Exact-pin invariant holds.** `package.json` has zero caret or tilde ranges in runtime or dev deps. The Phase 1 "strip all carets" rule survived Phases 2–21 intact.

**Overall posture grade: B-.** The fundamentals (exact pins, lockfile integrity hashes, PB checksum in prod, s6 drops root, least-priv workflow permissions) are solid. The gap is artifact-level assurance: a consumer pulling `ghcr.io/conroyke56/homekeep:latest` today cannot verify signature, provenance, or SBOM. Phase 7's deferred "cosign + SHA-pin actions" work remains unfunded.

## npm dependency audit

All direct deps in `package.json` are exact-pinned (no `^`/`~`). Lockfile carries 770 `integrity:` lines (SHA-512 subresource hashes), so install-time tamper is detectable.

Manual review against the GHSA database for Jan 2026:

| Package | Version | Severity | CVE / GHSA | Fix available |
|---|---|---|---|---|
| next | 16.2.4 | None found | — | — (current stable line) |
| react / react-dom | 19.2.5 | None found | — | — |
| pocketbase (JS SDK) | 0.26.8 | None found | — | — |
| zod | 4.1.0 | None found | — | — |
| jsdom (dev) | 29.0.2 | None found | — | — |
| node-cron | 3.0.3 | Info | No known CVE but 3.0.3 is end-of-v3; v4 is maintained line | Optional upgrade to 4.x |
| @serwist/next | 9.2.1 | None found | — | — |
| radix-ui | 1.4.3 | None found | — | — |
| lucide-react | 1.8.0 | None found | — | — |
| concurrently (dev) | 9.2.1 | None found | — | — |
| eslint (dev) | 9.39.4 | None found | — | — |
| typescript (dev) | 6.0.3 | None found | — | — |

Transitive risk surface (spot-checks from `package-lock.json`):

- No `lodash`, `axios`, `jsonwebtoken`, `request`, `moment`, `ws<8` at top level or in obvious transitive positions — all historically-noisy CVE carriers absent.
- No typosquat-shaped names (e.g. `react-dom2`, `poket-base`) in direct deps.
- `registry.npmjs.org` is the sole resolver host (grepped; no GitHub-URL deps, no tarball deps, no `file:` deps).
- `postinstall`/`preinstall` lifecycle scripts appear in transitive deps: `esbuild`, `msw` (dev-only), `napi-postinstall`, `sharp`, `unrs-resolver`. `sharp` and `esbuild` are well-known native-binary packages from reputable maintainers; `unrs-resolver` and `napi-postinstall` are legitimate (rspack ecosystem) but increase the native-binary surface. Recommend monitoring.

## Base image CVEs

| Image | Version | Pinning | Risk | Action |
|---|---|---|---|---|
| `node:22-alpine` | Floating minor (`22-alpine`) | Tag, no digest | Medium — silent rebase on every rebuild; Alpine minor drifts (3.20→3.21 has shipped Alpine-sec-advisories updates for `busybox`, `openssl`, `libcrypto`). A rebuild next month is not bit-identical. | Pin to `node:22.14.0-alpine3.21@sha256:…` in release.yml + Dockerfile |
| `caddy:2.11.2-alpine` | Patch-pinned, no digest | Tag, no digest | Medium — Docker Hub retains official image tags, but mutable tag = rebase surface. Phase 01-02 SUMMARY explicitly flagged this: *"Mitigation path: pin by digest … in 01-06 or vendor."* Not done. | Replace with `caddy:2.11.2-alpine@sha256:…` digest |
| `s6-overlay` noarch + per-arch | `3.2.2.0`, GitHub release | Version + SHA256 verified against upstream `.sha256` file | Low — tarball integrity is checked via `sha256sum -c` in Dockerfile lines 46, 61 | None |
| `pocketbase` | `0.37.1`, GitHub release | Version + SHA256 verified against upstream `checksums.txt` | Low — Dockerfile line 80 `grep " ${PB_ZIP}\$" pb-checksums.txt \| sha256sum -c -` is correct | None |
| Alpine base (inherited from `node:22-alpine`) | Currently 3.21.x as of Q1 2026 | Inherited | Medium — patch level bound to `node:22-alpine` rebuild cadence; project has no automated rebuild-on-base-update schedule | Add monthly rebuild workflow or base-image watcher |

## GitHub Actions pin status

| Action | Ref used | Pin level | Risk |
|---|---|---|---|
| `actions/checkout` | `@v6` | Floating major | Medium — tag-poisoning surface; attacker who compromises the action repo can push new `v6` tag |
| `actions/setup-node` | `@v5` | Floating major | Medium — same as above |
| `actions/cache` | `@v4` | Floating major | Medium |
| `docker/setup-buildx-action` | `@v4` | Floating major | Medium |
| `docker/setup-qemu-action` | `@v4` | Floating major | Medium |
| `docker/login-action` | `@v4` | Floating major | Medium |
| `docker/metadata-action` | `@v5` | Floating major | Medium |
| `docker/build-push-action` | `@v7` | Floating major | Medium |

Phase 1 decision log (01-06) explicitly deferred SHA-pinning and cosign to Phase 7. **Phase 7 did not ship this work** — `07-pwa-release/` focused on service-worker / PWA; `.github/workflows/*.yml` show no SHA-pinned `uses:` anywhere, no cosign step, no provenance step. The deferred item is still open.

**Workflow permissions** (positive findings):
- `ci.yml`: `permissions: contents: read` — least-priv, correct.
- `release.yml`: `contents: read`, `packages: write` — scoped tight.
- `edge.yml`: `contents: read`, `packages: write` — same.
- Top-level `permissions:` block on every workflow (no job-level broader grants) — good.
- `concurrency:` group on all three — prevents overlapping runs.
- CI uses `on: pull_request` (not `pull_request_target`) — correct, PR code runs **without** secrets. Confirmed no `secrets.*` references in `ci.yml`.

## SBOM readiness

**Today: no SBOM is produced.** Nothing in `release.yml` or `edge.yml` generates or uploads an SPDX/CycloneDX bill-of-materials. Consumers cannot machine-answer "does this image include package X at version Y?" without pulling the image and introspecting.

What would need to be added:
- `docker/build-push-action@v7` supports `provenance: true` and `sbom: true` inputs natively (adds BuildKit-generated SBOM as an OCI attestation). Single-line change per workflow.
- Alternatively: `anchore/sbom-action` or `aquasecurity/trivy-action` step after build, output attached as release asset.

The Dockerfile COPIES a known-version PB binary, uses a pinned Caddy, and npm lockfile is exact — so SBOM content would be high-fidelity once emitted.

## Image signing (cosign)

**Not signed.** Zero `cosign` references across the entire repo (`.github/`, `docker/`, `scripts/`). Released images at `ghcr.io/conroyke56/homekeep:*` have no signature, no attestation, no provenance record.

Minimum viable addition (one job after `build-and-push` in `release.yml`):
```yaml
- uses: sigstore/cosign-installer@v3
- run: cosign sign --yes ghcr.io/${{ github.repository }}@${{ steps.build.outputs.digest }}
```
…with `id-token: write` permission added. Keyless OIDC-backed signing, no long-lived keys.

## Pinned-version drift analysis

`package.json` was verified line-by-line for caret/tilde ranges — **zero found** in all 28 runtime deps and 18 dev deps (see `grep (\"\\^|~[0-9])` = no matches against `package.json`). The Phase 1 invariant is intact.

Drift surfaces that remain:

1. **Base image floating tags** (`node:22-alpine`, `caddy:2.11.2-alpine`) — covered above.
2. **GitHub Actions floating majors** — covered above.
3. **`HK_BUILD_ID`** — Dockerfile ARG is injected from `${{ github.sha }}` in release.yml, so it is *derived from source*, not wall-clock — good for reproducibility. Default `hk-dev-local` is a dev-only sentinel.
4. **BuildKit cache (`type=gha`)** — GitHub-hosted cache is mutable but does not change build outputs (cache misses re-fetch; cache hits are content-addressed).
5. **No explicit `SOURCE_DATE_EPOCH` / rebuild-reproducibility flags** — image layer timestamps are wall-clock. A rebuild from the same git SHA + same base-image-digest would produce *identical content* but different layer metadata (timestamps, order nondeterminism in `apk add` + `npm ci` mtimes).

## Findings (severity-ordered)

### HIGH

**H1. Released images are unsigned and carry no attestation.**
- Location: `.github/workflows/release.yml`, `.github/workflows/edge.yml`
- Evidence: no `cosign` step, no `provenance:` or `sbom:` inputs on `docker/build-push-action@v7`.
- Impact: Consumers pulling `ghcr.io/conroyke56/homekeep:latest` have no cryptographic proof the image was built by this repo. A compromised GHCR token or compromised GHCR mirror could swap in a malicious image. Downstream `docker pull` has no verification surface.
- Fix: Add `sigstore/cosign-installer@v3` + `cosign sign --yes …@${digest}` step; enable `provenance: true, sbom: true` on `build-push-action`; add `permissions: id-token: write`.

**H2. No SBOM is published.**
- Location: same workflows.
- Evidence: `docker inspect` on a released image would return no `application/vnd.cyclonedx+json` or SPDX attestation.
- Impact: Operators cannot respond to "is our Homekeep vulnerable to $CVE_X" without full image introspection. Regulators increasingly demand SBOMs (EO 14028, EU CRA draft).
- Fix: Flip `sbom: true` on `docker/build-push-action@v7` — BuildKit writes SPDX as OCI attestation.

**H3. Base images pinned by mutable tag, not digest.**
- Location: `docker/Dockerfile` lines 3, 17, 25, 34 (`FROM node:22-alpine`); line 66 (`COPY --from=caddy:2.11.2-alpine`).
- Evidence: no `@sha256:` digest pin; 01-02 SUMMARY explicitly notes the concern.
- Impact: Silent rebase — a rebuild today vs three months ago produces different Alpine patch levels with different CVE surface. Build is not reproducible across time.
- Fix: Replace with `node:22-alpine@sha256:…` and `caddy:2.11.2-alpine@sha256:…`; add renovate/dependabot Dockerfile rule for auto-bump.

**H4. GitHub Actions are pinned to floating majors.**
- Location: all three workflows.
- Evidence: every `uses:` is `@v4`/`@v5`/`@v6`/`@v7`, none SHA-pinned.
- Impact: Action-repo compromise (see `tj-actions/changed-files` incident 2025) propagates immediately. Carry-forward item from Phase 1 decision log.
- Fix: Pin to commit SHA with comment noting the tag, e.g. `uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v6.0.0`. Dependabot groups can keep them fresh.

**H5. Next.js telemetry is not disabled.**
- Location: `docker/Dockerfile` (no `NEXT_TELEMETRY_DISABLED=1`), `docker/s6-rc.d/nextjs/run`, `next.config.ts`.
- Evidence: grep confirms the env var is set nowhere; only reads appear in the bundled `next/dist/telemetry/storage.js`. Self-hosted users silently phone home to `telemetry.nextjs.org` on `next build` and on first run.
- Impact: Small PII leakage (anonymized project id, Next.js version). Violates the self-hosted-first, privacy-oriented posture implicit in AGPL + PocketBase stack.
- Fix: Add `ENV NEXT_TELEMETRY_DISABLED=1` to Dockerfile runtime stage (and builder, so `next build` doesn't phone home from CI).

### MEDIUM

**M1. `scripts/dev-pb.js` downloads PocketBase without checksum verification.**
- Location: `scripts/dev-pb.js:29-47`, `ci.yml:46-56` (CI repeats the same shape).
- Evidence: `fetch(url)` → stream → `unzip`; no sha256 check. Contrast with `docker/Dockerfile:78-83` which correctly verifies the release `checksums.txt` in prod.
- Impact: Developer laptops and CI runners trust GitHub release CDN implicitly. A MITM (unlikely over TLS) or compromised GitHub release asset (mid-likelihood) would drop an unverified binary. Not prod-facing, but the dev binary is executed locally with network access and full FS write to `.pb/pb_data/`.
- Fix: Fetch `checksums.txt` alongside the zip and compare SHA-256 before `unzip` — mirror the Dockerfile pattern.

**M2. Alpine base inherits unpatched CVEs between rebuilds.**
- Location: `node:22-alpine` layer.
- Evidence: no scheduled rebuild workflow; `.github/workflows/` has no `schedule:` cron trigger.
- Impact: Between releases, newly-disclosed Alpine package CVEs (openssl/busybox/zlib) remain in shipping images until next `v*` tag push.
- Fix: Add a weekly `workflow_dispatch` + `schedule: cron` that rebuilds `:edge` (already auto-on-push) and, optionally, auto-patches the latest stable tag.

**M3. `docker/build-push-action` uses GHA cache mutably.**
- Location: `release.yml:67-68`, `edge.yml:52-53`.
- Evidence: `cache-from: type=gha` / `cache-to: type=gha,mode=max` — mutable across runs.
- Impact: Low — cache content is content-addressed, so poisoning is hard, but the cache layer graph is cross-branch shared. Not an active exploit vector.
- Fix: Scope cache per ref (`scope: ${{ github.ref_name }}`) or accept current behavior.

### LOW

**L1. `HK_BUILD_ID` is embedded as an OCI label and env var — supply-chain hygiene, not a vulnerability.**
- Location: Dockerfile lines 109, 113-115.
- Evidence: Good — build fingerprint surfaces via `docker inspect` and runtime `HOMEKEEP_BUILD`. This is positive; flagged only so future phases know it works.

**L2. `pb_hooks` JS files execute with `$app` superadmin context.**
- Location: `pocketbase/pb_hooks/*.pb.js` (5 files).
- Evidence: `bootstrap_batch.pb.js` mutates `$app.settings()` and saves. All hooks are first-party; no third-party JS loaded into PB hook runtime.
- Impact: None today. But any future plugin model that loads hook code from elsewhere would sit in a privileged blast radius.
- Fix: Keep current rule that hooks are first-party only; document in CONTRIBUTING.

### INFO

**I1. Zero `eval()` / `new Function()` / `execSync` usage in application code.**
- Location: grepped `app/`, `lib/`, `components/`, `pocketbase/` — clean.
- `execSync` appears only in `scripts/dev-pb.js` (dev tooling, covered in M1), not in any runtime path.

**I2. No shell-string concatenation into commands in runtime code.**
- Location: Dockerfile uses shell variables safely (`${PB_ZIP}` is from ARG and URL-derived, not user input); s6 `run` scripts hardcode the exec line. No Node-side `exec(userInput)` patterns.

**I3. Lockfile integrity hashes present for all 770 resolved entries.**
- Location: `package-lock.json` (v3).
- Evidence: every `"resolved":` line has a companion `"integrity":` SHA-512. `npm ci --no-audit --no-fund` in Dockerfile honors these.

**I4. `.env` is gitignored and CI asserts this invariant.**
- Location: `ci.yml:94-100` runs `git ls-files | grep -E '^\.env$'` and fails the build if the file is tracked. Good.

**I5. `pull_request` (not `pull_request_target`) gate on CI.**
- Location: `ci.yml:3-6`.
- Evidence: PRs from forks run in the untrusted context *without* repo secrets. `secrets.*` is referenced nowhere in `ci.yml`. Correct posture.

## Next steps (prioritized for v1.2 hardening)

1. **(Week 1, ~0.5 day)** Flip `provenance: true` + `sbom: true` on `docker/build-push-action@v7` in both `release.yml` and `edge.yml`. Zero-risk change; immediate consumer value.
2. **(Week 1, ~1 day)** Add cosign keyless signing step after build. Adds `id-token: write` permission. Publish verification instructions in README.
3. **(Week 2, ~0.5 day)** SHA-pin all GitHub Actions. Generate with `pin-github-action` CLI. Add Dependabot config grouping updates.
4. **(Week 2, ~0.5 day)** Digest-pin `node:22-alpine` and `caddy:2.11.2-alpine` in Dockerfile. Add a comment with the human-readable tag.
5. **(Week 3, ~1 hour)** Set `ENV NEXT_TELEMETRY_DISABLED=1` in both builder and runtime stages of the Dockerfile.
6. **(Week 3, ~1 hour)** Add sha256 check to `scripts/dev-pb.js` (port the Dockerfile logic).
7. **(Week 4, stretch)** Weekly `schedule:` trigger in `edge.yml` to refresh Alpine base patches. Optional Trivy/Grype scan step that uploads SARIF to GitHub Code Scanning.

Delivering steps 1-5 moves the posture grade from **B-** to **A-**: signed, attested, reproducible images with no dep CVEs and a verifiable provenance chain back to the GitHub repo.
