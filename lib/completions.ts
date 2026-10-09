import type PocketBase from 'pocketbase';

/**
 * Completions data access + pure reducer (03-01 Plan, Pattern 2, D-18).
 *
 * Background: PocketBase does NOT support `GROUP BY ... MAX(completed_at)
 * LIMIT 1 PER group` in its API [pocketbase.io/docs/api-records]. The
 * standard workaround at Phase-3 scale is to fetch every completion in
 * a bounded recency window (13 months covers the longest frequency of
 * 365d plus ~30d slack) and reduce client-side to a Map keyed by
 * task_id.
 *
 * Why 395 days: MAX frequency_days is bounded at 365 by the task
 * schema; a completion from 365d + 30d slack back is the oldest row we
 * might still need to render a "last done" badge for. Anything older
 * is irrelevant to the current cycle computation.
 *
 * Pitfall 3 acknowledged: PB's `getFullList` auto-paginates; the
 * default page size is 500 BUT if we don't pass it explicitly we're
 * relying on an undocumented default. Pass `batch: 500` to make the
 * behaviour explicit (upstream bug-proof).
 *
 * Pitfall 11 acknowledged: the PB `task_id.home_id.owner_id` filter
 * path requires the (task_id, completed_at) index created by the
 * 1714867200_completions migration.
 */

export type CompletionRecord = {
  id: string;
  task_id: string;
  completed_by_id: string;
  completed_at: string;
  notes: string;
  via: 'tap' | 'manual-date';
};

/**
 * Fetch all completions for the supplied task ids within the 13-month
 * recency window. Returns `[]` when `taskIds` is empty (no round-trip).
 *
 * Filter injection safety: task_ids are fetched from PB by the caller
 * (never user-supplied raw input) — so quoting them via template literal
 * is safe for Phase 3. Phase 7 hardening may switch to
 * `pb.filter('task_id = {:id}', {id})` for belt-and-braces defense.
 */
export async function getCompletionsForHome(
  pb: PocketBase,
  taskIds: string[],
  now: Date,
): Promise<CompletionRecord[]> {
  if (taskIds.length === 0) return [];

  // 13 months = 395 days. See module docstring above for the rationale.
  const cutoffIso = new Date(
    now.getTime() - 395 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const idFilter = taskIds.map((id) => `task_id = "${id}"`).join(' || ');
  const filter = `(${idFilter}) && completed_at >= "${cutoffIso}"`;

  const records = await pb.collection('completions').getFullList({
    filter,
    sort: '-completed_at',
    fields: 'id,task_id,completed_by_id,completed_at,notes,via',
    batch: 500, // Pitfall 3 — explicit batch size, don't rely on PB default.
  });

  return records as unknown as CompletionRecord[];
}

/**
 * Pure reducer: group a flat completions array to a Map keyed by
 * task_id containing the MOST RECENT completion per task.
 *
 * Input order does not matter — even if a "newer" row comes before
 * an "older" row in the array (e.g. clock skew), the reducer keeps
 * the one with the largest `completed_at`.
 *
 * Tie semantics: when two rows have identical `completed_at`, the
 * strict `>` comparison means the FIRST row wins (it wasn't displaced
 * by a later equal-timestamp row). Deterministic given stable input.
 */
export function reduceLatestByTask(
  completions: CompletionRecord[],
): Map<string, CompletionRecord> {
  const m = new Map<string, CompletionRecord>();
  for (const c of completions) {
    const prev = m.get(c.task_id);
    if (
      !prev ||
      new Date(c.completed_at) > new Date(prev.completed_at)
    ) {
      m.set(c.task_id, c);
    }
  }
  return m;
}
