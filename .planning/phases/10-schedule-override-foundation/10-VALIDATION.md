---
phase: 10
phase_slug: schedule-override-foundation
gathered: 2026-04-22
source: extracted from 10-RESEARCH.md §Validation Architecture
nyquist_validation: true
---

# Phase 10 — Validation Strategy

> `workflow.nyquist_validation: true` in `.planning/config.json`.

## Test Framework

| Property | Value |
|----------|-------|
| Framework | `vitest` (same runner used across 311 existing unit tests) |
| Config file | `vitest.config.ts` in repo root; test files use `@vitest-environment node` for PB integration tests |
| Quick run command | `npm test -- schedule-overrides` (runs only files matching the pattern) |
| Full suite command | `npm test` (i.e. `vitest run`) |

## Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | Status |
|--------|----------|-----------|-------------------|--------|
| SNZE-04 | `schedule_overrides` PB collection exists with `(id, task_id, snooze_until, consumed_at, created)` and member-gated rules | integration | `npm test -- tests/unit/schedule-overrides-integration.test.ts` | Wave 0 creates file; disposable PB on port 18098; asserts collection shape + cross-home access 404s (mirrors `tests/unit/rules-member-isolation.test.ts`) |
| SNZE-05 | `computeNextDue` returns override date BEFORE natural branch; returns natural when override undefined | unit | `npm test -- tests/unit/schedule-overrides.test.ts` | Wave 0 creates file; covers: active+unconsumed → snooze_until; consumed → natural; undefined → natural; snooze_until < lastCompletion → natural (D-10 read-time filter); archived task → null regardless |
| SNZE-06 | `completeTaskAction` writes `consumed_at` on any active override in the same batch as the completion | integration | `npm test -- tests/unit/schedule-overrides-integration.test.ts` (atomic-consumption scenario) | Wave 2 appends scenario: seed task + active override → `completeTaskAction` → assert `completions` row exists AND `schedule_overrides.consumed_at` non-null |
| SNZE-09 | Coverage ring reads snoozed next_due (snoozed tasks don't drag coverage) | unit | `npm test -- tests/unit/coverage.test.ts` (override-branch scenario) | Wave 1 appends to existing file: overdue task + active override snoozing into future → `computeCoverage` returns 1.0 for that task |
| SNZE-10 | Scheduler `ref_cycle` keys on effective (post-override) next-due | unit | `npm test -- tests/unit/scheduler.test.ts` (override-ref-cycle scenario) | Wave 1 appends: task with active override → `processOverdueNotifications` builds `ref_cycle` containing override's `snooze_until` ISO, not natural next-due ISO |
| D-14 regression | All 311 existing unit + 23 E2E tests pass | full suite | `npm test && npm run test:e2e` | Infrastructure exists; only mechanical fixture-update (see Wave 0 Gaps) |

## Sampling Rate

- **Per task commit:** `npm test -- schedule-overrides` (~3–5s for new unit tests; ~15s if integration runs)
- **Per wave merge:** `npm test` — full unit suite (~60s locally, 311+ tests after Phase 10)
- **Phase gate:** Full unit suite green + `npm run test:e2e` green before `/gsd-verify-work` closes the phase

## Wave 0 Gaps (files to create)

- [ ] `tests/unit/schedule-overrides.test.ts` — pure helper logic + `computeNextDue` override branch unit tests. Covers REQ-SNZE-05.
- [ ] `tests/unit/schedule-overrides-integration.test.ts` — disposable PB on port 18098. Covers REQ-SNZE-04 (collection + rules) and REQ-SNZE-06 (atomic consumption).
- [ ] No new conftest / shared fixtures — existing disposable-PB boot pattern in `tests/unit/hooks-completions-append-only.test.ts:34-76` is the template.
- [ ] No framework install — `vitest` already wired.

## Mechanical Churn (existing test files)

- `tests/unit/task-scheduling.test.ts` — add `undefined` 4th arg to 14 existing `computeNextDue` call sites.
- `tests/unit/coverage.test.ts`, `tests/unit/band-classification.test.ts`, `tests/unit/weekly-summary.test.ts`, `tests/unit/area-coverage.test.ts`, `tests/unit/scheduler.test.ts` — update helper signatures to accept `overridesByTask: Map<string, Override>` 3rd arg; most call sites pass `new Map()`.

## Dimension 8 — Nyquist Gate Expectations

- **8a — automated verify presence:** every task in `10-01-P01`, `10-02-P01`, `10-03-P01` must have an `<automated>` block with a concrete `npm test -- …` command.
- **8b — feedback latency:** quick-run commands (`npm test -- schedule-overrides` ~3–5s; full suite ~60s) are within the "fast enough for per-task iteration" band.
- **8c — sampling continuity:** each requirement above maps to at least one test file that runs in CI (`vitest run` collects everything under `tests/unit/**`).
- **8d — Wave 0 completeness:** the two new test files listed above are the minimum; they are created in Plan 10-01 Task 2 before any Wave 1 caller wiring begins.
- **8e — VALIDATION.md exists:** this file.

---

*Phase: 10-schedule-override-foundation*
*Validation strategy gathered: 2026-04-22*
