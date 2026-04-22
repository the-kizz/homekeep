import { describe, expect, test } from 'vitest';
import { addDays, differenceInDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import {
  computeHouseholdLoad,
  isoDateKey,
  placeNextDue,
  type PlaceOptions,
} from '@/lib/load-smoothing';
import type { Completion, Task } from '@/lib/task-scheduling';
import type { CompletionRecord } from '@/lib/completions';
import type { Override } from '@/lib/schedule-overrides';

/**
 * Phase 12 Plan 12-01 Task 3 — unit tests for the pure helpers:
 *   - placeNextDue   (LOAD-03, LOAD-04, LOAD-05, LOAD-11, LOAD-12)
 *   - computeHouseholdLoad (LOAD-08, LOAD-09, LOAD-14)
 *
 * Tests the NEW helpers only — the branch-composition matrix for
 * `computeNextDue`'s smoothed branch belongs to Phase 12 Wave 2
 * (`tests/unit/task-scheduling.test.ts` additions).
 *
 * Determinism: all fixtures use the fixed reference instant NOW =
 * 2026-05-01T00:00:00.000Z (Friday UTC). All dates below reference
 * this Friday as the baseline.
 *
 * Day-of-week reference (UTC, for preferred_days narrowing):
 *   2026-05-01 Fri  | 2026-05-02 Sat  | 2026-05-03 Sun
 *   2026-05-04 Mon  | 2026-05-05 Tue  | 2026-05-06 Wed  | 2026-05-07 Thu
 *   2026-05-08 Fri  | 2026-05-09 Sat  | 2026-05-10 Sun
 */

// Deterministic now — 2026-05-01 UTC is a Friday.
const NOW = new Date('2026-05-01T00:00:00.000Z');
const TZ = 'UTC';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    created: '2026-04-01T00:00:00.000Z',
    archived: false,
    frequency_days: 7,
    schedule_mode: 'cycle',
    anchor_date: null,
    due_date: null,
    preferred_days: null,
    active_from_month: null,
    active_to_month: null,
    next_due_smoothed: null,
    ...overrides,
  };
}

function makeCompletion(completed_at: string): Completion {
  return { completed_at };
}

function makeCompletionRecord(
  task_id: string,
  completed_at: string,
): CompletionRecord {
  return {
    id: `c-${task_id}-${completed_at}`,
    task_id,
    completed_by_id: 'u1',
    completed_at,
    notes: '',
    via: 'tap',
  };
}

function makeOverride(
  task_id: string,
  snooze_until: string,
): Override {
  return {
    id: `o-${task_id}`,
    task_id,
    snooze_until,
    consumed_at: null,
    created_by_id: 'u1',
    created: '2026-04-15T00:00:00.000Z',
  };
}

// ─── placeNextDue tests ─────────────────────────────────────────────────

describe('placeNextDue', () => {
  test('T1: freq=1 (tolerance floor=0) returns natural_ideal verbatim', () => {
    // tolerance = floor(0.15 * 1) = 0 → single candidate = natural_ideal.
    // Completed Apr 30; naturalIdeal = May 1 (same day as NOW).
    const task = makeTask({ frequency_days: 1 });
    const completion = makeCompletion('2026-04-30T00:00:00.000Z');
    const load = new Map<string, number>();

    const result = placeNextDue(task, completion, load, NOW, { timezone: TZ });
    const expected = new Date('2026-05-01T00:00:00.000Z');
    expect(result.getTime()).toEqual(expected.getTime());
  });

  test('T2: tolerance default formula — freq=7,30,365 → floor(0.15*freq) capped at 5', () => {
    // Formula: min(floor(0.15*freq), 5).
    //   freq=7   → floor(1.05) = 1  → 3 candidates (±1)
    //   freq=30  → floor(4.5)  = 4  → 9 candidates (±4)
    //   freq=365 → min(floor(54.75)=54, 5) = 5 → 11 candidates (±5)
    //
    // Probe via load-map seeding: if we seed every day in
    // [naturalIdeal - 6, naturalIdeal + 6] with load=1 (uniform), the
    // tiebreak chain (equal score → closest-to-ideal → earliest) picks
    // naturalIdeal itself. The distance from naturalIdeal MUST be
    // within [-tolerance, +tolerance]. The DIFFERENCE in returned date
    // from naturalIdeal confirms the candidate window width indirectly.
    //
    // More directly: if we instead seed all candidates in the expected
    // window equally AND the date just outside (naturalIdeal ± (tol+1))
    // with LOWER load, we'd see whether the outer day was considered.
    // But tolerance bounds the SEARCH space; it never pulls in
    // outsiders. So we just verify placement lands within [-tol, +tol].
    for (const [freq, expectedTolerance] of [
      [7, 1],
      [30, 4],
      [365, 5],
    ] as const) {
      const task = makeTask({ frequency_days: freq });
      const completion = makeCompletion('2026-03-01T00:00:00.000Z');
      const naturalIdeal = addDays(new Date(completion.completed_at), freq);

      // Uniform load=1 across a wide band so lowest-score tiebreaker
      // cannot distinguish; closest-to-ideal should then pick
      // naturalIdeal itself, with distance ≤ tolerance by construction.
      const load = new Map<string, number>();
      for (let off = -10; off <= 10; off++) {
        load.set(isoDateKey(addDays(naturalIdeal, off), TZ), 1);
      }

      const result = placeNextDue(task, completion, load, NOW, {
        timezone: TZ,
      });
      const dist = Math.abs(differenceInDays(result, naturalIdeal));
      expect(
        dist,
        `freq=${freq} placement landed ${dist}d from ideal (expected ≤ ${expectedTolerance})`,
      ).toBeLessThanOrEqual(expectedTolerance);
      // With uniform load + no PREF, distance-to-ideal tiebreaker
      // should pick naturalIdeal (distance 0).
      expect(dist).toEqual(0);
    }
  });

  test('T3: options.tolerance overrides default (tolerance=0 → single candidate = natural_ideal)', () => {
    // freq=30 would normally give tolerance=4 (9 candidates). Override
    // via options.tolerance=0 → single candidate = naturalIdeal. Even
    // if we seed naturalIdeal with heavy load, there's no alternative,
    // so placement returns it.
    const task = makeTask({ frequency_days: 30 });
    const completion = makeCompletion('2026-04-01T00:00:00.000Z');
    const naturalIdeal = addDays(new Date(completion.completed_at), 30);

    const load = new Map<string, number>();
    load.set(isoDateKey(naturalIdeal, TZ), 999);
    // Seed neighbors with 0 — they'd be picked if tolerance were > 0.
    load.set(isoDateKey(addDays(naturalIdeal, -1), TZ), 0);
    load.set(isoDateKey(addDays(naturalIdeal, 1), TZ), 0);

    const opts: PlaceOptions = { tolerance: 0, timezone: TZ };
    const result = placeNextDue(task, completion, load, NOW, opts);
    expect(result.getTime()).toEqual(naturalIdeal.getTime());
  });

  test('T4: candidates span natural_ideal ± tolerance inclusive', () => {
    // freq=7, tolerance=1 → candidates = [ideal-1, ideal, ideal+1].
    // Seed all 3 with load=5 (equal), outside days (ideal-2, ideal+2)
    // with load=0. If outer days were considered, placement would
    // pick one (lower load wins). They shouldn't be.
    const task = makeTask({ frequency_days: 7 });
    const completion = makeCompletion('2026-04-24T00:00:00.000Z');
    const naturalIdeal = addDays(new Date(completion.completed_at), 7); // May 1

    const load = new Map<string, number>();
    load.set(isoDateKey(addDays(naturalIdeal, -1), TZ), 5);
    load.set(isoDateKey(naturalIdeal, TZ), 5);
    load.set(isoDateKey(addDays(naturalIdeal, 1), TZ), 5);
    // Outside the tolerance window: low load. MUST NOT be picked.
    load.set(isoDateKey(addDays(naturalIdeal, -2), TZ), 0);
    load.set(isoDateKey(addDays(naturalIdeal, 2), TZ), 0);

    const result = placeNextDue(task, completion, load, NOW, { timezone: TZ });
    const dist = Math.abs(differenceInDays(result, naturalIdeal));
    expect(dist).toBeLessThanOrEqual(1); // inside the ±1 window
    // Among equal-load candidates, closest-to-ideal wins → naturalIdeal.
    expect(dist).toEqual(0);
  });

  test('T5: PREF weekend narrows BEFORE load scoring (LOAD-05 hard constraint)', () => {
    // freq=14, tolerance=2 → 5 candidates. lastCompletion Apr 18 (Sat)
    // → naturalIdeal = May 2 (Sat). Window = [Apr 30 Thu, May 1 Fri,
    // May 2 Sat, May 3 Sun, May 4 Mon].
    // Weekend candidates: [May 2 Sat, May 3 Sun] — seed with load=10.
    // Weekday candidates: [Apr 30, May 1, May 4] — seed with load=0.
    // preferred_days='weekend' → weekend candidates narrowed first.
    // Placement MUST be a weekend date even though weekdays have lower
    // load (LOAD-05: PREF is a hard constraint, applied BEFORE load).
    const task = makeTask({
      frequency_days: 14,
      preferred_days: 'weekend',
    });
    const completion = makeCompletion('2026-04-18T00:00:00.000Z'); // Sat
    const naturalIdeal = addDays(new Date(completion.completed_at), 14); // May 2 Sat

    const load = new Map<string, number>();
    load.set(isoDateKey(addDays(naturalIdeal, -2), TZ), 0); // Apr 30 Thu
    load.set(isoDateKey(addDays(naturalIdeal, -1), TZ), 0); // May 1 Fri
    load.set(isoDateKey(naturalIdeal, TZ), 10);             // May 2 Sat
    load.set(isoDateKey(addDays(naturalIdeal, 1), TZ), 10); // May 3 Sun
    load.set(isoDateKey(addDays(naturalIdeal, 2), TZ), 0);  // May 4 Mon

    const result = placeNextDue(task, completion, load, NOW, { timezone: TZ });
    const dow = result.getUTCDay();
    expect(
      dow === 0 || dow === 6,
      `placement landed on getUTCDay=${dow}, expected weekend (0 or 6)`,
    ).toBe(true);
  });

  test('T6: PREF empty window widens forward +1..+6 (PREF-03)', () => {
    // freq=7, tolerance=1. lastCompletion Apr 28 (Tue) → naturalIdeal
    // = May 5 (Tue). Window = [May 4 Mon, May 5 Tue, May 6 Wed] — no
    // weekend days. preferred_days='weekend' → narrow returns empty
    // → widen forward from (naturalIdeal + tolerance + 1) = May 7 Thu
    // up through May 10 Sun.
    //   widen=1 → May 7 Thu (weekday, fail)
    //   widen=2 → May 8 Fri (weekday, fail)
    //   widen=3 → May 9 Sat (MATCH)
    // Result: May 9.
    const task = makeTask({
      frequency_days: 7,
      preferred_days: 'weekend',
    });
    const completion = makeCompletion('2026-04-28T00:00:00.000Z'); // Tue
    const load = new Map<string, number>();

    const result = placeNextDue(task, completion, load, NOW, { timezone: TZ });
    const expected = new Date('2026-05-09T00:00:00.000Z'); // Sat
    expect(result.getTime()).toEqual(expected.getTime());
  });

  test('T7: tiebreakers — equal load → closest-to-ideal wins; equal load + equal distance → earliest wins', () => {
    // freq=7, tolerance=1. lastCompletion Apr 24 (Fri) → naturalIdeal
    // = May 1 (Fri). Candidates: Apr 30, May 1, May 2.
    //
    // Case A — equal load, different distance: seed all 3 with load=2.
    // closest-to-ideal wins → May 1 (distance 0 beats ±1).
    const task = makeTask({ frequency_days: 7 });
    const completion = makeCompletion('2026-04-24T00:00:00.000Z'); // Fri
    const naturalIdeal = addDays(new Date(completion.completed_at), 7); // May 1
    const loadA = new Map<string, number>();
    loadA.set(isoDateKey(addDays(naturalIdeal, -1), TZ), 2);
    loadA.set(isoDateKey(naturalIdeal, TZ), 2);
    loadA.set(isoDateKey(addDays(naturalIdeal, 1), TZ), 2);
    const resultA = placeNextDue(task, completion, loadA, NOW, {
      timezone: TZ,
    });
    expect(resultA.getTime()).toEqual(naturalIdeal.getTime());

    // Case B — equal load AND equal distance: seed naturalIdeal with
    // HIGHER load (exclude it), and the two neighbors with equal load
    // + equal distance (±1 both). earliest wins → ideal-1 (Apr 30).
    const loadB = new Map<string, number>();
    loadB.set(isoDateKey(addDays(naturalIdeal, -1), TZ), 1);
    loadB.set(isoDateKey(naturalIdeal, TZ), 999); // out of contention
    loadB.set(isoDateKey(addDays(naturalIdeal, 1), TZ), 1);
    const resultB = placeNextDue(task, completion, loadB, NOW, {
      timezone: TZ,
    });
    expect(resultB.getTime()).toEqual(
      addDays(naturalIdeal, -1).getTime(),
    );
  });

  test('T8: forward-only — calling placeNextDue does NOT mutate input Map or task', () => {
    const task = makeTask({ frequency_days: 14 });
    const completion = makeCompletion('2026-04-18T00:00:00.000Z');
    const naturalIdeal = addDays(new Date(completion.completed_at), 14);
    const load = new Map<string, number>();
    for (let off = -3; off <= 3; off++) {
      load.set(isoDateKey(addDays(naturalIdeal, off), TZ), off + 5);
    }

    // Snapshot BEFORE.
    const preEntries = Array.from(load.entries()).sort();
    const preTaskJson = JSON.stringify(task);

    placeNextDue(task, completion, load, NOW, { timezone: TZ });

    // Snapshot AFTER — must equal pre-snapshot.
    const postEntries = Array.from(load.entries()).sort();
    expect(postEntries).toEqual(preEntries);
    expect(JSON.stringify(task)).toEqual(preTaskJson);
  });

  test('T9: throws when task.schedule_mode === "anchored" (LOAD-06 defense-in-depth)', () => {
    const anchoredTask = makeTask({
      schedule_mode: 'anchored',
      anchor_date: '2026-05-01T00:00:00.000Z',
      frequency_days: 7,
    });
    const completion = makeCompletion('2026-04-24T00:00:00.000Z');
    const load = new Map<string, number>();

    expect(() => placeNextDue(anchoredTask, completion, load, NOW)).toThrow(
      /LOAD-06/,
    );
  });

  test('T10: throws when isOoftTask(task) (frequency_days null OR 0) (LOAD-09 defense-in-depth)', () => {
    const completion = makeCompletion('2026-04-24T00:00:00.000Z');
    const load = new Map<string, number>();

    // Sub-case 1: frequency_days === null (app-layer OOFT marker).
    const ooftNullTask = makeTask({
      frequency_days: null,
      due_date: '2026-05-15T00:00:00.000Z',
    });
    expect(() =>
      placeNextDue(ooftNullTask, completion, load, NOW),
    ).toThrow(/LOAD-09/);

    // Sub-case 2: frequency_days === 0 (PB 0.37.1 storage-reality
    // OOFT marker — cleared NumberField).
    const ooftZeroTask = makeTask({
      frequency_days: 0,
      due_date: '2026-05-15T00:00:00.000Z',
    });
    expect(() =>
      placeNextDue(ooftZeroTask, completion, load, NOW),
    ).toThrow(/LOAD-09/);
  });
});

// ─── computeHouseholdLoad tests ─────────────────────────────────────────

describe('computeHouseholdLoad', () => {
  test('T1: empty tasks array → empty Map', () => {
    const load = computeHouseholdLoad(
      [],
      new Map(),
      new Map(),
      NOW,
      120,
      TZ,
    );
    expect(load.size).toEqual(0);
  });

  test('T2: archived task is SKIPPED (not contributed)', () => {
    const archived = makeTask({
      id: 't-archived',
      archived: true,
      frequency_days: 7,
    });
    const latest = new Map<string, CompletionRecord>();
    latest.set(
      archived.id,
      makeCompletionRecord(archived.id, '2026-04-24T00:00:00.000Z'),
    );

    const load = computeHouseholdLoad(
      [archived],
      latest,
      new Map(),
      NOW,
      120,
      TZ,
    );
    expect(load.size).toEqual(0);
  });

  test('T3: dormant-seasonal task with prior in-season completion is SKIPPED', () => {
    // Wrap window Oct-Mar active, Apr-Sep dormant. NOW = May 1 (dormant).
    // Prior completion in Jan = in-season for a previous cycle → task
    // is sleeping mid-cycle → computeNextDue returns null → skipped.
    const dormant = makeTask({
      id: 't-seasonal',
      frequency_days: 30,
      active_from_month: 10,
      active_to_month: 3,
    });
    const latest = new Map<string, CompletionRecord>();
    latest.set(
      dormant.id,
      makeCompletionRecord(dormant.id, '2026-01-10T00:00:00.000Z'),
    );

    const load = computeHouseholdLoad(
      [dormant],
      latest,
      new Map(),
      NOW,
      120,
      TZ,
    );
    expect(load.size).toEqual(0);
  });

  test('T4: OOFT task contributes 1 on due_date ISO key (LOAD-09)', () => {
    // OOFT = frequency_days null + due_date set. No completion →
    // computeNextDue returns due_date. Contributes 1 on that date.
    const ooft = makeTask({
      id: 't-ooft',
      frequency_days: null,
      due_date: '2026-05-15T00:00:00.000Z',
    });

    const load = computeHouseholdLoad(
      [ooft],
      new Map(),
      new Map(),
      NOW,
      120,
      TZ,
    );
    const expectedKey = isoDateKey(
      new Date('2026-05-15T00:00:00.000Z'),
      TZ,
    );
    expect(load.get(expectedKey)).toEqual(1);
    expect(load.size).toEqual(1);
  });

  test('T5: snoozed task contributes 1 on snooze_until ISO key (LOAD-08)', () => {
    // computeNextDue's override branch returns override.snooze_until
    // when (a) override active, (b) snooze_until > lastCompletion.
    // Contributes on snoozed date.
    const task = makeTask({
      id: 't-snoozed',
      frequency_days: 7,
    });
    const latest = new Map<string, CompletionRecord>();
    latest.set(
      task.id,
      makeCompletionRecord(task.id, '2026-04-24T00:00:00.000Z'),
    );
    const snoozeUntil = '2026-05-20T00:00:00.000Z';
    const overrides = new Map<string, Override>();
    overrides.set(task.id, makeOverride(task.id, snoozeUntil));

    const load = computeHouseholdLoad(
      [task],
      latest,
      overrides,
      NOW,
      120,
      TZ,
    );
    const expectedKey = isoDateKey(new Date(snoozeUntil), TZ);
    expect(load.get(expectedKey)).toEqual(1);
    expect(load.size).toEqual(1);
  });

  test('T6: anchored task contributes 1 on its natural anchored next_due (D-10)', () => {
    // Anchored mode. Anchor in the future → anchor IS next_due.
    // anchored tasks are LOAD-visible (contribute to sibling placement)
    // but their own next_due_smoothed is never written (LOAD-06).
    const anchor = '2026-06-01T00:00:00.000Z';
    const task = makeTask({
      id: 't-anchored',
      frequency_days: 30,
      schedule_mode: 'anchored',
      anchor_date: anchor,
    });

    const load = computeHouseholdLoad(
      [task],
      new Map(),
      new Map(),
      NOW,
      120,
      TZ,
    );
    const expectedKey = isoDateKey(new Date(anchor), TZ);
    expect(load.get(expectedKey)).toEqual(1);
  });

  test('T7: cycle task with next_due_smoothed contributes on smoothed; without smoothed contributes on natural', () => {
    // Sub-case A: smoothed set. Read-path D-02 (Wave 2) isn't wired in
    // this test — placeNextDue doesn't affect computeHouseholdLoad's
    // contribution here because computeNextDue (Wave 2) will consume
    // the field. For Wave 1, smoothed-vs-natural contribution is
    // indistinguishable through computeNextDue (Wave 2 has not yet
    // added the smoothed branch). Expected contribution on NATURAL
    // cycle date (lastCompletion + freq) for both sub-cases.
    //
    // This test documents the behavior AS OF WAVE 1: both sub-cases
    // contribute on lastCompletion + freq. Wave 2 will add a test
    // asserting smoothed-set → contributes on smoothed.
    const lastCompletion = '2026-04-24T00:00:00.000Z';
    const expectedNaturalKey = isoDateKey(
      addDays(new Date(lastCompletion), 7),
      TZ,
    );
    const latest = new Map<string, CompletionRecord>();

    // A: smoothed set (+3 days past natural). Wave 1: computeNextDue
    // doesn't consult next_due_smoothed yet, so contribution is still
    // on the natural date. This test locks that Wave 1 behavior.
    const taskA = makeTask({
      id: 't-cycleA',
      frequency_days: 7,
      next_due_smoothed: '2026-05-04T00:00:00.000Z', // natural + 3d
    });
    latest.set(taskA.id, makeCompletionRecord(taskA.id, lastCompletion));

    const loadA = computeHouseholdLoad(
      [taskA],
      latest,
      new Map(),
      NOW,
      120,
      TZ,
    );
    expect(loadA.get(expectedNaturalKey)).toEqual(1);

    // B: smoothed null (v1.0 holdover). Same contribution date.
    const taskB = makeTask({
      id: 't-cycleB',
      frequency_days: 7,
      next_due_smoothed: null,
    });
    const latestB = new Map<string, CompletionRecord>();
    latestB.set(taskB.id, makeCompletionRecord(taskB.id, lastCompletion));

    const loadB = computeHouseholdLoad(
      [taskB],
      latestB,
      new Map(),
      NOW,
      120,
      TZ,
    );
    expect(loadB.get(expectedNaturalKey)).toEqual(1);
  });

  test('T8: windowDays bound excludes tasks with next_due > now + windowDays', () => {
    // 365-day annual task completed Jan 1, 2026 → naturalIdeal =
    // Jan 1, 2027. NOW = May 1, 2026. windowDays=120 → windowEnd =
    // Aug 29, 2026. Annual task's due lands AFTER windowEnd → excluded.
    const annual = makeTask({
      id: 't-annual',
      frequency_days: 365,
    });
    const latest = new Map<string, CompletionRecord>();
    latest.set(
      annual.id,
      makeCompletionRecord(annual.id, '2026-01-01T00:00:00.000Z'),
    );

    const load = computeHouseholdLoad(
      [annual],
      latest,
      new Map(),
      NOW,
      120,
      TZ,
    );
    expect(load.size).toEqual(0);

    // Sanity: same task with windowDays=400 SHOULD include it.
    const loadWide = computeHouseholdLoad(
      [annual],
      latest,
      new Map(),
      NOW,
      400,
      TZ,
    );
    expect(loadWide.size).toEqual(1);
  });
});

// ─── isoDateKey smoke test (shared helper used by BOTH functions) ───────

describe('isoDateKey', () => {
  test('returns YYYY-MM-DD in UTC for UTC-instant input', () => {
    const d = new Date('2026-05-01T00:00:00.000Z');
    expect(isoDateKey(d, 'UTC')).toEqual('2026-05-01');
  });

  test('respects IANA timezone for boundary instants', () => {
    // 2026-05-01 00:00 UTC is still 2026-04-30 in Pacific time (UTC-7 during DST).
    const d = new Date('2026-05-01T00:00:00.000Z');
    expect(isoDateKey(d, 'America/Los_Angeles')).toEqual('2026-04-30');
    // Same instant is 2026-05-01 in UTC.
    expect(isoDateKey(d, 'UTC')).toEqual('2026-05-01');
    // And 2026-05-01 in Perth (UTC+8).
    expect(isoDateKey(d, 'Australia/Perth')).toEqual('2026-05-01');
  });
});

// Silence unused-import warnings for helpers retained for test-fixture
// clarity (makeCompletion et al) if lint runs in strict mode.
void formatInTimeZone;
