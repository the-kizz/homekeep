# Phase 13 Validation — Nyquist Dimension 8e (Task Creation Semantics)

**Phase:** 13 — Task Creation Semantics
**Planned:** 2026-04-22
**Applies to:** Plans 13-01 (Wave 1 server-side) + 13-02 (Wave 2 client + integration)

## Purpose

Dimension 8e demands that every automated check in every `<verify>` block is a command the executor can run exactly as written — no shell quirks, no ambient state, no missing fixtures. This document enumerates the validation surface for Phase 13 and cross-references which scenario covers which REQ.

## Requirement → Evidence Map

| REQ-ID | Wave | Test Evidence (file + locator) | Runtime Evidence |
|--------|------|--------------------------------|-------------------|
| TCSEM-01 | Wave 2 | `components/forms/task-form.tsx` grep `Advanced` ≥1; grep `name="last_done"` == 1; Wave 2 Task 1 done-criteria | Form renders Advanced collapsible; cycle mode shows last_done, anchored hides it |
| TCSEM-02 | Wave 1 + 2 | `tests/unit/load-smoothing.test.ts` Tests 6+7+8 (lastDone + freq math); `tests/unit/actions/tasks-tcsem.test.ts` Test 2 (createTask threading last_done); `tests/unit/tcsem-integration.test.ts` Scenario 1 (live PB with last_done='2026-04-10') | Integration Scenario 1 asserts placedDate in tolerance window [2026-05-05..2026-05-15] around last_done+freq ideal |
| TCSEM-03 | Wave 1 | `tests/unit/load-smoothing.test.ts` Tests 1-5 + 12 (5 smart-default cases + boundary) | Plan 13-01 Task 1 unit suite |
| TCSEM-04 | Wave 1 + 2 | `tests/unit/actions/tasks-tcsem.test.ts` Test 1 (non-empty next_due_smoothed in create body) + Tests 3-4 (bypass paths null); `tests/unit/tcsem-integration.test.ts` Scenario 1 (single PB read asserts row has non-null next_due_smoothed) | Integration Scenario 1 |
| TCSEM-05 | Wave 1 + 2 | `tests/unit/actions/seed-tcsem.test.ts` Tests 3-4 (5-seed + 10-seed cohort distribution); `tests/unit/tcsem-integration.test.ts` Scenario 2 (5 same-freq seeds on live PB → Set.size ≥ 4) | Integration Scenario 2 |
| TCSEM-06 | Wave 1 + 2 | `tests/unit/actions/seed-tcsem.test.ts` Test 6 (grep-based code audit, 0 matches); `tests/unit/tcsem-integration.test.ts` Scenario 3 (runtime PB query for via='seed-stagger' returns empty) | Integration Scenario 3 + Plan 13-01 Task 3 verify command |
| TCSEM-07 | Wave 1 | No new migration; no backfill code; STATE.md records zero schema change (documented in 13-01-SUMMARY) | v1.0 tasks continue natural cadence per Phase 12 D-02 read-time fallback (already in production since Plan 12-02) |

**Coverage:** 7/7 TCSEM REQ-IDs have both unit-level and (where applicable) integration-level evidence.

## Port Allocation Register (Dimension 8e — claim verification)

| Plan | Port | Status | Grep locator |
|------|------|--------|--------------|
| 02-01 | 18090 | CLAIMED | `const PORT = 18090` |
| 03-01 | 18091 | CLAIMED | `const PORT = 18091` |
| 04-01 hook | 18092 | CLAIMED | `const PORT = 18092` |
| 04-01 rules | 18093 | CLAIMED | `const PORT = 18093` |
| 04-02 | 18094 | CLAIMED | `const PORT = 18094` |
| 05-01 | 18095 | CLAIMED | `const PORT = 18095` |
| 06-01 | 18096 | CLAIMED | `const PORT = 18096` |
| 06-02 | 18097 | CLAIMED | `const PORT = 18097` |
| 10-01 | 18098 | CLAIMED | `const PORT = 18098` |
| 11-03 | 18099 | CLAIMED | `const PORT = 18099` |
| 12-04 | 18100 | CLAIMED | `const PORT = 18100` |
| **13-02** | **18101** | **CLAIMING** | `const PORT = 18101` (new this phase) |
| Phase 14+ | 18102+ | Reserved | — |

Grep-uniqueness invariant (Nyquist 8e compliance check):

```bash
grep -rn "const PORT = 1810" tests/unit/ --include='*.ts' | wc -l
# Expected: 4 — one per disposable-PB integration suite (12-04 + 13-02 + 2 older).
# Before Plan 13-02 writes: 3. After: 4.
```

## Smart-Default Formula Lock (TCSEM-03 sanity check)

Per 13-CONTEXT.md D-01 / REQUIREMENTS.md TCSEM-03, the smart-default formulas are:

| Condition | Formula | Example |
|-----------|---------|---------|
| `freq <= 7` | `now + 1 day` (tomorrow) | freq=7 → now+1d |
| `freq in 8..90` | `now + Math.floor(freq / 4)` days | freq=30 → now+7d, freq=60 → now+15d, freq=90 → now+22d |
| `freq > 90` | `now + Math.floor(freq / 3)` days | freq=365 → now+121d |

**Boundary locks:**
- freq=7 → tomorrow (inclusive ≤7) — Test 2 asserts
- freq=8 → now+2d (cycle/4 = floor(8/4) = 2) — Test 12 asserts boundary
- freq=90 → now+22d (cycle/4 = floor(90/4) = 22, still in 8..90 bucket) — implicit; add as Test 13 if CI becomes pedantic
- freq=91 → now+30d (cycle/3 = floor(91/3) = 30) — opposite boundary; CI optional

## SDST Audit — exact command (D-12 + Task 3)

Post-Plan-13-01 audit command:

```bash
grep -rn "seed-stagger\|SDST\|seed_stagger" \
  --include="*.ts" --include="*.tsx" \
  --include="*.js" --include="*.jsx" \
  lib/ components/ tests/ pocketbase/ app/
```

Expected exit: 0 matching lines (non-zero exit status OK for grep's "no match"
convention — use `| wc -l` and assert `0` if scripting).

**Phase 18 cleanup scope (out of Phase 13):** matches in `.planning/` markdown
files are acceptable per D-11 final clause — Phase 18 docs pass cleans spec
references (DOCS-03 in REQUIREMENTS.md).

## Test Delta Projection

| Plan | Delta | Cumulative |
|------|-------|------------|
| Phase 12 baseline | — | 464 |
| 13-01 Task 1 (computeFirstIdealDate) | +12 | 476 |
| 13-01 Task 2 (createTask TCSEM) | +6 | 482 |
| 13-01 Task 3 (batchCreateSeedTasks + SDST) | +6 | 488 |
| 13-02 Task 2 (integration suite) | +3 | **491** |

Total Phase 13 delta: +27. Well above the 15-test threshold implied by
comparable Phase 12 hard-gate coverage.

## Integration Boot Pattern (Dimension 8e verification)

Plan 13-02 Task 2 copies boot pattern byte-for-byte from
`tests/unit/load-smoothing-integration.test.ts`. The pattern is:

1. **DATA_DIR hygiene**: `rmSync(DATA_DIR, { recursive: true, force: true })` + `mkdirSync(DATA_DIR, { recursive: true })`
2. **Superuser CLI before serve** (Pitfall 9 — SQLite WAL race): `spawn(PB_BIN, ['superuser', 'create', '<email>', '<pass>', '--dir', DATA_DIR])`
3. **Serve spawn** with migrations + hooks directories: `spawn(PB_BIN, ['serve', '--http', HTTP, '--dir', DATA_DIR, '--migrationsDir', './pocketbase/pb_migrations', '--hooksDir', './pocketbase/pb_hooks'])`
4. **Health poll**: `30 × 200ms` loop hitting `/api/health`
5. **vi.mock plumbing**:
   - `next/cache` → noop
   - `next/navigation` → redirect throws `REDIRECT:${url}`
   - `@/lib/pocketbase-server` → returns `currentPb`
   - `@/lib/pocketbase-admin` → returns `currentPb`
6. **afterAll**: `pbProcess?.kill()` + `rmSync(DATA_DIR)`

**Pitfalls cross-reference:**
- Pitfall 7 (tz alignment): home.timezone threads through computeHouseholdLoad + placeNextDue on BOTH sides — enforced by existing lib/load-smoothing.ts isoDateKey helper.
- Pitfall 9 (WAL race): superuser create MUST complete before serve spawns.
- Pitfall 13 (via field): tests MUST NOT create completions with via='tap' or anything other than the server-action code path.

## Rider 1 Preservation (from Phase 12)

Phase 12 closed with Rider-1 GREEN (1 cluster < 7 threshold) — default
tolerance `min(0.15 * freq, 5)` ships unchanged. Phase 13 does NOT re-open
this decision. Integration Scenario 2 (5-seed cohort distribution) uses
the SAME tolerance; if it ever bunches, that's a TCSEM-05 bug (threading
broken), not a Rider-1 revisit.

## Done Criteria (Phase 13 phase-close)

- [ ] 2 PLAN.md files committed to git (`13-01-P01-PLAN.md`, `13-02-P01-PLAN.md`)
- [ ] This VALIDATION.md committed to git
- [ ] ROADMAP.md Plans section updated with 2 plan entries + unchecked ☐
- [ ] REQUIREMENTS.md: no changes required at plan-writing time (TCSEM rows flip to ☑ on execution per plan SUMMARY)
- [ ] All 7 TCSEM REQ-IDs have at least one test-evidence row in this document
- [ ] Port 18101 appears exactly once in tests/unit/ post-execution

---

*Generated at plan time 2026-04-22; refined by /gsd-verify-work if gaps surface.*
