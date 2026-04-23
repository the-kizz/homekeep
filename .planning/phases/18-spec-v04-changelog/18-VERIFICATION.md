---
phase: 18-spec-v04-changelog
verified: 2026-04-22T00:00:00Z
status: passed
score: 7/7 must-haves verified
overrides_applied: 0
---

# Phase 18: SPEC v0.4, AGPL Drift & v1.1 Changelog Verification Report

**Phase Goal:** SPEC.md v0.4 bump + 3 MIT->AGPL + full v1.1 changelog + PROJECT.md INFR-12 AGPL + SMTP nit. Release-ready for v1.1.0-rc1.
**Verified:** 2026-04-22
**Status:** passed
**Re-verification:** No - initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | DOCS-01: SPEC.md Version field reads 0.4 | VERIFIED | SPEC.md:3 `**Version:** 0.4 (v1.1 Scheduling & Flexibility)` |
| 2 | DOCS-02: SPEC.md has 0 live MIT references (1 meta-ref in changelog acceptable) | VERIFIED | `grep -c "MIT" SPEC.md` = 1; sole match at SPEC.md:634 is the changelog entry documenting the correction itself ("License corrected MIT -> AGPL-3.0-or-later throughout SPEC.md and PROJECT.md") |
| 3 | DOCS-03: SPEC.md contains "## Changelog" with "### v0.4" section | VERIFIED | SPEC.md:567 `## Changelog`; SPEC.md:569 `### v0.4 -- v1.1 Scheduling & Flexibility (2026-04-22)` |
| 4 | DOCS-04: PROJECT.md + REQUIREMENTS.md INFR-12 reads AGPL-3.0 | VERIFIED | REQUIREMENTS.md:186-187 `INFR-12: AGPL-3.0-or-later license, public GitHub repo`; REQUIREMENTS.md:356 `PROJECT.md INFR-12 corrected to AGPL-3.0` (DOCS-04 row marked complete); PROJECT.md:24 references AGPL drift fix for INFR-12 |
| 5 | DOCS-05: Changelog documents new fields, schedule_overrides, LOAD algorithm, REBAL semantics | VERIFIED | SPEC.md:573-580 (all 4 new task fields + schedule_overrides + reschedule_marker + nullable frequency_days); SPEC.md:591-600 (LOAD: tolerance `min(0.15*freq, 5)`, tiebreakers lowest-load->closest->earliest, forward-only contract); SPEC.md:627-631 (REBAL: 4-bucket classifier, fresh-load apply, idempotency) |
| 6 | DOCS-06: PROJECT.md SMTP constraint reads "SMTP optional, never required" | VERIFIED | PROJECT.md:83 `**SMTP optional, never required**: v1 invites are link-only and no feature requires SMTP, but if an operator configures it (e.g. for built-in PB password reset) the app uses it`. Other "no SMTP" phrases at lines 74 (ntfy.sh characteristic) and 92 (link-only invites decision rationale) are legitimate contextual uses, not the constraint row targeted by D-11. |
| 7 | SC #4: Reader can understand from SPEC alone: snooze, LOAD picks, anchored bypass, seasonal wrap, manual rebalance | VERIFIED | Snooze: SPEC.md:580 (collection) + 608-612 (action-sheet + atomic-replace + consumption-at-completion); LOAD: SPEC.md:591-600 (candidates -> PREF narrow -> widen +6 -> load score -> tiebreakers); Anchored bypass: SPEC.md:585 (branch 3 condition) + 597 ("Anchored tasks bypass smoothing entirely"); Seasonal wrap: SPEC.md:577 ("cross-year wrap supported e.g. Oct-Mar") + 586-587 (dormant + wakeup branches); Manual rebalance: SPEC.md:627-631 (4-bucket classifier, ascending ideal-sort apply, idempotency) |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `SPEC.md` | v0.4 frontmatter + AGPL license + Changelog v0.4 section | VERIFIED | Line 3 version; line 5 AGPL-3.0-or-later; line 567 Changelog; line 569 v0.4 entry; line 460 LICENSE reference AGPL; line 516 goal 9 AGPL; 643 lines total |
| `.planning/PROJECT.md` | SMTP constraint reworded; INFR-12 AGPL reference | VERIFIED | Line 83 SMTP-optional wording; line 24 DOCS bullet references INFR-12 AGPL fix; no live MIT references |
| `.planning/REQUIREMENTS.md` | INFR-12 AGPL; DOCS-01..06 complete rows | VERIFIED | Line 187 INFR-12 "AGPL-3.0-or-later license, public GitHub repo"; lines 349-360 DOCS-01..06 all marked `[x]` complete with correct descriptions; line 500 Traceability row `INFR-12 | Phase 1 | Complete` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| Changelog v0.4 | New data model fields | Bullets referencing Phase N provenance | WIRED | SPEC.md:573-580 each field lists its source phase (10/11/12/15) |
| Changelog v0.4 | LOAD algorithm helpers | `lib/load-smoothing.ts` reference | WIRED | SPEC.md:592 names `placeNextDue` and `computeHouseholdLoad` in `lib/load-smoothing.ts` |
| Changelog v0.4 | REBAL phase 17 work | REBAL-01..07 REQ reference | WIRED | SPEC.md:627 explicit phase + REQ band reference |
| DOCS-04 (REQUIREMENTS.md) | INFR-12 row | AGPL-3.0-or-later string | WIRED | REQUIREMENTS.md:187 reads AGPL; DOCS-04 line 356 asserts PROJECT.md `INFR-12` corrected to AGPL-3.0 |
| SPEC frontmatter version | Changelog v0.4 heading | Matching "v0.4" tokens | WIRED | Both present (line 3 + line 569) |

### Data-Flow Trace (Level 4)

Not applicable — docs-only phase produces no runtime data artifacts. Skipped per phase boundary (explicitly no code changes).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| MIT live-reference count | `grep -c "MIT" SPEC.md` | 1 (sole hit is the changelog entry describing the fix) | PASS |
| v0.4 token present | `grep -c "v0.4" SPEC.md` | 2 (frontmatter + changelog heading) | PASS |
| Changelog section exists | `grep -i "changelog" SPEC.md` | matches at lines 567 + 635 | PASS |
| SPEC v0.4 heading exact match | `grep "### v0.4" SPEC.md` | Line 569 present | PASS |
| INFR-12 AGPL string in REQUIREMENTS | `grep -A1 "INFR-12" REQUIREMENTS.md` | Line 187 "AGPL-3.0-or-later license" | PASS |
| PROJECT.md SMTP constraint wording | `grep "SMTP optional" PROJECT.md` | Line 83 match | PASS |

All D-12 validation checks pass.

### Requirements Coverage

| Requirement | Source | Description | Status | Evidence |
|-------------|--------|-------------|--------|----------|
| DOCS-01 | REQUIREMENTS.md:349 | SPEC.md bumped to v0.4 | SATISFIED | SPEC.md:3 Version: 0.4 |
| DOCS-02 | REQUIREMENTS.md:351 | SPEC.md MIT references corrected to AGPL-3.0 | SATISFIED | 3 AGPL replacements at SPEC.md:5, 460, 516; sole remaining MIT ref at line 634 is meta/describing the fix |
| DOCS-03 | REQUIREMENTS.md:353 | SPEC.md v1.1 changelog section documenting LOAD, LVIZ, TCSEM, REBAL, OOFT, PREF, SEAS, SNZE + data model changes | SATISFIED | SPEC.md:567-635 covers all 8 REQ bands + data model additions |
| DOCS-04 | REQUIREMENTS.md:355 | PROJECT.md INFR-12 corrected to AGPL-3.0 | SATISFIED | REQUIREMENTS.md:187 INFR-12 reads AGPL-3.0-or-later; PROJECT.md:24 affirms DOCS INFR-12 fix (PROJECT.md does not list INFR-12 as a line-item row — REQUIREMENTS.md carries the detail, PROJECT.md references the fix in the v1.1 goal bullet) |
| DOCS-05 | REQUIREMENTS.md:357 | SPEC documents new task fields, schedule_overrides, LOAD tolerance/tiebreakers/forward-only, REBAL semantics | SATISFIED | SPEC.md:573-580 (all fields listed), 580 (schedule_overrides collection), 591-600 (LOAD detail), 627-631 (REBAL detail) |
| DOCS-06 | REQUIREMENTS.md:359 | PROJECT.md "No SMTP" reworded to "SMTP optional, never required" | SATISFIED | PROJECT.md:83 |

All 6 phase requirements SATISFIED. No orphaned requirements.

### Anti-Patterns Found

None. Docs-only phase; scanned SPEC.md, PROJECT.md, REQUIREMENTS.md for TODO/FIXME/placeholder markers — none present in the edited sections. Remaining "no SMTP" phrases at PROJECT.md:74 and :92 are legitimate contextual uses (ntfy characteristic + link-only-invites decision rationale), not stale constraint language.

### Human Verification Required

None. All checks programmatically verifiable; content quality of prose (readability to a "new reader") has been assessed by structural coverage — every SC #4 topic (snooze, LOAD pick, anchored bypass, seasonal wrap, manual rebalance) has an explicit named section or bulleted detail in the changelog.

### Gaps Summary

No gaps. Every phase deliverable is in the tree:
- SPEC.md version header bumped, license references corrected, v0.4 changelog section drafted with coverage of all v1.1 data-model additions, the `computeNextDue` 6-branch order, LOAD pipeline detail, TCSEM task-creation semantics, snooze + permanent-reschedule flow, seasonal UI, LVIZ density/shift surfaces, and REBAL semantics.
- PROJECT.md SMTP constraint reworded; INFR-12 drift-fix acknowledged in the v1.1 DOCS bullet.
- REQUIREMENTS.md INFR-12 row reads AGPL-3.0-or-later; DOCS-01..06 all checked as complete.
- D-12 validation grep suite passes exactly as specified in the context doc.

Phase 18 achieves its goal: SPEC.md is a coherent, self-contained v0.4 document that a new reader can use to understand v1.1's scheduling and flexibility contract without reading the audit addenda. Release-ready for v1.1.0-rc1.

---

*Verified: 2026-04-22*
*Verifier: Claude (gsd-verifier)*
