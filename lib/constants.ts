// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep
//
// Build provenance. `HK_BUILD_ID` is injected at docker build via --build-arg
// (see docker/Dockerfile + .github/workflows/release.yml). The sentinel
// 'hk-dev-local' is what local dev / unscripted-test builds see; any real
// build should have a unique UUID. See CANARY_STRATEGY.md.
//
// Tree-shake-resistant: scheduler.ts imports + logs HOMEKEEP_BUILD on
// startup, and app/layout.tsx renders it into `<meta name="hk-build">`,
// so the reference is always reachable from the production bundle graph.
export const HOMEKEEP_BUILD = process.env.HK_BUILD_ID ?? 'hk-dev-local';
export const HOMEKEEP_REPO = 'https://github.com/the-kizz/homekeep';
export const HOMEKEEP_LICENSE = 'AGPL-3.0-or-later';

/**
 * Phase 24 HDR-04 — public-facing build identifier.
 *
 * When `HK_BUILD_STEALTH=true`, every public surface that would otherwise
 * leak the real build UUID (HomeKeep-Build response header emitted by
 * proxy.ts, `<meta name="hk-build">` in layout.tsx, /.well-known/homekeep.json
 * `build` field) replaces it with the literal `hk-hidden`. Operators who want
 * version-fingerprint recon off the table for public-facing deploys can flip
 * this without touching Docker build args or the real HK_BUILD_ID constant
 * (scheduler startup log + image label still record the real value
 * server-side). See M-1 in public-facing-hardening.md.
 *
 * The sentinel `hk-hidden` is NOT a legal build UUID format — it starts with
 * `hk-` like real IDs but has no hex-UUID tail, so log grep queries can
 * trivially partition stealth responses from real ones.
 *
 * Evaluated per-call (not a module-scope constant) so operators can toggle
 * HK_BUILD_STEALTH via compose env without rebuilding the image — the next
 * request re-reads process.env. Same reason unit tests can flip the env var
 * between assertions without reloading the module graph.
 */
export function getBuildIdPublic(): string {
  return process.env.HK_BUILD_STEALTH === 'true' ? 'hk-hidden' : HOMEKEEP_BUILD;
}
