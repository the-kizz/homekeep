---
phase: 07-pwa-release
plan: 02
subsystem: infra
tags: [compose, caddy, tailscale, https, docs, release, ci-validation, infr-09]

# Dependency graph
requires:
  - phase: 01-scaffold-infrastructure
    provides: "docker/docker-compose.yml baseline; .github/workflows/release.yml multi-arch GHCR pipeline; scripts/check-multiarch.sh + check-image-size.sh"
  - phase: 07-pwa-release
    plan: 01
    provides: "Serwist service worker + InsecureContextBanner that now have HTTPS deployment targets to attach to"
provides:
  - "docker/docker-compose.caddy.yml — HTTPS overlay adding caddy:2.11.2-alpine sidecar on host 80/443 (+ HTTP/3 UDP 443) with named caddy_data + caddy_config volumes"
  - "docker/docker-compose.tailscale.yml — tailnet overlay adding tailscale/tailscale:stable sidecar; homekeep joins via network_mode: service:tailscale"
  - "docker/Caddyfile.prod — external TLS terminator (DISTINCT from internal docker/Caddyfile); {$DOMAIN} reverse_proxy homekeep:3000 with flush_interval -1"
  - "docs/deployment.md — 205-line operator guide; LAN / Caddy / Tailscale / Release sections + Troubleshooting"
  - "docs/pwa-install.md — 54-line iOS + Android + Desktop install recipes + offline-scope + uninstall"
  - "README.md § Production deployment — three-variant table + links to both docs files"
  - ".env.example DOMAIN + CADDY_EMAIL + TS_AUTHKEY — pre-documented with prereqs"
affects: [v1.0.0-rc1-release, future-funnel-public-tailnet, post-v1-tailscale-sha-pinning]

# Tech tracking
tech-stack:
  added:
    - "caddy:2.11.2-alpine (external TLS terminator; pinned to match internal Caddy version from 01-02)"
    - "tailscale/tailscale:stable (floating tag per Tailscale publisher convention; SHA-pinning deferred post-v1 per T-07-02-02)"
  patterns:
    - "Compose overlay pattern — baseline docker-compose.yml stays byte-for-byte unchanged; HTTPS variants are opt-in via -f merge"
    - "!reset [] directive (Compose v2.24+) — hides baseline ports in overlays so only the sidecar binds host ports"
    - ":? fail-fast env interpolation — DOMAIN and TS_AUTHKEY error with clear message instead of silent defaults"
    - "Caddyfile env substitution ({$DOMAIN}, {$CADDY_EMAIL:default}) — distinct from docker-compose env interpolation"
    - "Kernel-networking Tailscale (TS_USERSPACE=false + net_admin + /dev/net/tun) — faster than userspace wireguard-go; fallback documented"
    - "INFR-09 re-validation via grep + yaml-parse smoke — proves workflow health without editing release.yml"

key-files:
  created:
    - "docker/docker-compose.caddy.yml"
    - "docker/docker-compose.tailscale.yml"
    - "docker/Caddyfile.prod"
    - "docs/deployment.md"
    - "docs/pwa-install.md"
    - ".planning/phases/07-pwa-release/deferred-items.md"
  modified:
    - ".env.example"
    - "README.md"

key-decisions:
  - "07-02: Caddyfile.prod uses Caddy's env substitution ({$DOMAIN}) rather than docker-compose ${DOMAIN} — Caddy evaluates at boot, so the single overlay works for any DOMAIN without file regeneration"
  - "07-02: !reset [] over ports: [] — explicit Compose v2.24+ directive is more readable than relying on older-Compose list-merge semantics; documented fallback in Troubleshooting"
  - "07-02: Caddy pinned to 2.11.2-alpine to match the internal Caddy binary version from 01-02 — single supply-chain coherent tag across in-container and external"
  - "07-02: Named volumes caddy_data + caddy_config (not bind mounts) — persist Let's Encrypt cert + ACME account key; critical for 5/week rate-limit avoidance"
  - "07-02: Tailscale kernel mode (TS_USERSPACE=false) kept as default — faster than userspace on the modern Linux kernels every VPS ships; userspace fallback documented for locked-down hosts"
  - "07-02: Tailscale tag 'stable' kept floating per Tailscale publisher convention — T-07-02-02 accept-disposition; SHA-pinning deferred to post-v1"
  - "07-02: INFR-09 re-validated in-place (yaml-parse + grep + exec-bit checks) — NO edits to release.yml/ci.yml; the Phase 1 workflow is 2026-drift-clean"
  - "07-02: deferred-items.md captures pre-existing Serwist-generated public/sw.js lint noise — SCOPE BOUNDARY; fix is eslint ignores not source edit"

patterns-established:
  - "Multi-variant Compose with untouched baseline — HTTPS is opt-in via overlay -f merge, not a mode-switching env var"
  - "Env substitution layer-split: docker-compose does ${VAR} for service definitions; Caddyfile does {$VAR} for directive bodies; both types coexist without collision"
  - "INFR re-validation without re-implementation: for CI/CD artifacts shipped in an earlier phase, re-prove via grep + yaml-parse smoke instead of re-editing the workflow"

requirements-completed: [INFR-09]

# Metrics
duration: 120min
completed: 2026-04-21
---

# Phase 7 Plan 2: Production deployment variants + deployment docs + INFR-09 re-validation Summary

**Two production compose overlays (Caddy public-domain + Tailscale tailnet), matching operator documentation with three-variant deployment guide and PWA install recipes, and a clean INFR-09 re-validation of the Phase 1 release pipeline — with the baseline `docker/docker-compose.yml` untouched byte-for-byte.**

## Performance

- **Duration:** 120 min
- **Started:** 2026-04-21T07:38:06Z
- **Completed:** 2026-04-21T09:39:05Z
- **Tasks:** 2 (both auto, no TDD)
- **Files changed:** 8 (6 created, 2 modified)

## Accomplishments

- Shipped `docker/docker-compose.caddy.yml` — adds `caddy:2.11.2-alpine` on host 80/443 + UDP 443 (HTTP/3); named `caddy_data` + `caddy_config` volumes persist Let's Encrypt certs; `DOMAIN` fail-fast via `:?` directive.
- Shipped `docker/docker-compose.tailscale.yml` — `tailscale/tailscale:stable` sidecar with kernel-networking (`net_admin` + `sys_module` + `/dev/net/tun`); `network_mode: service:tailscale` puts homekeep on tailnet IP.
- Shipped `docker/Caddyfile.prod` — external TLS terminator using Caddy env substitution `{$DOMAIN}` + `reverse_proxy homekeep:3000` with `flush_interval -1` (SSE-safe). Distinct from the internal `docker/Caddyfile` which stays `auto_https off` inside the container.
- Shipped `docs/deployment.md` (205 lines) — LAN/Caddy/Tailscale/Release sections + Troubleshooting; every referenced artifact (overlays, release.yml, check-multiarch.sh, v1.0.0-rc1 tag command) cross-linked.
- Shipped `docs/pwa-install.md` (54 lines) — iOS Safari, Android Chrome, Desktop Chrome/Edge/Brave recipes + offline scope + uninstall.
- README gained a "Production deployment" section between Configuration and the UID-fallback block — additions only, zero deletions elsewhere.
- `.env.example` extended with `DOMAIN`, `CADDY_EMAIL`, `TS_AUTHKEY` — existing 51-line file's other variables byte-for-byte unchanged.
- INFR-09 re-validated: release.yml + ci.yml still parse, `tags: ['v*']` trigger intact, every `uses:` still pinned to `@v<major>`, no `@master` or `@latest` floating refs, both helper scripts still executable. **Zero changes to the Phase 1 workflow files.**
- Full unit test suite green: 311 tests / 44 files.

## Task Commits

1. **Task 1** — `cfdec9e` `feat(07-02): add Caddy + Tailscale compose overlays`
   - docker/Caddyfile.prod, docker/docker-compose.caddy.yml, docker/docker-compose.tailscale.yml, .env.example (+DOMAIN/CADDY_EMAIL/TS_AUTHKEY)
   - Verified: `docker compose config --quiet` passes for both overlay permutations and the untouched baseline.
2. **Task 2** — `dc83b26` `docs(07-02): add deployment + PWA-install guides, re-validate INFR-09`
   - docs/deployment.md, docs/pwa-install.md, README.md (+Production deployment section), deferred-items.md
   - INFR-09 re-validation ran inline in verify gate; all 7 proof checks passed.

**Plan metadata commit:** (appended at end — STATE/ROADMAP/REQUIREMENTS + this SUMMARY).

## Files Created/Modified

### Created

- `docker/docker-compose.caddy.yml` — HTTPS overlay, 45 lines
- `docker/docker-compose.tailscale.yml` — tailnet overlay, 39 lines
- `docker/Caddyfile.prod` — external TLS terminator, 16 lines
- `docs/deployment.md` — 205-line operator guide
- `docs/pwa-install.md` — 54-line install recipes
- `.planning/phases/07-pwa-release/deferred-items.md` — scope-boundary tracking

### Modified

- `.env.example` — appended DOMAIN, CADDY_EMAIL, TS_AUTHKEY blocks (13 new lines, zero removed)
- `README.md` — new `## Production deployment` section between Configuration and UID-fallback (14 new lines, zero removed)

## Decisions Made

See `key-decisions` frontmatter. Highlights:

1. **Caddy env substitution `{$DOMAIN}` in Caddyfile.prod, not docker-compose `${DOMAIN}`.** Caddy evaluates its own env interpolation at container boot from the process environment that compose passes in. This keeps Caddyfile.prod a single file that works for any domain — no compose-level file templating needed.
2. **`!reset []` Compose-merge directive (v2.24+).** More readable than older `ports: []` list-merge semantics. Fallback for older Compose is documented in Troubleshooting.
3. **Caddy 2.11.2-alpine pinned** to match the internal Caddy binary from 01-02. Same version across in-container routing and external TLS.
4. **Tailscale tag `stable` kept floating.** T-07-02-02 accept-disposition; Tailscale is a first-party publisher and SHA-pinning is explicitly deferred to post-v1 per 01-06 policy.
5. **INFR-09 re-validated in-place.** The plan's contract was "prove the Phase 1 pipeline still works without code changes" — not "re-ship the pipeline". Seven smoke checks (YAML parse + grep for trigger/actions/floats + exec-bit) passed without touching `.github/workflows/*.yml`.
6. **Deferred-items tracking for pre-existing Serwist lint noise.** `public/sw.js` had 1 error + 86 warnings before 07-02 (confirmed via `git stash` A/B). SCOPE BOUNDARY: not caused by this plan; logged for post-v1 cleanup (ESLint ignores).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] `yaml.safe_load` rejects Compose's `!reset` tag**

- **Found during:** Task 1 verify gate (the plan's literal `python3 -c "import yaml; yaml.safe_load(...)"`)
- **Issue:** The plan's verify command used stock PyYAML `safe_load`, but `!reset []` is a Docker-Compose-specific YAML tag that PyYAML has no constructor for. `ConstructorError: could not determine a constructor for the tag '!reset'`.
- **Fix:** Registered `!reset` as a passthrough constructor in the inline verify script: `yaml.SafeLoader.add_constructor('!reset', lambda loader, node: loader.construct_sequence(node) if node.id == 'sequence' else None)`. Then delegated authoritative YAML+merge validation to `docker compose config --quiet`, which is the real shape we care about (Compose is the consumer). Both layers passed.
- **Files modified:** none (verification-only)
- **Committed in:** n/a (verify-only)

### Out-of-scope deferrals

**2. [SCOPE BOUNDARY] `public/sw.js` pre-existing lint noise**

- **Found during:** Task 2 `npm run lint` sweep
- **Finding:** `1 error, 86 warnings`, all originating in `public/sw.js` (Serwist-generated minified precache blob shipped by 07-01 — confirmed pre-existing via `git stash` A/B).
- **Action:** Logged in `.planning/phases/07-pwa-release/deferred-items.md` with suggested follow-up (ESLint `ignores` entry for `public/sw.js` + `public/swe-worker-*.js`). Not fixed — out of scope per SCOPE BOUNDARY rule; not caused by 07-02.

---

**Total deviations:** 1 auto-fixed (Rule 3 verify-tool mismatch) + 1 SCOPE BOUNDARY deferral logged.
**Impact on plan:** No scope changes. Both overlay files validated via the real consumer (`docker compose config --quiet`) as the plan's <verify> block already stipulated. Serwist lint noise is unrelated Phase 7.1 output that needs a future eslint ignore config, not a source edit.

## Issues Encountered

- **No GitHub remote configured on this host.** Per the plan's `<output>` block prompt, the `git tag v1.0.0-rc1 && git push origin v1.0.0-rc1` ritual is **not** executed in this plan. It's docs-only. The operator runs it when ready to cut the release candidate (documented step-by-step in `docs/deployment.md § Release + tagging (INFR-09)`).
- **Python yaml tag mismatch** (above). Resolved via Compose's native validator.

## Plan-Output-Spec Notes (per plan's `<output>` block)

- **Compose-version adjustment for `!reset` vs `[]`?** None. Installed Compose is v5.1.1 on this exec host, far past the v2.24 cutoff. Both overlays use the plan's `!reset []` as-is; the Troubleshooting section documents the older-Compose fallback.
- **Tailscale kernel-networking path kept or swapped?** Kept — `TS_USERSPACE=false` + `cap_add: [net_admin, sys_module]` + `/dev/net/tun` bind as specified in D-10. Userspace fallback documented in `docs/deployment.md` for hosts without `/dev/net/tun`.
- **`docker compose config --quiet` hashes (both overlays):**
  - Baseline `docker/docker-compose.yml`: SHA256 `ad4f2e32494541afe3f6fec92f20e6ad2ea9eca38edfaf3fb3cef3fd33314927`
  - Caddy overlay (with `DOMAIN=example.com CADDY_EMAIL=admin@example.com`): SHA256 `0f3ea78a7447d8e7d9964948e3ac9c0346f0e20d4575f716332f1a344330b66c`
  - Tailscale overlay (with `TS_AUTHKEY=tskey-stub`): SHA256 `559ec2fa7af806d2d9890fa5ee42bf741df08e93d77f02b29faf7632b3af188f`
  - All three exit status 0 via `--quiet`.
- **release.yml drift fixes?** None. Parsed cleanly; all seven INFR-09 proof checks passed without edits. The file is identical to what 01-06 shipped.
- **`git tag v1.0.0-rc1` executed?** No — deliberately. No GitHub remote configured on this exec host; the plan's `<output>` block explicitly accepts docs-only for this plan. Operator runs it when ready (one-line command in `docs/deployment.md`).

## User Setup Required

From the plan's `user_setup:` block — **none required to merge this plan**. The user-setup items are prereqs for *using* the HTTPS variants, not for committing them:

- **Caddy variant:** needs a domain + A record + open firewall ports 80/443 before running `docker compose ... up -d` with the caddy overlay.
- **Tailscale variant:** needs a reusable auth-key from https://login.tailscale.com/admin/settings/keys + MagicDNS/HTTPS enabled on the tailnet.
- **Release variant (INFR-09):** GitHub Actions write-permissions + GHCR visibility flip are one-time operator tasks documented in `docs/deployment.md § Release + tagging`. Same steps as 01-06 user_setup.

## Next Phase Readiness

Phase 7 is complete. The project now has:

- PWA installability over HTTPS (07-01)
- Graceful-degradation banner on HTTP LAN deploys (07-01)
- Two HTTPS compose variants (07-02)
- Three-variant deployment guide + PWA install recipes (07-02)
- Re-validated multi-arch GHCR release pipeline (INFR-09)

The only remaining operator action before cutting v1.0.0-rc1 is the tag push itself:

```bash
git tag v1.0.0-rc1
git push origin v1.0.0-rc1
```

After CI succeeds, flip the GHCR package visibility to Public in the GitHub UI (one-time). Subsequent releases are just new `v*` tags.

## TDD Gate Compliance

N/A — this plan is `type: execute`, not `type: tdd`. All tasks were `type="auto"` with inline `<verify>` gates (compose config --quiet, grep, yaml-parse). Each task's verify gate passed before its commit landed, and the full post-plan re-run of success criteria (compose x3 + deployment.md content + pwa-install.md content + README cross-links + INFR-09 x7) passed green.

## Self-Check: PASSED

All 6 created files present on disk:
- `docker/docker-compose.caddy.yml` FOUND
- `docker/docker-compose.tailscale.yml` FOUND
- `docker/Caddyfile.prod` FOUND
- `docs/deployment.md` FOUND (205 lines)
- `docs/pwa-install.md` FOUND (54 lines)
- `.planning/phases/07-pwa-release/deferred-items.md` FOUND

All 2 modified files show additions-only diffs (no deletions anywhere):
- `.env.example` +13 / -0
- `README.md` +14 / -0

Both task commits present in git log:
- `cfdec9e` FOUND
- `dc83b26` FOUND

No missing artifacts; no unintentional deletions; no pending stubs.

---

*Phase: 07-pwa-release*
*Completed: 2026-04-21*
