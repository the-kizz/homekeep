---
phase: 01-scaffold-infrastructure
plan: 06
subsystem: infra
tags: [github-actions, ci, ghcr, docker-buildx, qemu, multi-arch, release]

requires:
  - phase: 01-01
    provides: "package.json scripts (lint, typecheck, test, build, test:e2e), ESLint+Vitest+Playwright configs, .gitignore for .env — ci.yml consumes all of these"
  - phase: 01-02
    provides: "docker/Dockerfile (three-stage multi-arch), scripts/check-image-size.sh, scripts/check-multiarch.sh — both workflows consume these artifacts"
  - phase: 01-03
    provides: "docker/s6-rc.d/ service tree — required for full docker build to succeed (COPY targets in Dockerfile runtime stage)"
  - phase: 01-04
    provides: "docker/Caddyfile — required for full docker build to succeed (COPY target in Dockerfile runtime stage)"
provides:
  - ".github/workflows/ci.yml — PR + main-push validation pipeline (lint/typecheck/test/playwright/build/e2e + amd64 docker build + 300MB size check + arm64 cross-build validation + NEXT_PUBLIC_ regression grep + .env gitignore grep)"
  - ".github/workflows/release.yml — v* tag -> multi-arch GHCR publish (amd64+arm64) with QEMU/buildx, metadata-action semver tags, gha layer cache, explicit build-args, post-push manifest verification"
  - "CI guard for Pitfall #3 (NEXT_PUBLIC_* never appears in built .next bundle) on every PR"
  - "CI guard for INFR-03 (image <= 300MB) on every PR via scripts/check-image-size.sh"
  - "CI guard for Phase-1 success criterion #4 (Dockerfile builds linux/arm64) on every PR without waiting for a v* tag"
  - "Release guard for INFR-02 (published manifest contains both linux/amd64 AND linux/arm64) via scripts/check-multiarch.sh"
affects: [01-07, phase-7-compose-variants, phase-7-ops-hardening]

tech-stack:
  added:
    - github-actions (actions/checkout@v6, actions/setup-node@v5)
    - docker/setup-qemu-action@v4
    - docker/setup-buildx-action@v4
    - docker/login-action@v4
    - docker/metadata-action@v5
    - docker/build-push-action@v7
    - ghcr.io as container registry
  patterns:
    - "Two-workflow CI/CD split: ci.yml is read-only + runs on PR/main (no registry push); release.yml is packages:write + runs only on v* tag (supply-chain isolation — PRs cannot publish)"
    - "Single-platform --load for size/regression inspection + separate multi-platform --output type=image,push=false for cross-arch validation (buildx cannot --load multi-platform images into the local daemon)"
    - "All GitHub Actions pinned to major versions (@v4/@v5/@v6/@v7) — no @master or @latest floating refs (supply-chain guard, accepted-risk for phase 1; SHA pinning deferred to phase 7 per threat model)"
    - "GitHub Actions cache (type=gha, mode=max) for multi-arch QEMU rebuilds (Pitfall #6 mitigation)"
    - "Post-push manifest verification as a separate workflow step (INFR-02 enforcement cannot rely on docker/build-push-action's own exit code alone)"

key-files:
  created:
    - .github/workflows/ci.yml
    - .github/workflows/release.yml
  modified: []

key-decisions:
  - "arm64 cross-build runs on every PR via type=image,push=false (not just on tag push). Phase-1 success criterion #4 (Dockerfile cross-compiles) was otherwise unverifiable until the first release — now it's a PR gate. Accepts ~5min of QEMU overhead per PR in exchange for catching arm64 regressions at review time instead of at tag time"
  - "ci.yml holds contents:read only (no packages:write). Release workflow is the only writer, and only on v* tags. Closes threat T-01-06-01 (malicious PR cannot exfiltrate GHCR write access)"
  - "Release workflow timeout-minutes: 60 per Pitfall #6 (QEMU arm64 can run slow; this stack has no native modules so 60 min is comfortable)"
  - "No cosign / OIDC signing in phase 1 — explicitly deferred to phase 7 per RESEARCH.md §Security Domain"
  - "D-10 branch protection is user_setup (documented in frontmatter + Next Phase Readiness) — not configurable from plan execution since gh CLI is absent on this host and branch-protection API requires an authenticated admin token. 01-07 README will repeat the checklist for operators"

patterns-established:
  - "Two-workflow CI/CD split with strict permissions boundary: PR-triggered CI is read-only, tag-triggered release is the sole writer"
  - "Cross-architecture validation on every PR: amd64 --load for runtime inspection + arm64 type=image,push=false for Dockerfile portability, with a prominent # NOTE: --load requires single-platform comment explaining the split"
  - "Actions pinned to major versions with a threat-model entry explicitly accepting upstream-tag-hijack risk for phase 1; phase 7 hardening target (SHA pinning + cosign)"

requirements-completed:
  - INFR-02

duration: 2min
completed: 2026-04-20
---

# Phase 01 Plan 01-06: CI + Release Workflows Summary

**Two-workflow CI/CD split for HomeKeep: ci.yml runs lint/test/build + amd64 docker build (--load, size-check, NEXT_PUBLIC_ regression grep) + arm64 QEMU cross-build validation on every PR; release.yml runs on v* tags and publishes a linux/amd64+linux/arm64 manifest to GHCR with gha layer cache, metadata-action semver tags, explicit build-args, and post-push multi-arch verification.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-20T21:59:09Z
- **Completed:** 2026-04-20T22:00:27Z
- **Tasks:** 2
- **Files created:** 2
- **Files modified:** 0

## Accomplishments

- `.github/workflows/ci.yml` (81 lines): full Phase-1 validation pipeline on every PR + push to main. Node 22 + npm cache; install -> lint -> typecheck -> test -> playwright install -> build -> e2e -> buildx setup -> amd64 docker build (--load, single-platform) -> 300MB image-size check (INFR-03) -> arm64 cross-build validation (type=image,push=false, Phase-1 success criterion #4) -> Pitfall #3 regression grep for `NEXT_PUBLIC_*` inside built image at `/app/.next` -> `.env` gitignore regression grep.
- `.github/workflows/release.yml` (62 lines): tag-triggered (`v*`) multi-arch publish. QEMU + Buildx setup; GHCR login via `GITHUB_TOKEN`; metadata-action computes three tag variants (`{{version}}`, `{{major}}.{{minor}}`, `latest` on default branch); build-push-action builds `linux/amd64,linux/arm64` with gha cache and explicit `PB_VERSION=0.37.1` + `S6_OVERLAY_VERSION=3.2.2.0` build-args; post-push `scripts/check-multiarch.sh` verifies both architectures in the pushed manifest (INFR-02 gate).
- Permissions matrix: ci.yml is `contents: read` only (T-01-06-01 mitigated — PRs cannot acquire packages:write). release.yml holds `contents: read + packages: write` (GHCR only, no other scope).
- All actions pinned to major versions (@v4/@v5/@v6/@v7). Grep for `@(master|latest)` returns empty in both files.
- Both workflows pass `python3 -c "import yaml; yaml.safe_load(open(...))"` — syntactically valid YAML.
- All 29 Task-1 + all 25 Task-2 acceptance criteria green (54 total). All 6 plan-level `<verification>` static gates green.
- `# NOTE: --load requires single-platform; see release.yml for multi-arch GHCR push` comment explicitly documents why amd64 uses --load and arm64 uses --output type=image,push=false.

## Task Commits

Each task was committed atomically on `master`:

1. **Task 1: Write .github/workflows/ci.yml** — `821b7a5` (feat)
2. **Task 2: Write .github/workflows/release.yml** — `0647829` (feat)

_No TDD in this plan; both tasks are config deliverables validated by static grep + YAML parse._

## Files Created/Modified

- `.github/workflows/ci.yml` — 81 lines; PR and main-push pipeline. Trigger: `pull_request` + `push.branches: [main]`. Permissions: `contents: read`. Concurrency group cancels superseded runs. Single job `lint-test-build` on `ubuntu-latest` with `timeout-minutes: 25`.
- `.github/workflows/release.yml` — 62 lines; tag-triggered pipeline. Trigger: `push.tags: ['v*']`. Permissions: `contents: read + packages: write`. Concurrency group does NOT cancel (releases must complete). Single job `build-and-push` on `ubuntu-latest` with `timeout-minutes: 60`.

## Decisions Made

- **arm64 cross-build on every PR (not just at tag push).** Rationale: the plan's `must_haves.truths` includes "CI job runs an arm64 QEMU validation build on every PR to prove the Dockerfile builds cross-arch without waiting for a v* tag (satisfies Phase-1 success criterion #4)". This is slower (~5 min QEMU overhead) but catches arm64 regressions at review time rather than at the first release tag. `type=image,push=false` is used because buildx cannot `--load` multi-platform images into the local daemon — only the amd64 single-platform build uses `--load` (needed for the size check and `docker run` regression grep against the built image).
- **Strict permissions boundary.** ci.yml gets `contents: read` only; release.yml is the sole `packages: write` workflow. This closes T-01-06-01 (malicious PR cannot publish to GHCR) at the workflow definition level — not just via branch protection.
- **No OIDC / cosign signing in phase 1.** Per RESEARCH.md §Security Domain ("Consider cosign signing for phase 7; not required for phase 1"). Deferred to phase 7 hardening alongside SHA pinning.
- **`scripts/check-image-size.sh` invoked in ci.yml against `homekeep:ci` tag.** The script's first-arg-default is `homekeep:test`; ci.yml passes `homekeep:ci` explicitly as per plan `<must_haves.key_links>`. 01-02's script correctly accepts a CLI arg.
- **`scripts/check-multiarch.sh` invoked in release.yml against `${{ github.ref_name }}` tag.** `github.ref_name` resolves to the git tag name (e.g. `v1.0.0`). This verifies the *just-pushed* tag's manifest — not `:latest`, which might race with other in-flight pushes.

## Deviations from Plan

None — plan executed exactly as written. Both task `<action>` blocks contained byte-accurate YAML; writing them verbatim produced files that passed all acceptance criteria on the first attempt.

## Issues Encountered

None. Python 3 + PyYAML are present on the execution host (`python3 -c "import yaml"` passed), so the optional YAML-validity gate was exercised and both files parsed cleanly. No acceptance criterion had to be skipped.

## User Setup Required

**External service configuration required for the workflows to function end-to-end.** Documented in plan frontmatter `user_setup:` and summarized here for operator convenience. Also re-documented in 01-07 README.

### GitHub repository configuration (one-time, by repo admin)

1. **Enable "Read and write permissions" for Actions workflows.**
   Location: GitHub Settings → Actions → General → Workflow permissions.
   Why: release.yml needs `packages: write` on `GITHUB_TOKEN` to push to GHCR. Defaults vary by repo/org; this toggle guarantees the grant.

2. **Configure branch protection on `main` (D-10, INFR-12).**
   Location: GitHub Settings → Branches → Add rule → Branch name pattern `main`.
   Required settings:
   - `Require a pull request before merging` (checked)
   - `Require status checks to pass before merging` (checked) → add required check `lint-test-build`
   - `Require branches to be up to date before merging` (recommended)
   - `Do not allow bypassing the above settings` (recommended for public repo)

3. **Make GHCR package public after first release (D-09).**
   Location: GitHub → your profile or org → Packages → `homekeep` → Package settings → Danger Zone → Change visibility → Public.
   Why: D-09 commits to a public image so anyone can `docker pull ghcr.io/<owner>/homekeep:latest` without auth. GHCR defaults new packages to private; this flips it once after `v0.1.0` first publishes.

### Why this isn't automated in the plan

- `gh` CLI is not installed on the execution host (see 01-RESEARCH §Environment Availability: `gh — Not required`), and even if it were, branch-protection configuration requires an admin personal-access-token — something that cannot be introduced safely from an executor context.
- GHCR visibility toggle is a one-click web-UI action, not scriptable via `GITHUB_TOKEN` (requires admin PAT with `admin:packages` scope).
- Workflow-permission toggle is repo-level admin surface, same story.

01-07 README will include the same checklist so operators cloning the repo have a single authoritative source for the manual step list.

## Threat Surface Scan

No new threat surface beyond what `<threat_model>` covered. Seven register entries, dispositions honoured:

- **T-01-06-01 (Elevation — malicious PR -> GHCR write):** MITIGATED. ci.yml explicitly declares `permissions: contents: read`; no `packages: write` anywhere in ci.yml. GitHub's default permission scope is also narrowed by the explicit block.
- **T-01-06-02 (Tampering — upstream tag hijack):** ACCEPTED for phase 1. Actions pinned to major versions (@v4/@v5/@v6/@v7) per convention. SHA pinning is phase-7 hardening target.
- **T-01-06-03 (Info Disclosure — NEXT_PUBLIC_ in bundle):** MITIGATED. ci.yml step `Regression check - no NEXT_PUBLIC_ baked into client bundle` runs `docker run --rm --entrypoint sh homekeep:ci -c 'grep -rIE NEXT_PUBLIC_ /app/.next'` and fails the workflow if anything matches.
- **T-01-06-04 (Info Disclosure — .env committed):** MITIGATED. ci.yml step `Regression check - .env is gitignored` runs `git ls-files | grep -E '^\.env$'` and fails if `.env` appears tracked.
- **T-01-06-05 (DoS — QEMU arm64 timeout):** ACCEPTED with mitigation. `timeout-minutes: 60` caps release.yml damage; Pitfall #6 fallback to amd64-only documented if QEMU proves chronically broken (phase 1 stack has no native modules so this shouldn't happen).
- **T-01-06-06 (Tampering — manifest missing arch):** MITIGATED. release.yml final step `sh scripts/check-multiarch.sh ghcr.io/${{ github.repository }}:${{ github.ref_name }}` fails the release if manifest lacks either linux/amd64 or linux/arm64.
- **T-01-06-07 (Info Disclosure — image oversize):** MITIGATED. ci.yml step `Image size check (<300MB per INFR-03)` runs `sh scripts/check-image-size.sh homekeep:ci` on every PR; a PR cannot merge without this passing, and release cannot be cut without a passing PR.

No new network endpoints, auth paths, or file-system surfaces introduced. Workflows operate on existing docker/Dockerfile + scripts/ artifacts only.

## Known Flakiness Patterns to Watch (for early CI runs)

These are plausible failure modes to recognise and triage quickly on the first PR + first tag push:

1. **`docker/setup-buildx-action` sometimes fails to start the BuildKit container on congested runners.** Retry the job; rarely permanent. If persistent, pin buildx driver to `docker` (loses multi-platform but keeps amd64 CI green as a fallback).
2. **`npx playwright install --with-deps chromium` can stall on apt mirror slowness.** The Playwright team publishes `mcr.microsoft.com/playwright:...` base images that pre-bundle browsers — a fallback if this becomes chronic is switching the CI job to `container:` mode using that image.
3. **`cache-from: type=gha` misses on first run of a workflow.** Expected; first build will be slow (~15 min arm64 QEMU uncached), subsequent builds will reuse layers (~2-5 min). Do not chase the first-run timing.
4. **`type=raw,value=latest,enable={{is_default_branch}}` only emits `latest` when the tag points at the default branch commit.** If someone tags a non-main commit, the `latest` tag will not be published and `scripts/check-multiarch.sh ...:${{ github.ref_name }}` still works because it uses the tag name, not `latest`. This is correct behaviour.
5. **First-time GHCR push may 403 if "Workflow permissions" isn't set to Read+Write.** Symptom: `docker/login-action` succeeds but `docker/build-push-action` fails with `denied: permission_denied`. Fix: the user_setup GitHub Settings toggle (documented above).
6. **arm64 QEMU cross-build in ci.yml is the slowest PR step (~3-5 min).** Expected, not flakiness. If it becomes a bottleneck for PR velocity, consider moving it to a separate `arm64-validation` job that runs in parallel with the amd64 job (phase-7 optimization).

## Next Phase Readiness

Ready for **01-07** (final phase plan: README + LICENSE + repo bootstrap). That plan will:
- Generate README.md documenting operator-facing setup including the three user_setup items above (branch protection, GHCR visibility, Actions write permissions).
- Add MIT LICENSE file per D-09 / INFR-12.
- Optionally wire in any final docs/operator instructions derived from 01-01..01-06 deliverables.

Phase-1 CI/CD gates closed by this plan:
- INFR-02 (multi-arch image): release.yml builds + pushes linux/amd64+linux/arm64; scripts/check-multiarch.sh verifies manifest. Also validated on every PR via arm64 cross-build step (type=image,push=false) — the manifest-push side fires on tag only, but the Dockerfile-is-cross-arch claim is now a PR gate.
- INFR-03 (300MB ceiling): ci.yml enforces on every PR via scripts/check-image-size.sh.
- Pitfall #3 guard: ci.yml greps built image for NEXT_PUBLIC_* leakage.
- D-10 branch protection: documented as user_setup; operator applies via web UI (one-time, per user_setup frontmatter).

Phase-7 deferred hardening carry-forward (for /gsd-execute-phase-7 planner):
- SHA-pinning of GitHub Actions (accepted-risk T-01-06-02 becomes mitigate-in-phase-7).
- cosign / OIDC container signing (RESEARCH.md §Security Domain explicit defer).
- Native arm64 runners (vs QEMU emulation) if private-repo minute costs become relevant or QEMU proves slow.

## Self-Check: PASSED

Verified claims on disk (2026-04-20T22:00:27Z):

- `test -f .github/workflows/ci.yml` — exists (81 lines).
- `test -f .github/workflows/release.yml` — exists (62 lines).
- Commit `821b7a5` (Task 1 ci.yml) present in `git log --oneline` on master.
- Commit `0647829` (Task 2 release.yml) present in `git log --oneline` on master.
- All 29 Task-1 acceptance criteria green (54 total across both tasks; Task 2 has 25).
- `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` exit 0.
- `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"` exit 0.
- Plan-level `<verification>` static block: all 6 checks pass (YAML validity ×2, actions/* pinned, docker/* pinned, trigger shapes ×2).
- No `@master` / `@latest` floating refs in either file.
- No deletions in either commit (`git diff --diff-filter=D --name-only HEAD~1 HEAD` empty for both).
- No untracked workflow files; only pre-existing untracked `.claude/ KICKOFF.md SPEC.md` (not part of this plan's scope).

---
*Phase: 01-scaffold-infrastructure*
*Completed: 2026-04-20*
