# Phase 21: Image Size Budget Adjustment — Research

**Researched:** 2026-04-22
**Domain:** Policy/config update (no design work)
**Confidence:** HIGH — all claims VERIFIED via grep + Read

## Summary

Trivial three-file edit to raise the INFR-03 ceiling from 300MB → 320MB. CI currently fails at 309MB. Enforcement is centralized in one shell script; no duplicate inline size checks exist in other workflows.

**Primary recommendation:** Edit three lines (script LIMIT, SPEC.md §15 bullet, PROJECT.md Constraints bullet) + CI workflow step-name label. Everything else (REQUIREMENTS.md, ROADMAP.md, .planning/research/*, historical phase docs) is immutable history — do NOT edit.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** new budget = 320MB (309MB observed + 11MB headroom)
- **D-02:** rationale documented in SPEC.md §15 + PROJECT.md — v1.1 added ~9MB (8 new shadcn UI components, @radix-ui/react-collapsible, 4 new pb_migrations, expanded pb_hooks)
- **D-03:** no docker-layer optimization this phase (deferred to v1.2)
- **D-04:** no retroactive multi-arch rebuild — policy update lets NEXT CI push pass

### Claude's Discretion
- Exact wording of the rationale note in SPEC.md §15 and PROJECT.md
- Whether to also update the CI step-name label `Image size check (<300MB per INFR-03)` (recommend: YES — currently misleading)

### Deferred Ideas (OUT OF SCOPE)
- Actual image optimization pass
- Splitting base runtime vs app image
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INFRA-BUMP-01 | Adjust INFR-03 budget 300→320MB + documented rationale; CI green on push | Exact edit locations confirmed below (3 source-of-truth files + 1 CI label) |
</phase_requirements>

## Exact Edit Targets

| # | File | Line | Current | Change To |
|---|------|------|---------|-----------|
| 1 | `scripts/check-image-size.sh` | 6 | `LIMIT=300` | `LIMIT=320` |
| 2 | `SPEC.md` | 469 | `- **Final image target:** under 300MB` | `- **Final image target:** under 320MB` (+ append v1.1 rationale sub-bullet per D-02) |
| 3 | `.planning/PROJECT.md` | 80 | `- **Container**: Single Docker image under 300MB, serves both processes` | `- **Container**: Single Docker image under 320MB (raised from 300MB in v1.1 — see SPEC.md §15), serves both processes` |
| 4 | `.github/workflows/ci.yml` | 77 | `- name: Image size check (<300MB per INFR-03)` | `- name: Image size check (<320MB per INFR-03)` — label only; run line (78) is unchanged (just invokes the script) |

## Grep Audit: All Occurrences of "300MB" / "INFR-03"

**Source-of-truth files to edit (4):** lines enumerated above.

**Immutable history — DO NOT EDIT:**
- `.planning/REQUIREMENTS.md` L168-169, L492 — v1.0 requirements ledger; INFR-03 was delivered at 300MB and remains historically correct. INFRA-BUMP-01 (L646) is the forward record.
- `.planning/milestones/v1.1-REQUIREMENTS.md` L168, L169, L492 — duplicate of REQUIREMENTS.md (milestone snapshot).
- `.planning/ROADMAP.md` L48, L448, L456, L457 — Phase 21 entry already documents the 300→320 bump; nothing to rewrite.
- `.planning/research/STACK.md` L117, `.planning/research/ARCHITECTURE.md` L380 — historical research artifacts.
- `.planning/phases/01-*/` (12 matches) — Phase 1 historical plans/summaries/verification. Phase-local.
- `.planning/phases/07.1-*/07.1-SUMMARY.md` L42 — historical deploy checkpoint record.
- `.planning/phases/21-image-size-budget/21-CONTEXT.md` — already correct.

**Principle:** These are append-only historical records (REQUIREMENTS, ROADMAP, phase summaries, research). Rewriting them would violate the GSD doctrine that phase artifacts are immutable. The forward truth lives in SPEC.md + PROJECT.md + the script.

## Duplicate Logic Audit

- `.github/workflows/ci.yml` L77-78 — the ONLY size check. It calls `scripts/check-image-size.sh`; no inline LIMIT literal to keep in sync beyond the step-name label.
- `.github/workflows/release.yml` — grep for `size` / `check-image-size`: **no matches**. No inline check.
- `.github/workflows/edge.yml` — grep for `size` / `check-image-size`: **no matches**. No inline check.

Single source of truth confirmed. [VERIFIED: grep + Read]

## Don't Hand-Roll / Pitfalls

- **Don't rewrite REQUIREMENTS.md or ROADMAP.md in-place** — those are immutable ledgers. The new row (INFRA-BUMP-01) already exists at REQUIREMENTS.md L646.
- **Don't forget the CI step-name label** — `<300MB per INFR-03` on ci.yml L77 becomes cosmetically wrong after the bump. Low stakes but worth one keystroke.

## Sources

- `scripts/check-image-size.sh` L6 [VERIFIED: Read]
- `SPEC.md` L469 [VERIFIED: Read]
- `.planning/PROJECT.md` L80 [VERIFIED: Read]
- `.github/workflows/ci.yml` L77-78 [VERIFIED: Read]
- `.github/workflows/{release,edge}.yml` [VERIFIED: Grep returned no matches for size checks]
