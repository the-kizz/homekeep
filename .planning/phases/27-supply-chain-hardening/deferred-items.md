# Deferred items discovered during Phase 27 execution

## Pre-existing CI failures (not regressions from SUPPLY-01..06)

The CI workflow has been failing since Phase 25 push on 2026-04-23
(commit 24862144596, before Phase 27 started). 10 E2E tests fail on the
signup→/h redirect assertion:

  await expect(page).toHaveURL(/\/h$/);
  // Received: "http://localhost:3001/signup"

Affected tests (unchanged by Phase 27):
- tests/e2e/onboarding.spec.ts:146
- tests/e2e/phase-16-visual.spec.ts:246
- tests/e2e/pwa-manifest.spec.ts:37
- tests/e2e/task-assignment.spec.ts:54
- tests/e2e/tasks-happy-path.spec.ts:45 + :162
- tests/e2e/v1.1-marketing.spec.ts:215
- tests/e2e/views.spec.ts:201 + :279 + :368

Root cause appears to be an E2E signup flow regression introduced earlier
in v1.2-security (likely Phase 25 RATE-01..06 rate-limiting blocking test
accounts created in rapid succession). Not in scope for supply-chain
hardening. Verifier should open a ticket for `fix: restore E2E signup
happy-path after RATE-06` or similar.

## Edge workflow: VERIFIED SUCCESS (Phase 27 supply-chain end-to-end)

Push ac2b464 to master triggered Edge workflow run 24864528550 which:
- Built multi-arch image with digest-pinned bases (SUPPLY-04)
- Attached SBOM + SLSA-3 provenance to both amd64 and arm64 manifests
  (SUPPLY-02) — verified via `docker buildx imagetools inspect
  ghcr.io/the-kizz/homekeep:edge` showing `vnd.docker.reference.type:
  attestation-manifest` for each platform
- Used SHA-pinned actions throughout (SUPPLY-03)
- Emitted the telemetry-disabled runtime image (SUPPLY-06)

Cosign signing (SUPPLY-01) will be verified on the next `v*` tag push
(Release workflow); it cannot fire on Edge since Edge does not sign.

## Dependabot immediate effects

Dependabot picked up .github/dependabot.yml on push and immediately opened
4 speculative major-bump PRs:
- actions/setup-node 5.0.0 -> 6.4.0
- actions/cache 4.3.0 -> 5.0.5
- docker/metadata-action 5.10.0 -> 6.0.0
- sigstore/cosign-installer 3.10.1 -> 4.1.1

These are expected and working-as-intended. Their CI runs fail because
crossing majors is a behaviour change (not a behaviour-preserving SHA
refresh). Maintainer should review and merge/close each PR individually.
