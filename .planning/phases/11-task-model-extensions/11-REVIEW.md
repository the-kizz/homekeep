---
phase: 11-task-model-extensions
reviewed: 2026-04-22T00:00:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - components/band-view.tsx
  - components/task-band.tsx
  - lib/actions/completions.ts
  - lib/coverage.ts
  - lib/schemas/task.ts
  - lib/task-scheduling.ts
  - pocketbase/pb_migrations/1745280001_task_extensions.js
  - tests/unit/coverage.test.ts
  - tests/unit/task-extensions-integration.test.ts
  - tests/unit/task-extensions.test.ts
  - tests/unit/task-scheduling.test.ts
findings:
  critical: 0
  warning: 3
  info: 4
  total: 7
status: issues_found
---

# Phase 11: Code Review Report

**Reviewed:** 2026-04-22T00:00:00Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Phase 11 lands four new nullable task fields (`due_date`, `preferred_days`, `active_from_month`, `active_to_month`), flips `frequency_days` nullable for OOFT, and inserts three new branches into `computeNextDue` (seasonal-dormant, seasonal-wakeup, OOFT). The core pure helpers (`isInActiveWindow`, `nextWindowOpenDate`, `wasInPriorSeason`, `narrowToPreferredDays`, `effectivePreferredDays`) are cleanly written, well-documented, and exhaustively unit-tested. The zod refinements all correctly route errors to a user-facing field via `path:`. The branch order in `computeNextDue` is correct for the documented matrix, and `computeTaskBands` / `computeCoverage` silently skip tasks whose next-due is null (so dormant and completed-OOFT tasks disappear from bands and — in coverage — are excluded via an explicit `isDormant` filter).

The `completeTaskAction` batch extension for OOFT archiving is well-scoped: a single PB transaction bundles completion + (optional) override-consumption + (optional) OOFT-archive, preserving rollback semantics end-to-end. The dual-marker OOFT recognition (`frequency_days === null || === 0`) is consistent across `computeNextDue`, the action, and the scheduling tests — the PB 0.37.1 storage quirk is handled with matching guards in every path that needs them.

Three real issues surfaced during the review, all concentrated in the cross-seam between OOFT tasks and coverage arithmetic, plus the partial wiring of the new `timezone?` parameter into `computeNextDue` call-sites:

1. **`computeCoverage` divides by null for unborn OOFT tasks** — produces `NaN` coverage when an uncompleted OOFT with a `due_date` sits in a home. The in-file JSDoc comment claims `computeNextDue` returns `null` for OOFT, but the actual OOFT branch returns `task.due_date` (a non-null Date) for the no-completion case. Visible downstream as a `NaN%` coverage ring.
2. **`computeTaskBands` and `completeTaskAction` omit the new `timezone` argument to `computeNextDue`** — seasonal wake-up dates are anchored to UTC midnight instead of home-tz midnight when rendered in bands or reported in the success toast. The capability lands in `computeNextDue` but the main call-sites don't use it.
3. **The `frequency_days as number` cast in `components/task-band.tsx`** is a lie for OOFT tasks whose `computeNextDue` returned a concrete `due_date`. The cast comment asserts non-null guarantee, but null OOFT tasks can legitimately reach bands.

All three are Warning-level: they produce incorrect UI output but don't corrupt data, bypass auth, or crash the process. A test matrix addition in `tests/unit/coverage.test.ts` for the OOFT case and a signature audit of `computeNextDue` callers would close the bundle.

## Warnings

### WR-01: `computeCoverage` divides by `null` for unborn OOFT tasks → `NaN` coverage

**File:** `lib/coverage.ts:96-102`
**Issue:** The inline comment at lines 96-98 asserts: "computeNextDue above returns null for OOFT... reaching this line implies a non-null number — cast is safe." This is incorrect. `computeNextDue`'s OOFT branch (task-scheduling.ts:262-265) returns `task.due_date` as a Date when the task has no completion:

```ts
if (isOoft) {
  if (lastCompletion) return null;
  return task.due_date ? new Date(task.due_date) : null;
}
```

So an uncompleted OOFT task with a `due_date` set reaches line 90's `const nextDue = computeNextDue(...)` with a non-null Date, then proceeds to line 101 with `task.frequency_days === null`. JavaScript coerces `null` to `0` in the division `overdueDays / (task.frequency_days as number)`:

- Due date in future → `overdueDays = 0` → `0 / 0 = NaN` → `health = NaN` → `sum = NaN` → coverage = `NaN`.
- Due date in past → `overdueDays > 0` → `n / 0 = Infinity` → `1 - Infinity = -Infinity` → `Math.max(0, -Infinity) = 0`. Health lands at 0 accidentally — semantically tolerable but via the wrong path.

The NaN case is the visible bug: `Math.round(NaN * 100) = NaN`, and the coverage ring would render `NaN%`. `detectAreaCelebration` also routes through `computeAreaCoverage → computeCoverage`, so area celebration misfires silently (NaN comparisons are always false).

No test in `tests/unit/coverage.test.ts` covers OOFT tasks, which is why the 410-test suite remains green while this lurks.

**Fix:** Skip OOFT tasks in the health sum the same way dormant tasks are skipped, OR guard the division. Minimal patch:

```ts
for (const task of active) {
  const last = latestByTask.get(task.id) ?? null;
  const override = overridesByTask.get(task.id);
  const nextDue = computeNextDue(task, last, now, override);
  if (!nextDue) continue;
  // Phase 11 (WR-01): OOFT tasks (frequency_days null or 0 storage-quirk)
  // have no cycle to normalize against. An unborn OOFT contributes no
  // coverage signal — treat it like dormant (exclude from mean). A completed
  // OOFT is archived atomically by completeTaskAction; reaching here with a
  // completed OOFT is a race-window-only state also safely skipped.
  const freq = task.frequency_days;
  if (freq === null || freq === 0) continue;
  const overdueDays = Math.max(
    0,
    (now.getTime() - nextDue.getTime()) / 86400000,
  );
  const health = Math.max(0, Math.min(1, 1 - overdueDays / freq));
  sum += health;
  counted += 1;
}
```

Also add two regression tests to `tests/unit/coverage.test.ts`:

```ts
test('unborn OOFT (freq=null, future due_date) excluded from mean (WR-01)', () => {
  const now = new Date('2026-04-20T12:00:00.000Z');
  const ooft = makeTask({
    id: 't-ooft',
    frequency_days: null as unknown as number,
    due_date: '2026-05-01T00:00:00.000Z',
  } as Partial<Task>);
  // Only task is an unborn OOFT → excluded → empty-home invariant → 1.0.
  // Without the fix this returns NaN.
  expect(computeCoverage([ooft], new Map(), new Map(), now)).toBe(1.0);
});

test('unborn OOFT coexists with healthy recurring → mean of recurring only', () => {
  const now = new Date('2026-04-20T12:00:00.000Z');
  const healthy = makeTask({ id: 't-h', frequency_days: 7 });
  const ooft = makeTask({
    id: 't-o',
    frequency_days: null as unknown as number,
    due_date: '2026-05-01T00:00:00.000Z',
  } as Partial<Task>);
  const latest = new Map<string, CompletionRecord>();
  latest.set('t-h', makeCompletion('t-h', now.toISOString()));
  expect(
    computeCoverage([healthy, ooft], latest, new Map(), now),
  ).toBeCloseTo(1.0, 10);
});
```

### WR-02: `computeNextDue` callers omit `timezone` — seasonal wake-up anchored to UTC midnight in bands and completion toast

**File:** `lib/band-classification.ts:80`, `lib/actions/completions.ts:359-371`, `lib/coverage.ts:90`
**Issue:** Plan 11-02 added the optional 5th `timezone?` parameter to `computeNextDue` (task-scheduling.ts:141) so seasonal branches can extract "current month in home tz" and anchor wake-up to "home-tz midnight." The parameter defaults to `undefined` → UTC fallback. Three production call-sites omit the argument:

- `lib/band-classification.ts:80` — `computeNextDue(task, last, now, override)` — no 5th arg. `computeTaskBands` *does* receive `timezone` (it uses it for `localMidnightTodayUtc`) but does not thread it into the per-task `computeNextDue` call.
- `lib/actions/completions.ts:359-371` — the success-toast next-due calculation omits `timezone`, then formats the result via `formatInTimeZone(nextDue, home.timezone, 'MMM d, yyyy')`. For a seasonal task waking up, the underlying instant is UTC-anchored, which may render as the wrong calendar day in a non-UTC home.
- `lib/coverage.ts:90` — documented as acceptable (UTC-month fallback for coverage is explicit in the module JSDoc). Noted here for completeness; see IN-01.

The integration test at `tests/unit/task-scheduling.test.ts:584-602` proves `computeNextDue` *does* the right thing for Australia/Perth when the caller passes the 5th argument — but the production paths aren't calling it that way. Net effect: a home in Perth with a seasonal task in wake-up will see its "Next due" row in the band land on (for example) Sep 30 instead of Oct 1, because Oct 1 UTC midnight = Sep 30 08:00 Perth → the band-classification boundary comparison against `localMidnightTodayUtc` (which IS in home tz) classifies it one day early and the toast formats it one day early.

**Fix:** Thread `timezone` through the two call-sites that render to users. Coverage can keep its UTC-month fallback per its JSDoc.

```ts
// lib/band-classification.ts:80
const nextDue = computeNextDue(task, last, now, override, timezone);
```

```ts
// lib/actions/completions.ts:359-371
const nextDue = computeNextDue(
  {
    id: task.id,
    created: task.created as string,
    archived: false,
    frequency_days: task.frequency_days as number,
    schedule_mode: task.schedule_mode as 'cycle' | 'anchored',
    anchor_date: (task.anchor_date as string | null) || null,
    // Phase 11 (WR-02): seasonal branches need the home-tz anchor to
    // match the formatInTimeZone rendering below.
    active_from_month: (task.active_from_month as number | null) ?? null,
    active_to_month: (task.active_to_month as number | null) ?? null,
    due_date: (task.due_date as string | null) ?? null,
  },
  { completed_at: now.toISOString() },
  now,
  undefined,
  home.timezone as string,
);
```

Also note: the action's `task.getOne` field-list (line 117-118) does NOT currently select `active_from_month`, `active_to_month`, or `due_date`. Expand it before wiring timezone, or those fields arrive `undefined` on the `Task` shape and the seasonal branches never fire.

Regression test (add to `tests/unit/band-classification.test.ts` — file not in scope here but the test should exist):

```ts
test('seasonal task wake-up anchors to home-tz midnight when timezone passed through', () => {
  // Perth is UTC+8. Oct 1 2026 00:00 Perth = Sep 30 2026 16:00 UTC.
  const now = new Date('2026-04-15T12:00:00.000Z');
  const seasonal: Task = {
    id: 't-s',
    created: '2026-01-01T00:00:00.000Z',
    archived: false,
    frequency_days: 30,
    schedule_mode: 'cycle',
    anchor_date: null,
    active_from_month: 10,
    active_to_month: 3,
  };
  const bands = computeTaskBands(
    [seasonal],
    new Map(),
    new Map(),
    now,
    'Australia/Perth',
  );
  const classified = [...bands.overdue, ...bands.thisWeek, ...bands.horizon];
  expect(classified.length).toBe(1);
  expect(classified[0].nextDue.toISOString()).toBe(
    '2026-09-30T16:00:00.000Z',
  );
});
```

### WR-03: `frequency_days as number` cast is a lie for OOFT tasks reaching bands

**File:** `components/task-band.tsx:84, 160` (both groupByDay branches)
**Issue:** The comment asserts "classified tasks reaching this band already survived computeNextDue, so a non-null number is guaranteed." This is false for OOFT tasks — `computeNextDue`'s OOFT branch returns `new Date(task.due_date)` (non-null) when the OOFT has no completion yet. That classified task passes through `computeTaskBands` with its original `frequency_days: null` (or `0`, per the PB storage quirk) and lands in an `overdue`/`thisWeek`/`horizon` band.

The `as number` cast then hands `null` or `0` to `TaskRow` as if it were a positive integer. Downstream rendering (likely a "Every N days" label) will display `null`/`0` or arithmetic involving zero. This is cosmetic rather than data-corrupting, but the reassuring comment hides the problem from future maintainers.

Same issue in `components/band-view.tsx:424` — the TaskDetailSheet projection casts `detailTask.frequency_days as number` for OOFTs too. The comment there at least acknowledges "Plan 11-02 / Phase 15 will add OOFT-shape handling" — so the tech debt is already tracked. WR-03 is the same debt duplicated to task-band.tsx without the acknowledgement.

**Fix:** Either widen the `TaskRow` / `TaskDetailSheet` task-shape to accept `number | null` (and handle the OOFT rendering explicitly), OR pre-filter OOFT tasks out of the bands passed to `TaskBand` (matching the `isDormant` filter in coverage.ts). The second is the v1.1 scope-conservative choice — OOFT tasks only live in their `due_date` date, not in a cycle, so "Every N days" labeling is semantically meaningless anyway until Phase 15 ships OOFT UI.

Minimal patch at the band level (keeps TaskBand/TaskRow untouched for v1.1):

```ts
// components/band-view.tsx — add a filter before attachMeta maps
const filterOutOoft = (ct: ClassifiedTask) =>
  ct.frequency_days !== null && ct.frequency_days !== 0;
const overdueWithName = bands.overdue.filter(filterOutOoft).map(attachMeta);
const thisWeekWithName = bands.thisWeek.filter(filterOutOoft).map(attachMeta);
const horizonWithName = bands.horizon.filter(filterOutOoft).map(attachMeta);
```

And update the JSDoc on `task-band.tsx:82-83` and `:158-159` to say "pre-filtered by the caller so OOFT tasks never reach this cast" — so the assertion is truthful.

## Info

### IN-01: `computeCoverage` does not accept a `timezone` parameter — dormant-task check uses UTC month

**File:** `lib/coverage.ts:68-80`
**Issue:** `computeCoverage` reads `nowMonth = now.getUTCMonth() + 1` (line 70) to decide dormancy. For a seasonal task whose active window ends on month boundaries in a non-UTC home, this can misclassify one day per boundary (e.g. March 31 UTC 20:00 is April 1 in Perth — the task is "dormant" at that moment in home tz but still in-window UTC).

The module JSDoc at lines 35-39 explicitly acknowledges and accepts this trade-off ("home-timezone precision is deferred... acceptable for coverage-ring rendering"). No bug — documented design. Calling out for the next pass where this module likely grows a `timezone` arg.

**Fix:** Non-blocking. When the timezone argument is added to `computeCoverage` (likely Phase 12 or later), update the `isDormant` closure to call `toZonedTime(now, timezone).getMonth() + 1` matching the `computeNextDue` pattern.

### IN-02: `nextWindowOpenDate` accepts `to` but never uses it (unused parameter swallowed with `void to`)

**File:** `lib/task-scheduling.ts:379-398`
**Issue:** The function signature accepts `to` "for signature symmetry with isInActiveWindow and forward-compat with future wake-up heuristics" and silences the unused-var warning with `void to;` at line 388. A future maintainer may read the signature as "the function uses both endpoints" and insert a wrap-aware branch that's actually already handled upstream by `wasInPriorSeason`.

**Fix:** Non-blocking. Either remove `to` from the signature now (callers pass it but never inspect the result of that arg) or add a `// eslint-disable-next-line` style annotation with a TODO referencing the Phase 12 LOAD forward-compat plan. Current state is acceptable but slightly noisy.

### IN-03: `wasInPriorSeason` A3 365-day heuristic can misfire for near-year-length cycles

**File:** `lib/task-scheduling.ts:421-434`
**Issue:** The heuristic treats any in-window completion older than 365 days as "prior season." For a task with `frequency_days: 400` (legitimate for e.g. "replace water filter every 13 months"), a completion 366 days ago would be flagged prior-season and trigger the wake-up branch, ignoring the actual cycle. Unlikely in practice — SPEC §19 caps realistic freq at a household ceiling — but documented as A3 in the Assumptions Log and acknowledged as deferred-precision.

**Fix:** Non-blocking. The precise implementation ("walk month-by-month looking for dormancy transition") is the documented future work. This note is a nudge to track it if any future REQ relies on accurate multi-year cycles.

### IN-04: Schema refine paths for SEAS-01 route both-set-only-one errors to `active_from_month` — user fixing `active_to_month` sees no error under their field

**File:** `lib/schemas/task.ts:102-108`
**Issue:** The paired-months refine (`(d.active_from_month == null) === (d.active_to_month == null)`) sets `path: ['active_from_month']` unconditionally. If the user sets `active_to_month` but leaves `active_from_month` unset (the opposite direction), the error surfaces under `active_from_month` — which is fine (it's the field the user needs to fill in). But if the user sets `active_from_month` and forgets `active_to_month`, the error surfaces under `active_from_month` pointing at the field they already filled in correctly. Form UX may be slightly confusing.

**Fix:** Non-blocking. If form UX testing reveals confusion, split into two refines each pointing at the missing side:

```ts
.refine(
  (d) => d.active_from_month == null || d.active_to_month != null,
  { message: 'Active to month required when active from month is set',
    path: ['active_to_month'] },
)
.refine(
  (d) => d.active_to_month == null || d.active_from_month != null,
  { message: 'Active from month required when active to month is set',
    path: ['active_from_month'] },
)
```

---

_Reviewed: 2026-04-22T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
