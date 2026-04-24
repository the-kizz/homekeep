# Phase 20 — Validation Plan

**Phase:** 20 — E2E Test Stabilization
**Requirements:** TEST-01, TEST-02
**Scope:** Test-only changes in `tests/e2e/core-loop.spec.ts`. No production code, no schema, no workflow YAML.

---

## Requirement → Test Map

| REQ-ID | Observable behavior | Test type | Automated command | File exists? |
|--------|--------------------|-----------|-------------------|--------------|
| TEST-01 | Scenario 1 — guard dialog visible → confirm → toast `/Done — next due/` → completion count 1→2 → BandView re-renders with task present | e2e (Playwright) | `npx playwright test tests/e2e/core-loop.spec.ts -g "Scenario 1" --reporter=list` | Yes — edit only |
| TEST-01 | Scenario 2 — overdue row visible → click → NO guard dialog → toast → completion count 1→2 → BandView re-renders with task present | e2e (Playwright) | `npx playwright test tests/e2e/core-loop.spec.ts -g "Scenario 2" --reporter=list` | Yes — edit only |
| TEST-01 | `seedCompletion` POSTs completion THEN PATCHes task `next_due_smoothed='' + reschedule_marker=''` | static/grep | `grep -c "next_due_smoothed: ''" tests/e2e/core-loop.spec.ts` == `1` AND `grep -c "reschedule_marker: ''" tests/e2e/core-loop.spec.ts` == `1` | Yes |
| TEST-01 | Top-of-file LOAD-aware seed pattern doc block present | static/grep | `grep -c 'LOAD-aware seed pattern' tests/e2e/core-loop.spec.ts` == `1` | Yes |
| TEST-01 | `getCompletionCount` helper used twice (once per scenario) | static/grep | `grep -c 'getCompletionCount(request, token, taskId)' tests/e2e/core-loop.spec.ts` == `2` | Yes |
| TEST-01 | Post-completion band-exit `toHaveCount(0)` assertions removed (only the no-guard dialog `toHaveCount(0)` remains) | static/grep | `grep -cE 'toHaveCount\(0\)' tests/e2e/core-loop.spec.ts` == `1` | Yes |
| TEST-01 | Unit suite stays green (no production regression) | vitest | `npm run test -- --run` exits 0 | Yes |
| TEST-01 | TypeScript compiles cleanly | tsc | `npx tsc --noEmit -p tsconfig.json` exits 0 | Yes |
| TEST-02 | `.github/workflows/ci.yml` `test:e2e` step passes on the next push after local green | workflow-gated | Post-merge: `gh run list --workflow=ci.yml -L 1` → conclusion=success | Yes — workflow exists at `.github/workflows/ci.yml:62-68` |
| TEST-02 | `.github/workflows/release.yml` advances `:latest` + `:1.1` GHCR tags on next stable tag push | workflow-gated | Post-tag: `docker manifest inspect ghcr.io/the-kizz/homekeep:latest` refs the new digest; `gh run view <release-run>` shows tier-tag step green | Yes — workflow exists at `.github/workflows/release.yml:48-57` |

---

## Sampling Rate

- **Per task commit:** `npx playwright test tests/e2e/core-loop.spec.ts --reporter=list` (< 60s; two scenarios serialized or parallelized under `fullyParallel: true`)
- **Phase gate (pre-commit):**
  - `npm run test -- --run` (full unit suite)
  - `npx playwright test tests/e2e/core-loop.spec.ts --reporter=list` (full file)
  - `npx tsc --noEmit -p tsconfig.json`
  - `npm run lint -- tests/e2e/core-loop.spec.ts`
- **Post-merge (TEST-02):**
  - Monitor CI workflow run for the pushed commit; expect `test:e2e` step green
  - On next stable tag push, monitor Release workflow for tier-tag advancement step

---

## Wave 0 Gaps

None.

- `tests/e2e/core-loop.spec.ts` exists (286 lines) — edit only
- `tests/e2e/helpers.ts` exists (35 lines) — unchanged
- `playwright.config.ts` exists — unchanged
- `components/early-completion-dialog.tsx` has stable `[data-testid="early-completion-dialog"]` + `[data-testid="guard-confirm"]` selectors (verified in Phase 20 research) — unchanged
- `components/band-view.tsx:280` + `components/person-task-list.tsx:170` render the toast `Done — next due ${nextDueFormatted}` (verified) — unchanged
- PB REST endpoints (`/api/collections/completions/records`, `/api/collections/tasks/records/:id`) exist — unchanged

No new test files required (D-09 scope: 2 tests updated, 0 new).

---

## Grep-Based Structural Invariants

Run after Task 3 completes. All must hold simultaneously:

```bash
grep -c 'LOAD-aware seed pattern' tests/e2e/core-loop.spec.ts              # == 1
grep -c 'async function seedCompletion' tests/e2e/core-loop.spec.ts        # == 1
grep -c 'async function getCompletionCount' tests/e2e/core-loop.spec.ts    # == 1
grep -c "next_due_smoothed: ''" tests/e2e/core-loop.spec.ts                # == 1
grep -c "reschedule_marker: ''" tests/e2e/core-loop.spec.ts                # == 1
grep -c 'request.patch' tests/e2e/core-loop.spec.ts                        # == 1
grep -c 'totalItems' tests/e2e/core-loop.spec.ts                           # == 1
grep -c 'getCompletionCount(request, token, taskId)' tests/e2e/core-loop.spec.ts  # == 2
grep -c 'expect(afterCount).toBe(2)' tests/e2e/core-loop.spec.ts           # == 2
grep -cE 'toHaveCount\(0\)' tests/e2e/core-loop.spec.ts                    # == 1 (no-guard only)
grep -c '\[data-band="thisWeek"\] \[data-task-name="Wipe benches"\]' tests/e2e/core-loop.spec.ts  # == 1
grep -c '\[data-band="overdue"\] \[data-task-name="Clean filter"\]' tests/e2e/core-loop.spec.ts   # == 1
```

The last four grep counts confirm that each scenario has:
- Exactly ONE pre-click band-visibility assertion (`toBeVisible` on the scoped locator)
- ZERO post-completion band-exit assertions (the old `toHaveCount(0)` pattern)
- The only surviving `toHaveCount(0)` is Scenario 2's no-guard dialog assertion

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Playwright | `test:e2e` | ✓ (in `package.json`) | 1.x | — |
| PocketBase binary | webServer + PB REST | ✓ (local `.pb/pocketbase`; CI caches per `ci.yml:41-56`) | 0.37.1 | — |
| Node 22 | All | ✓ | 22.x (CI `ci.yml:27`) | — |
| chromium browser | `test:e2e` | ✓ (CI installs per `ci.yml:62`) | Playwright-bundled | — |

No missing dependencies. Phase 20 executes entirely within the existing test harness.

---

## Local vs. CI Acceptance

### Local Acceptance (closes TEST-01)
- `npx playwright test tests/e2e/core-loop.spec.ts --reporter=list` → 2 passed, 0 failed
- `npm run test -- --run` → 610+ passed, 0 failed
- `npx tsc --noEmit -p tsconfig.json` → exit 0
- `git diff --name-only` → only `tests/e2e/core-loop.spec.ts`

### CI Acceptance (closes TEST-02)
- Push to master triggers `.github/workflows/ci.yml`:
  - `lint-test-build` job green
  - `test:e2e` step green (the 2 previously-failing scenarios now pass)
  - 23 passed / 0 failed in E2E suite (per ROADMAP success criterion 2)
- On the next stable tag push (`v1.1.1` or later) after CI green:
  - `.github/workflows/release.yml` runs
  - Tier-tag step advances `ghcr.io/the-kizz/homekeep:latest` AND `ghcr.io/the-kizz/homekeep:1.1` to the new digest (per ROADMAP success criterion 3)

No new workflow YAML changes are required. The planning prompt explicitly confirms this: the Release workflow's existing E2E gate (if any) advances tiered tags once CI goes green.

---

*Phase: 20-e2e-test-stabilization*
