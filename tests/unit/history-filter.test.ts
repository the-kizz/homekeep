import { describe, test, expect } from 'vitest';
import {
  filterCompletions,
  type HistoryFilter,
} from '@/lib/history-filter';
import type { CompletionRecord } from '@/lib/completions';

/**
 * 05-01 Task 2 RED→GREEN: filterCompletions pure predicate applier
 * (D-10, HIST-02).
 *
 * Contract:
 *   - filterCompletions(completions, filter, taskAreaMap, now, timezone)
 *     returns the subset of `completions` matching all supplied predicates.
 *   - personId null/undefined disables the person filter.
 *   - areaId null/undefined disables the area filter; otherwise the
 *     task_id must map via taskAreaMap to the given areaId.
 *   - range 'today' / 'week' / 'month' compare against LOCAL-timezone
 *     midnight/week-start/month-start (DST-safe via fromZonedTime).
 *   - range 'all' returns the unconstrained input.
 *   - Input order preserved (predicate, not sort).
 */

function c(
  id: string,
  taskId: string,
  completedAt: string,
  completedById: string,
): CompletionRecord {
  return {
    id,
    task_id: taskId,
    completed_by_id: completedById,
    completed_at: completedAt,
    notes: '',
    via: 'tap',
  };
}

const TZ = 'UTC';

describe('filterCompletions', () => {
  test('empty completions → []', () => {
    const filter: HistoryFilter = { range: 'all' };
    const result = filterCompletions(
      [],
      filter,
      new Map(),
      new Date('2026-04-20T12:00:00.000Z'),
      TZ,
    );
    expect(result).toEqual([]);
  });

  test('range=all returns every input row in order', () => {
    const rows = [
      c('c1', 't1', '2026-04-20T10:00:00.000Z', 'u1'),
      c('c2', 't2', '2026-04-19T10:00:00.000Z', 'u2'),
      c('c3', 't3', '2026-04-01T10:00:00.000Z', 'u1'),
    ];
    const filter: HistoryFilter = { range: 'all' };
    const result = filterCompletions(
      rows,
      filter,
      new Map(),
      new Date('2026-04-20T12:00:00.000Z'),
      TZ,
    );
    expect(result).toEqual(rows);
  });

  test('personId narrows to a single user', () => {
    const rows = [
      c('c1', 't1', '2026-04-20T10:00:00.000Z', 'u1'),
      c('c2', 't2', '2026-04-19T10:00:00.000Z', 'u2'),
      c('c3', 't3', '2026-04-20T09:00:00.000Z', 'u1'),
    ];
    const filter: HistoryFilter = { personId: 'u1', range: 'all' };
    const result = filterCompletions(
      rows,
      filter,
      new Map(),
      new Date('2026-04-20T12:00:00.000Z'),
      TZ,
    );
    expect(result.map((r) => r.id)).toEqual(['c1', 'c3']);
  });

  test('areaId narrows via taskAreaMap lookup', () => {
    const rows = [
      c('c1', 't1', '2026-04-20T10:00:00.000Z', 'u1'),
      c('c2', 't2', '2026-04-19T10:00:00.000Z', 'u2'),
      c('c3', 't3', '2026-04-20T09:00:00.000Z', 'u1'),
    ];
    const taskAreaMap = new Map([
      ['t1', 'a-kitchen'],
      ['t2', 'a-bath'],
      ['t3', 'a-kitchen'],
    ]);
    const filter: HistoryFilter = { areaId: 'a-kitchen', range: 'all' };
    const result = filterCompletions(
      rows,
      filter,
      taskAreaMap,
      new Date('2026-04-20T12:00:00.000Z'),
      TZ,
    );
    expect(result.map((r) => r.id)).toEqual(['c1', 'c3']);
  });

  test('areaId filter excludes completions whose task_id is not in taskAreaMap', () => {
    const rows = [
      c('c1', 't-known', '2026-04-20T10:00:00.000Z', 'u1'),
      c('c2', 't-unknown', '2026-04-20T10:00:00.000Z', 'u1'),
    ];
    const taskAreaMap = new Map([['t-known', 'a-kitchen']]);
    const filter: HistoryFilter = { areaId: 'a-kitchen', range: 'all' };
    const result = filterCompletions(
      rows,
      filter,
      taskAreaMap,
      new Date('2026-04-20T12:00:00.000Z'),
      TZ,
    );
    expect(result.map((r) => r.id)).toEqual(['c1']);
  });

  test("range='today' excludes yesterday", () => {
    const now = new Date('2026-04-20T12:00:00.000Z'); // UTC: today starts 00:00Z
    const rows = [
      c('c-today-am', 't1', '2026-04-20T00:30:00.000Z', 'u1'),
      c('c-today-pm', 't1', '2026-04-20T11:00:00.000Z', 'u1'),
      c('c-yesterday', 't1', '2026-04-19T23:59:00.000Z', 'u1'),
    ];
    const filter: HistoryFilter = { range: 'today' };
    const result = filterCompletions(rows, filter, new Map(), now, TZ);
    expect(result.map((r) => r.id)).toEqual(['c-today-am', 'c-today-pm']);
  });

  test("range='week' includes Sunday-start window, excludes prior Saturday", () => {
    // 2026-04-22 is a Wednesday (UTC). date-fns default week start is
    // Sunday → week runs 2026-04-19 00:00Z .. 2026-04-26 00:00Z.
    const now = new Date('2026-04-22T12:00:00.000Z');
    const rows = [
      c('c-sun', 't1', '2026-04-19T00:30:00.000Z', 'u1'),
      c('c-wed', 't1', '2026-04-22T11:00:00.000Z', 'u1'),
      c('c-prev-sat', 't1', '2026-04-18T23:59:00.000Z', 'u1'),
    ];
    const filter: HistoryFilter = { range: 'week' };
    const result = filterCompletions(rows, filter, new Map(), now, TZ);
    expect(result.map((r) => r.id)).toEqual(['c-sun', 'c-wed']);
  });

  test("range='month' includes first-of-month, excludes last day of previous month", () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const rows = [
      c('c-apr-1', 't1', '2026-04-01T00:30:00.000Z', 'u1'),
      c('c-apr-20', 't1', '2026-04-20T00:30:00.000Z', 'u1'),
      c('c-mar-31', 't1', '2026-03-31T23:59:00.000Z', 'u1'),
    ];
    const filter: HistoryFilter = { range: 'month' };
    const result = filterCompletions(rows, filter, new Map(), now, TZ);
    expect(result.map((r) => r.id)).toEqual(['c-apr-1', 'c-apr-20']);
  });

  test('combined (person + area + week) applies intersection', () => {
    const now = new Date('2026-04-22T12:00:00.000Z');
    const rows = [
      c('c-keep', 't-k', '2026-04-21T09:00:00.000Z', 'u1'),
      c('c-wrong-person', 't-k', '2026-04-21T09:00:00.000Z', 'u2'),
      c('c-wrong-area', 't-other', '2026-04-21T09:00:00.000Z', 'u1'),
      c('c-too-old', 't-k', '2026-04-01T09:00:00.000Z', 'u1'),
    ];
    const taskAreaMap = new Map([
      ['t-k', 'a-kitchen'],
      ['t-other', 'a-bath'],
    ]);
    const filter: HistoryFilter = {
      personId: 'u1',
      areaId: 'a-kitchen',
      range: 'week',
    };
    const result = filterCompletions(rows, filter, taskAreaMap, now, TZ);
    expect(result.map((r) => r.id)).toEqual(['c-keep']);
  });

  test('input order preserved (stable predicate, not a sort)', () => {
    const rows = [
      c('c-late', 't1', '2026-04-20T23:00:00.000Z', 'u1'),
      c('c-early', 't1', '2026-04-20T01:00:00.000Z', 'u1'),
      c('c-mid', 't1', '2026-04-20T12:00:00.000Z', 'u1'),
    ];
    const filter: HistoryFilter = { personId: 'u1', range: 'today' };
    const result = filterCompletions(
      rows,
      filter,
      new Map(),
      new Date('2026-04-20T12:00:00.000Z'),
      TZ,
    );
    expect(result.map((r) => r.id)).toEqual(['c-late', 'c-early', 'c-mid']);
  });

  test('null personId + null areaId behave as "unset" (no filter)', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const rows = [
      c('c1', 't1', '2026-04-20T10:00:00.000Z', 'u1'),
      c('c2', 't2', '2026-04-20T11:00:00.000Z', 'u2'),
    ];
    const filter: HistoryFilter = {
      personId: null,
      areaId: null,
      range: 'all',
    };
    const result = filterCompletions(rows, filter, new Map(), now, TZ);
    expect(result).toEqual(rows);
  });

  test('SEAS-10: dormant task completions appear in history (dormancy does not filter)', () => {
    // now = July 15 2026 (out of Oct-Mar active window for a hypothetical
    // winter-only task). The completion is from January — inside the
    // window at completion time, but the task is currently dormant.
    // filterCompletions does not accept a task list or any dormancy
    // parameters; SEAS-10 guarantees the historical completion survives
    // the filter regardless of current seasonal state. Signature length
    // (5 formal params) locks the contract at the type level too.
    const now = new Date('2026-07-15T12:00:00.000Z');
    const completion = c(
      'c1',
      't-heater',
      '2026-01-10T10:00:00.000Z',
      'u1',
    );
    const taskAreaMap = new Map<string, string>([['t-heater', 'a1']]);
    const result = filterCompletions(
      [completion],
      { personId: null, areaId: null, range: 'all' },
      taskAreaMap,
      now,
      TZ,
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('c1');
    // Defensive: the filter never accepted a task list or a dormancy
    // predicate, so there's no surface that could have been wired to
    // filter by active_from/to. 5 formal params: completions, filter,
    // taskAreaMap, now, timezone.
    expect(filterCompletions.length).toBe(5);
  });
});
