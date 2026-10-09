import type PocketBase from 'pocketbase';

/**
 * Schedule-override data access (10-01 Plan, D-08 / D-09 / D-10).
 *
 * PURE data-layer module: two fetch helpers over the schedule_overrides
 * PocketBase collection. No `computeNextDue` coupling; callers decide
 * how to apply an override (the D-10 read-time filter half — "override
 * only applies if snooze_until > lastCompletion.completed_at" — lives in
 * `computeNextDue`, wired by Plan 10-02). This module returns the raw
 * row or null / empty Map; it never mutates state.
 *
 * Two entry points:
 *
 *   - `getActiveOverride(pb, taskId)` — single-task path for TaskDetail
 *     and individual server actions. Returns the newest unconsumed row
 *     (sort '-created' with `getFirstListItem`) or null.
 *
 *   - `getActiveOverridesForHome(pb, homeId)` — batch path for dashboard
 *     renders. Returns `Map<taskId, Override>` in ONE PB roundtrip, so
 *     per-task loops (BandView, coverage, scheduler) do O(1) lookups
 *     instead of N+1 fetches. Mirrors the `latestByTask` Map pattern
 *     from `lib/coverage.ts` / `lib/completions.ts:83-97`.
 *
 * Filter safety (T-04-01-08 mitigation): every `pb.filter(...)` call
 * uses SDK parameter binding — `pb.filter('x = {:y}', { y: value })` —
 * NEVER template-literal concatenation. See exemplars at
 * `lib/notifications.ts:93` and `lib/membership.ts:37`.
 *
 * Fail-open posture: both helpers wrap the PB call in try/catch and
 * return null/empty-Map on error. The 404 "no active override" case is
 * by far the most common; any other error collapses the same way
 * because downstream behavior is safe (natural next-due is the
 * fallback, and D-10's write-time atomic consumption catches the happy
 * path). Avoid `console.error` — mirrors the silent-on-404 posture of
 * `hasNotified` in `lib/notifications.ts`.
 *
 * Pitfall 4 acknowledged: every `getFullList` call passes `batch: 500`
 * explicitly so we don't rely on PB 0.37's undocumented default paging.
 *
 * A3 assumption: PB 0.37.1 accepts the cross-table parameterized filter
 * `task_id.home_id = {:hid}`. If that turns out false in disposable-PB
 * integration, the fallback is string-concat (safe because `homeId`
 * comes from `pb.authStore`, not user input). Noted here so Plan 10-02
 * doesn't spike on it — the SUMMARY records what was actually observed.
 */

export type Override = {
  id: string;
  task_id: string;
  snooze_until: string; // ISO 8601 UTC
  consumed_at: string | null; // null / '' = active
  created_by_id: string | null;
  created: string;
};

/**
 * Single-task fetch: returns the latest unconsumed override for `taskId`,
 * or null if none exists (or on any PB error).
 *
 * Sort `-created` picks the newest row as a tiebreaker in the defensive
 * "D-02 violated, multiple active" case. D-02 mandates exactly 0 or 1
 * active row per task, but read paths must degrade gracefully regardless.
 *
 * NOTE: the D-10 read-time guard ("override only applies if snooze_until
 * > lastCompletion.completed_at") is applied by `computeNextDue` (Plan
 * 10-02), not here. This helper returns the raw row; the caller decides
 * relevance based on its completion context.
 */
export async function getActiveOverride(
  pb: PocketBase,
  taskId: string,
): Promise<Override | null> {
  try {
    const rec = await pb
      .collection('schedule_overrides')
      .getFirstListItem(
        pb.filter('task_id = {:tid} && consumed_at = null', { tid: taskId }),
        { sort: '-created' },
      );
    return rec as unknown as Override;
  } catch {
    // PB throws ClientResponseError 404 when no row matches — the common
    // "no active override" path. Other errors (network, rule-gate
    // rejection) fall open to natural next-due, which is safe per D-10.
    return null;
  }
}

/**
 * Batch fetch: all active overrides for tasks in `homeId`, keyed by
 * task_id. Single PB roundtrip per dashboard render — eliminates N+1
 * risk for households with 50+ tasks (the BandView hot path).
 *
 * Reduction: rows are sorted '-created' (newest first); the Map-reduce
 * uses `if (!m.has(row.task_id)) m.set(...)` so the FIRST entry wins —
 * which, combined with the sort, means the newest unconsumed row wins
 * when D-02 is violated (defense in depth).
 *
 * A3 assumption: PB 0.37.1 accepts `task_id.home_id = {:hid}` in a
 * parameterized filter. If integration proves that syntax rejected,
 * swap to string concat — `homeId` comes from `pb.authStore`, not user
 * input, so injection is not a risk here.
 */
export async function getActiveOverridesForHome(
  pb: PocketBase,
  homeId: string,
): Promise<Map<string, Override>> {
  try {
    const rows = await pb.collection('schedule_overrides').getFullList({
      filter: pb.filter('task_id.home_id = {:hid} && consumed_at = null', {
        hid: homeId,
      }),
      sort: '-created',
      batch: 500, // Pitfall 4 — explicit batch size
    });

    const m = new Map<string, Override>();
    for (const r of rows) {
      const row = r as unknown as Override;
      if (!m.has(row.task_id)) m.set(row.task_id, row);
    }
    return m;
  } catch {
    // Fail-open to empty Map: downstream per-task lookups return
    // undefined, which `computeNextDue` treats as "no override" → falls
    // through to the natural next-due branch. Safe default.
    return new Map();
  }
}
