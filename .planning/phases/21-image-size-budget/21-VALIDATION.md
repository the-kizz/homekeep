# Phase 21 — Validation Plan

**Phase:** 21 — Image Size Budget Adjustment
**Requirements:** INFRA-BUMP-01
**Scope:** Policy/doc edits in four forward source-of-truth files. No production code, no Dockerfile, no workflow logic, no schema, no migrations.

---

## Requirement → Check Map

| REQ-ID | Observable behavior | Check type | Automated command | File exists? |
|--------|--------------------|-----------|-------------------|--------------|
| INFRA-BUMP-01 | Image-size script enforces 320MB ceiling | static/grep | `grep -c '^LIMIT=320$' scripts/check-image-size.sh` == `1` | Yes — edit only |
| INFRA-BUMP-01 | Old 300MB script ceiling fully replaced | static/grep | `grep -c '^LIMIT=300$' scripts/check-image-size.sh` == `0` | Yes |
| INFRA-BUMP-01 | SPEC.md §15 reflects new 320MB target | static/grep | `grep -c 'under 320MB' SPEC.md` >= `1` | Yes — edit only |
| INFRA-BUMP-01 | SPEC.md §15 includes v1.1 rationale (growth narrative) | static/grep | `grep -c 'v1.1 growth' SPEC.md` >= `1` | Yes |
| INFRA-BUMP-01 | SPEC.md §15 rationale cites the four growth drivers (shadcn, @radix-ui/react-collapsible, pb_migrations, pb_hooks) | static/grep | `grep -c 'react-collapsible' SPEC.md` >= `1` AND `grep -c 'pb_migrations' SPEC.md` >= `1` AND `grep -c 'pb_hooks' SPEC.md` >= `1` | Yes |
| INFRA-BUMP-01 | SPEC.md §15 line 469 old budget line no longer present as-is | static/grep | `grep -c '^- \*\*Final image target:\*\* under 300MB$' SPEC.md` == `0` | Yes |
| INFRA-BUMP-01 | PROJECT.md Constraints bullet reflects new 320MB target | static/grep | `grep -c 'under 320MB' .planning/PROJECT.md` == `1` | Yes — edit only |
| INFRA-BUMP-01 | PROJECT.md Constraints bullet cross-references SPEC.md §15 | static/grep | `grep -c 'SPEC.md §15' .planning/PROJECT.md` >= `1` | Yes |
| INFRA-BUMP-01 | PROJECT.md old 300MB Constraints bullet fully replaced | static/grep | `grep -c 'Single Docker image under 300MB' .planning/PROJECT.md` == `0` | Yes |
| INFRA-BUMP-01 | ci.yml step label aligned with new budget | static/grep | `grep -c 'Image size check (<320MB per INFR-03)' .github/workflows/ci.yml` == `1` | Yes — edit only |
| INFRA-BUMP-01 | ci.yml old label fully replaced | static/grep | `grep -c 'Image size check (<300MB per INFR-03)' .github/workflows/ci.yml` == `0` | Yes |
| INFRA-BUMP-01 | ci.yml run-line untouched (still invokes the script on homekeep:ci) | static/grep | `grep -c 'sh scripts/check-image-size.sh homekeep:ci' .github/workflows/ci.yml` == `1` | Yes |
| INFRA-BUMP-01 | Immutable history NOT touched — REQUIREMENTS.md unchanged | git-diff | `git diff --name-only -- .planning/REQUIREMENTS.md .planning/milestones/` exits with NO output | Yes |
| INFRA-BUMP-01 | Immutable history NOT touched — ROADMAP.md unchanged | git-diff | `git diff --name-only -- .planning/ROADMAP.md` exits with NO output (planner may touch ROADMAP.md plan-list placeholder only; if it does, that single update is permitted — the script does not otherwise change) | Yes |
| INFRA-BUMP-01 | Immutable history NOT touched — research/ and prior-phase summaries unchanged | git-diff | `git diff --name-only -- .planning/research/ .planning/phases/01-scaffold-infrastructure/ .planning/phases/07.1-deploy-checkpoint/` exits with NO output | Yes |
| INFRA-BUMP-01 | CI image-size gate passes on next push (forward gate) | workflow-gated | Post-merge: `gh run list --workflow=ci.yml -L 1` → `conclusion=success`; the `Image size check (<320MB per INFR-03)` step is green | Yes — workflow exists at `.github/workflows/ci.yml:77-78` |

---

## Sampling Rate

- **Per task commit:** Run the grep-invariant one-liner (see "Grep-Based Structural Invariants" below). < 1s.
- **Phase gate (pre-commit):**
  - Full grep invariant set — ALL counts match simultaneously
  - `git diff --name-only` returns exactly four paths: `scripts/check-image-size.sh`, `SPEC.md`, `.planning/PROJECT.md`, `.github/workflows/ci.yml` (optionally plus the plan/summary/roadmap docs update artifacts)
  - `git diff --stat` shows small diffs (1 line for script, ~2 lines for SPEC.md, 1 line for PROJECT.md, 1 line for ci.yml)
- **Post-push (forward gate — closes INFRA-BUMP-01):**
  - CI workflow run for the pushed commit → `Image size check (<320MB per INFR-03)` step green
  - 309MB current image size passes against 320MB limit

---

## Wave 0 Gaps

None.

- `scripts/check-image-size.sh` exists (13 lines) — edit only
- `SPEC.md` exists with §15 at line 466-475 — edit only
- `.planning/PROJECT.md` exists with Constraints block at line 77-84 — edit only
- `.github/workflows/ci.yml` exists with image-size step at line 77-78 — edit only (label only)
- No new files to create
- No new tests to write (static invariants + CI run cover all acceptance)

---

## Grep-Based Structural Invariants

Run after Task 1 completes. All must hold simultaneously:

```bash
# Script — line 6 flipped
grep -c '^LIMIT=320$' scripts/check-image-size.sh                                    # == 1
grep -c '^LIMIT=300$' scripts/check-image-size.sh                                    # == 0

# SPEC.md — §15 budget raised + rationale added
grep -c 'under 320MB' SPEC.md                                                        # >= 1
grep -c '^- \*\*Final image target:\*\* under 300MB$' SPEC.md                        # == 0
grep -c 'v1.1 growth' SPEC.md                                                        # >= 1
grep -c 'react-collapsible' SPEC.md                                                  # >= 1
grep -c 'pb_migrations' SPEC.md                                                      # >= 1
grep -c 'pb_hooks' SPEC.md                                                           # >= 1

# PROJECT.md — Constraints bullet raised + SPEC cross-ref added
grep -c 'under 320MB' .planning/PROJECT.md                                           # == 1
grep -c 'SPEC.md §15' .planning/PROJECT.md                                           # >= 1
grep -c 'Single Docker image under 300MB' .planning/PROJECT.md                       # == 0

# ci.yml — label aligned, run line untouched
grep -c 'Image size check (<320MB per INFR-03)' .github/workflows/ci.yml             # == 1
grep -c 'Image size check (<300MB per INFR-03)' .github/workflows/ci.yml             # == 0
grep -c 'sh scripts/check-image-size.sh homekeep:ci' .github/workflows/ci.yml        # == 1
```

All 14 counts must match simultaneously before commit.

---

## Immutable History — DO NOT EDIT

Per RESEARCH.md "Immutable history — DO NOT EDIT" and D-01/D-02/D-04:

```bash
# These git-diff checks must return NO output (files unchanged):
git diff --name-only -- .planning/REQUIREMENTS.md
git diff --name-only -- .planning/milestones/
git diff --name-only -- .planning/research/STACK.md
git diff --name-only -- .planning/research/ARCHITECTURE.md
git diff --name-only -- .planning/phases/01-scaffold-infrastructure/
git diff --name-only -- .planning/phases/07.1-deploy-checkpoint/
git diff --name-only -- .planning/phases/21-image-size-budget/21-CONTEXT.md
```

The 300MB references in these files are historical records of the v1.0 ceiling (when INFR-03 was delivered at 300MB) and MUST remain. The forward record lives in INFRA-BUMP-01 at REQUIREMENTS.md L646, which already exists and describes the 300→320 bump — nothing to add to that ledger.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| `grep` (or ripgrep) | All static invariants | ✓ (POSIX + rg in dev env) | — | — |
| `git` | diff-stat checks | ✓ | 2.x | — |
| GitHub Actions runner | Forward CI gate | ✓ (push-triggered) | ubuntu-latest (ci.yml:15) | — |
| Docker buildx | CI image build (upstream of the size check) | ✓ (ci.yml:71) | action v4 | — |

No missing dependencies. Phase 21 is a pure text edit — executes entirely with `Edit` tool + a grep pass; no build, no test runner, no test harness.

---

## Local vs. CI Acceptance

### Local Acceptance (ready to commit)

- All 14 grep invariants match (see "Grep-Based Structural Invariants" above)
- `git diff --name-only` shows exactly these paths and nothing else:
  - `scripts/check-image-size.sh`
  - `SPEC.md`
  - `.planning/PROJECT.md`
  - `.github/workflows/ci.yml`
  - (Plus planner/summary docs: `.planning/phases/21-image-size-budget/21-01-P01-PLAN.md`, `21-VALIDATION.md`, `21-01-P01-SUMMARY.md`, `.planning/ROADMAP.md` plan-list tick — these are expected meta-artifacts, not INFR-03 logic changes)
- `git diff --stat` shows small diffs (≤ 3 changed lines per file for the four forward files)
- All immutable-history git-diff checks return empty

### CI Acceptance (closes INFRA-BUMP-01)

- Push to master triggers `.github/workflows/ci.yml`:
  - `lint-test-build` job green end-to-end
  - `Image size check (<320MB per INFR-03)` step green
  - Expected output: `Image homekeep:ci = 309MB (limit 320MB)` → `OK`
- On the next stable tag push (post-Phase-21 commit):
  - `.github/workflows/release.yml` runs
  - Tier-tag step advances `ghcr.io/conroyke56/homekeep:latest` AND `ghcr.io/conroyke56/homekeep:1.1` to the new digest (unblocked by — not required within — this phase)

No workflow YAML logic changes are required. The only YAML edit is the cosmetic step-name label (line 77), so the run remains functionally identical — just honest about what it now enforces.

---

*Phase: 21-image-size-budget*
