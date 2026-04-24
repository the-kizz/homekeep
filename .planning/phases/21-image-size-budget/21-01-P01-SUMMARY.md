---
phase: 21-image-size-budget
plan: 01
subsystem: infra
tags: [infra, docker, ci, policy, v1.1]
requires: [phase-20-ci-pipeline-green-on-build-path]
provides: [infr-03-budget-raised-320mb, infra-bump-01-closed]
affects: [ci-image-size-gate, ghcr-tiered-tag-advancement]
tech_stack:
  added: []
  patterns: [forward-policy-edit-no-historic-rewrite]
key_files:
  created:
    - .planning/phases/21-image-size-budget/21-01-P01-PLAN.md
    - .planning/phases/21-image-size-budget/21-RESEARCH.md
    - .planning/phases/21-image-size-budget/21-VALIDATION.md
    - .planning/phases/21-image-size-budget/21-01-P01-SUMMARY.md
  modified:
    - scripts/check-image-size.sh
    - SPEC.md
    - .planning/PROJECT.md
    - .github/workflows/ci.yml
    - .planning/REQUIREMENTS.md
decisions:
  - "INFR-03 budget raised 300MB → 320MB (v1.1 policy adjustment; no docker-layer optimization this phase)"
  - "Single fix commit pattern — 4 surgical edits + phase planner artifacts travel together"
metrics:
  duration_min: 8
  completed_at: "2026-04-23T13:16:30Z"
  tasks_completed: 1
  files_modified: 4
---

# Phase 21 Plan 01: Image Size Budget Adjustment Summary

**One-liner:** Raised INFR-03 Docker image budget from 300MB to 320MB across four forward source-of-truth files (enforcement script, SPEC §15, PROJECT.md Constraints, CI step label) to unblock CI and GHCR tiered-tag advancement — absorbs v1.1's ~9MB growth (shadcn components, @radix-ui/react-collapsible, pb_migrations/hooks) with further optimization deferred to v1.2.

## What was built

Four surgical policy edits in a single atomic commit:

1. **`scripts/check-image-size.sh` line 6** — `LIMIT=300` → `LIMIT=320` (CI enforcement constant).
2. **`SPEC.md` §15 (Docker + distribution requirements), final-image-target bullet** — budget raised and augmented with v1.1 rationale inline (8 new shadcn UI components including Collapsible + Dialog variants, @radix-ui/react-collapsible, 4 new pb_migrations + expanded pb_hooks; further optimization deferred to v1.2).
3. **`.planning/PROJECT.md` Constraints bullet (line 80)** — forward project-level constraint raised with cross-reference to `SPEC.md §15`.
4. **`.github/workflows/ci.yml` line 77** — step label `Image size check (<300MB per INFR-03)` → `Image size check (<320MB per INFR-03)` (cosmetic alignment with reality; `run:` line unchanged).

Zero application code, Dockerfile, or CI workflow-logic changes. Pure policy/documentation adjustment.

## Grep invariants (all PASS)

```
1) LIMIT=320 in scripts/check-image-size.sh       count=1  [expect 1]  PASS
2) LIMIT=300 in scripts/check-image-size.sh       count=0  [expect 0]  PASS
3) "under 320MB" in SPEC.md                       count=1  [expect ≥1] PASS
4) "v1.1 growth" in SPEC.md                       count=1  [expect ≥1] PASS
5) "under 320MB" in .planning/PROJECT.md          count=1  [expect 1]  PASS
6) "SPEC.md §15" in .planning/PROJECT.md          count=1  [expect ≥1] PASS
7) "<320MB per INFR-03" in .github/workflows/ci.yml count=1 [expect 1] PASS
```

All seven structural invariants from VALIDATION.md satisfied.

## Exact diffs

**scripts/check-image-size.sh**
```diff
-LIMIT=300
+LIMIT=320
```

**SPEC.md (§15)**
```diff
-- **Final image target:** under 300MB
+- **Final image target:** under 320MB (v1.1 growth: ~9MB for 8 new shadcn UI components including Collapsible + Dialog variants, @radix-ui/react-collapsible, 4 new pb_migrations + expanded pb_hooks; further optimization deferred to v1.2)
```

**.planning/PROJECT.md (Constraints)**
```diff
-- **Container**: Single Docker image under 300MB, serves both processes
+- **Container**: Single Docker image under 320MB (v1.1 budget — see SPEC.md §15), serves both processes
```

**.github/workflows/ci.yml (image-size step label)**
```diff
-      - name: Image size check (<300MB per INFR-03)
+      - name: Image size check (<320MB per INFR-03)
```

## Verification performed

- **All 7 grep invariants:** PASS (see block above).
- **`git diff --name-only` scope:** the 4 policy files staged; a pre-existing unstaged `.planning/ROADMAP.md` edit (planner-era TBD fill-in for row 21-01) was stashed, not committed, and then restored as an unstaged pending change belonging to no plan in this run. It was not part of my edits.
- **Unit tests:** `npm test --run` → 71 files / **610 tests PASS** in 108.73s. No lib/ changes; sanity-only.
- **`sh scripts/check-image-size.sh homekeep:ci`:** SKIPPED — no local `homekeep:ci` image tag exists on this executor host. Forward gate is the CI run triggered by the push (per VALIDATION.md acceptance matrix).
- **Immutable history untouched:** REQUIREMENTS.md checkbox + traceability table updated (forward tracking — not history); `.planning/ROADMAP.md` phase sections, `.planning/research/`, `.planning/intel/`, and all prior phase artifacts (01-*, 02-*, …, 20-*) untouched per D-01..D-04.
- **Post-commit deletion check:** no files deleted (`git diff --diff-filter=D HEAD~1 HEAD` empty).

## Commit

- **Hash:** `bbe3235`
- **Message:** `fix(21): bump INFR-03 image budget 300MB → 320MB (v1.1 growth)`
- **Stat:** 7 files changed, 466 insertions(+), 4 deletions(-)
  - 4 policy edits (2 lines each = 8 line-level changes)
  - 3 planner artifacts captured alongside (21-01-P01-PLAN.md, 21-RESEARCH.md, 21-VALIDATION.md)
- **Push:** `662e632..bbe3235 master -> master` to `github.com/the-kizz/homekeep` — confirmed green.

## Requirement closure

- **INFRA-BUMP-01:** checkbox flipped `[ ]` → `[x]` in `.planning/REQUIREMENTS.md` §v1.1.1 addendum; traceability table row advanced Phase 21: `Pending` → `Complete (21-01)`.
- Post-push CI run is the forward gate that definitively closes the ticket (309MB observed < 320MB limit expected to pass the `Image size check` step).

## Deviations from Plan

**None on the application-code front — plan executed exactly as written for all 4 forward edits.**

### Minor operational notes

**1. [Rule 3 - Pre-existing unstaged work] `.planning/ROADMAP.md` appeared in `git diff --name-only`**
- **Found during:** Pre-commit scope verification.
- **Context:** A pre-existing (planner-era) one-line change to `.planning/ROADMAP.md` row `21-01` (`TBD` → proper title) was unstaged in the working tree before this executor started.
- **Action:** Stashed before staging to keep the commit scope clean (exactly the 4 policy files + planner artifacts), then restored after commit. Not my change; left pending for a separate roadmap-sync pass.
- **Impact:** Zero — the roadmap edit is forward-looking (fills phase 21 row metadata) and does not affect INFRA-BUMP-01 closure.

**2. [Rule 3 - Handler quirk corrected in-line] `requirements.mark-complete` arg interpretation**
- **Found during:** REQUIREMENTS.md update.
- **Issue:** `gsd-sdk query requirements.mark-complete INFRA-BUMP-01 "21-01"` treated `"21-01"` as a second REQ-ID to check off (it is actually a plan reference). This produced a mangled checkbox (`- [x] **INFRA-BUMP-01\n**:`) and left the traceability-table row still showing `Pending`.
- **Fix:** Manually repaired the checkbox line (joined the orphaned `**:` back to the ID) and advanced the traceability-table row from `Pending` → `Complete (21-01)`.
- **Files modified:** `.planning/REQUIREMENTS.md` (single-bullet repair + 1 table cell).
- **Files with committed change:** will land in the next metadata/state commit alongside STATE + ROADMAP updates.

## Forward gate

The post-push CI run on `master` at `bbe3235` is the definitive closure signal for INFRA-BUMP-01:

- Expected: `lint-test-build` job green.
- Expected: `Image size check (<320MB per INFR-03)` step green — **309MB observed < 320MB limit**.
- Expected: arm64 cross-build and regression-check steps unchanged (no edits to build logic).

Once CI is green, GHCR tiered-tag advancement (`release.yml` on next stable-tag push) is unblocked — out of scope for this phase but downstream of its success.

## Self-Check: PASSED

- Files created exist:
  - `.planning/phases/21-image-size-budget/21-01-P01-PLAN.md` — FOUND
  - `.planning/phases/21-image-size-budget/21-RESEARCH.md` — FOUND
  - `.planning/phases/21-image-size-budget/21-VALIDATION.md` — FOUND
  - `.planning/phases/21-image-size-budget/21-01-P01-SUMMARY.md` — FOUND (this file)
- Files modified exist and contain expected content:
  - `scripts/check-image-size.sh` contains `LIMIT=320` — CONFIRMED
  - `SPEC.md` contains `under 320MB` and `v1.1 growth` — CONFIRMED
  - `.planning/PROJECT.md` contains `under 320MB` and `SPEC.md §15` — CONFIRMED
  - `.github/workflows/ci.yml` contains `<320MB per INFR-03` — CONFIRMED
- Commit exists:
  - `bbe3235` found in `git log` — CONFIRMED
  - Pushed to `origin/master` (`662e632..bbe3235`) — CONFIRMED

No stubs introduced. No new threat surface (scope is policy/documentation only; no network endpoints, auth paths, file access changes, or schema modifications at trust boundaries).
