<!-- gitleaks:allow (workflow references, no secrets) -->
---
phase: 38
phase_name: CI Flake Budget + Planning Dir Cleanup
status: shipped
parent_milestone: v1.3-test-stabilization
covered_reqs: [TESTFIX-05, TESTFIX-06]
---

# Phase 38 Summary — CI Flake Budget + Planning Dir Cleanup

## TESTFIX-05 — Flake-retry budget + CI fail-on-retry

**Problem:** CI currently runs Playwright with default `retries: 0`,
so a real flake causes a build failure (good) but a **silent
intermittent** (test that sometimes passes, sometimes not) isn't
distinguishable from a stable-green test. Any future v1.4 flake
would slip in undetected.

**Fix — two parts:**

1. **`playwright.config.ts`** — `retries: process.env.CI ? 2 : 0`.
   CI gets up to 2 retries per test (absorbs genuine transient
   conditions: network blip, PB hot-start after fresh bootstrap);
   local runs stay at 0 (fail fast on actual bugs). CI also emits a
   `test-results/e2e-report.json` so a downstream step can audit
   retry counts.

2. **`.github/workflows/ci.yml`** — new step after E2E:
   "Flake budget check (TESTFIX-05 — zero retries allowed on
   master)". Parses the JSON report, counts tests where
   `results[].length > 1` with final status `passed` (i.e. retried
   but eventually green). **Fails the build if any retry was
   actually consumed.**

**Behavior:**
- Zero flakes → CI prints `OK: zero retries consumed.` and passes.
- 1+ retries → CI prints `FAIL: N E2E test(s) required retry to
  pass — flake budget is zero on master.` and exits 1.
- Outright failures → existing Playwright step already fails; new
  step's `if: always()` still runs and reports `FAIL: N E2E test(s)
  failed outright.` for explicit audit.

This means the **retry mechanism catches genuine transient
blips** (so random infrastructure noise doesn't page you at 3am),
but **masquerading as stable is impossible** because the retry is
always surfaced. Best of both worlds.

## TESTFIX-06 — Planning dir cleanup

**Before:** `.planning/` root had 3 `HANDOFF-*.md` files from
successive mid-session context transfers. Only the most recent
(`-03`) is current; the others are historical.

**After:**
- `.planning/HANDOFF-2026-04-24-03.md` — stays at root as the
  current resume-point for future sessions
- `.planning/handoffs-archive/HANDOFF-2026-04-24.md` — archived
- `.planning/handoffs-archive/HANDOFF-2026-04-24-02.md` — archived
- `.planning/handoffs-archive/README.md` — explains the convention
  (naming, purpose, cleanup cadence)

## Files changed

- `playwright.config.ts` — added `retries` + JSON reporter for CI
- `.github/workflows/ci.yml` — added flake-budget-check step
- `.planning/HANDOFF-2026-04-24.md` → `.planning/handoffs-archive/`
- `.planning/HANDOFF-2026-04-24-02.md` → `.planning/handoffs-archive/`
- `.planning/handoffs-archive/README.md` — new

## Verification

- TypeScript clean (`npx tsc --noEmit`)
- Unit tests still 678/678 green (no behavior change from this phase)
- CI on next push will exercise the flake-budget check; expect
  `OK: zero retries consumed.` given Phase 35-37's fixes
- Git mv preserves history (no `rm` + re-add; both files show their
  full edit history under `.planning/handoffs-archive/`)

## Closing v1.3 milestone

With Phase 35-38 shipped, all 6 TESTFIX REQ-IDs are done:
- TESTFIX-01, 02 → Phase 35 (un-skipped)
- TESTFIX-03 → Phase 36 (auth-refresh retry)
- TESTFIX-04 → Phase 37 (shared helpers)
- TESTFIX-05, 06 → Phase 38 (this phase)

**Milestone success criteria re-check:**
- ✓ 0 `test.skip()` in `tests/e2e/` (re-enabled in Phase 35)
- ✓ `tests/e2e/helpers.ts` exports `signup`, `waitForServerAction`,
  `waitForRHFConditional`
- ✓ Planning dir: 1 current HANDOFF at root + archive for prior
- ✓ CI flake-budget step lands (will verify with next run)
- **Pending:** "10 consecutive CI builds on master with zero retries"
  — natural bake-in; check periodically over the next week

`.planning/milestones/v1.3-test-stabilization-ROADMAP.md` should be
marked `status: shipped` once the next CI builds green. That's a
separate doc-only commit, not blocking closure here.
