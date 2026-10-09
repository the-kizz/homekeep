'use server';

import { revalidatePath } from 'next/cache';
import { addDays } from 'date-fns';
import { createServerClient } from '@/lib/pocketbase-server';
import { assertMembership } from '@/lib/membership';
import { type Completion, type Task } from '@/lib/task-scheduling';
import {
  getCompletionsForHome,
  reduceLatestByTask,
} from '@/lib/completions';
import { getActiveOverridesForHome } from '@/lib/schedule-overrides';
import {
  computeHouseholdLoad,
  isoDateKey,
  placeNextDue,
} from '@/lib/load-smoothing';
import { classifyTasksForRebalance } from '@/lib/rebalance';

/**
 * Phase 17 manual-rebalance server actions (Plan 17-01 Task 2, D-10..D-14).
 *
 * Two exports:
 *
 *   - rebalancePreviewAction(homeId) — READ-ONLY. Classifies home tasks
 *     into the 4 buckets and returns counts. No PB writes, no
 *     revalidatePath. Used by Wave 2 Dialog open handler.
 *
 *   - rebalanceApplyAction(homeId) — WRITES. Builds fresh household
 *     load map, sorts rebalanceable by natural-ideal ascending, threads
 *     placeNextDue across the bucket with in-memory load-map mutation
 *     between placements (REBAL-07 TCSEM parity, D-04), and ships all
 *     N next_due_smoothed writes + M reschedule_marker clears (D-06
 *     revision) in ONE atomic pb.createBatch().send() (D-05). Per-task
 *     placement failures fall through with console.warn (best-effort).
 *
 * Discriminated-union result shape matches Phase 15 convention:
 *   { ok: true, ... } | { ok: false, formError: string }
 *
 * Security posture:
 *   - assertMembership(pb, homeId) before ANY PB read or write
 *     (T-17-01-07). Non-members get a sanitized formError.
 *   - No client-controlled fields in any write payload. The
 *     rebalanceable task list is computed server-side from classifier
 *     output (T-17-01-02, T-17-01-03).
 *   - All PB exceptions caught → sanitized formError strings
 *     ('Could not build rebalance preview', 'Could not apply rebalance').
 *     No stack traces or PB internals leak (T-17-01-05).
 *   - Single atomic batch guarantees no half-rebalanced state possible
 *     (T-17-01-08). PB rolls the entire transaction back on any op
 *     failure.
 *
 * Perf posture (T-17-01-06): bounded by v1.1 household-size ceiling
 * (~100 active tasks, LOAD-13). The apply loop is N placeNextDue calls +
 * 1 computeHouseholdLoad call ≈ 100 × 4ms ≈ 400ms for a max-size home,
 * well within browser form-submit timeout. No rate-limit needed at v1.1
 * scale.
 */

export type RebalancePreview = {
  update_count: number;
  preserve_anchored: number;
  preserve_override: number;
  preserve_from_now_on: number;
  preserve_total: number;
};

export type RebalancePreviewResult =
  | { ok: true; preview: RebalancePreview }
  | { ok: false; formError: string };

export type RebalanceResult =
  | { ok: true; updated: number }
  | { ok: false; formError: string };

// ─── Shared helper ───────────────────────────────────────────────

/**
 * Shared fetch-and-classify preamble for both preview + apply. Returns
 * a typed result that either carries the classified state or a typed
 * error the caller maps to its own formError string.
 *
 * Keeps the two actions symmetric — same auth gate, same ownership
 * preflight, same classifier call — so there's exactly one place to
 * update if (e.g.) the projection grows or a new bucket appears.
 */
type PreambleSuccess = {
  homeId: string;
  homeTz: string;
  now: Date;
  allTasks: Task[];
  latestByTask: ReturnType<typeof reduceLatestByTask>;
  overridesByTask: Awaited<ReturnType<typeof getActiveOverridesForHome>>;
  buckets: ReturnType<typeof classifyTasksForRebalance>;
};

type PreambleFailure =
  | { kind: 'missing-id' }
  | { kind: 'not-signed-in' }
  | { kind: 'not-member' }
  | { kind: 'fetch-failed' };

type PreambleResult =
  | { ok: true; data: PreambleSuccess }
  | { ok: false; error: PreambleFailure };

async function fetchAndClassify(homeId: string): Promise<PreambleResult> {
  if (typeof homeId !== 'string' || homeId.length === 0) {
    return { ok: false, error: { kind: 'missing-id' } };
  }

  const pb = await createServerClient();
  if (!pb.authStore.isValid) {
    return { ok: false, error: { kind: 'not-signed-in' } };
  }

  try {
    await assertMembership(pb, homeId);
  } catch {
    return { ok: false, error: { kind: 'not-member' } };
  }

  try {
    const now = new Date();

    // Home timezone (Pitfall 7 — same tz on load-map write + lookup).
    const home = await pb
      .collection('homes')
      .getOne(homeId, { fields: 'id,timezone' });
    const homeTz = (home.timezone as string) ?? 'UTC';

    // Non-archived home tasks. Projection mirrors lib/actions/seed.ts
    // (D-11 single-query) + reschedule_marker for Phase 17.
    const allTasks = (await pb.collection('tasks').getFullList({
      filter: pb.filter('home_id = {:hid} && archived = false', {
        hid: homeId,
      }),
      fields: [
        'id',
        'created',
        'archived',
        'home_id',
        'area_id',
        'frequency_days',
        'schedule_mode',
        'anchor_date',
        'preferred_days',
        'active_from_month',
        'active_to_month',
        'due_date',
        'next_due_smoothed',
        'reschedule_marker',
      ].join(','),
    })) as unknown as Task[];

    const taskIds = allTasks.map((t) => t.id);
    const completions = await getCompletionsForHome(pb, taskIds, now);
    const latestByTask = reduceLatestByTask(completions);
    const overridesByTask = await getActiveOverridesForHome(pb, homeId);

    const buckets = classifyTasksForRebalance(
      allTasks,
      overridesByTask,
      latestByTask,
      now,
      homeTz,
    );

    return {
      ok: true,
      data: {
        homeId,
        homeTz,
        now,
        allTasks,
        latestByTask,
        overridesByTask,
        buckets,
      },
    };
  } catch {
    return { ok: false, error: { kind: 'fetch-failed' } };
  }
}

// ─── rebalancePreviewAction ──────────────────────────────────────

/**
 * Preview counts — read-only classify. Wave 2's Dialog calls this on
 * open to render "Will update: N / Will preserve: M (A anchored,
 * B active snoozes, C from-now-on shifts)" before the user confirms.
 *
 * No PB writes. No revalidatePath.
 */
export async function rebalancePreviewAction(
  homeId: string,
): Promise<RebalancePreviewResult> {
  const pre = await fetchAndClassify(homeId);
  if (!pre.ok) {
    return mapPreambleError(pre.error, 'preview');
  }

  const { buckets } = pre.data;
  return {
    ok: true,
    preview: {
      update_count: buckets.rebalanceable.length,
      preserve_anchored: buckets.anchored.length,
      preserve_override: buckets.active_snooze.length,
      preserve_from_now_on: buckets.from_now_on.length,
      preserve_total:
        buckets.anchored.length +
        buckets.active_snooze.length +
        buckets.from_now_on.length,
    },
  };
}

// ─── rebalanceApplyAction ────────────────────────────────────────

/**
 * Apply — rebuilds next_due_smoothed for the rebalanceable bucket AND
 * clears reschedule_marker for the from_now_on bucket, all in one
 * atomic batch.
 *
 * Flow (D-03, D-04, D-05, D-06):
 *   1. Fetch + classify (shared preamble).
 *   2. Build FRESH household load map including contributions from
 *      anchored + override-preserved + from-now-on + OOFT + pre-existing
 *      smoothed cycle tasks (everything currently occupying the
 *      calendar).
 *   3. For each rebalanceable task: compute naturalIdeal =
 *      (lastCompletion?.completed_at ?? task.created) + freq. This is
 *      the pre-smoothed baseline placeNextDue derives internally too —
 *      we compute it here purely to sort the bucket ascending (D-03
 *      REBAL-07).
 *   4. Sort rebalanceable ascending by naturalIdeal (earliest ideal
 *      first — TCSEM parity).
 *   5. Sequential placement loop: placeNextDue → mutate load map in-
 *      place at isoDateKey(placedDate, homeTz) → record placedDate ISO.
 *      Per-seed placement errors fall through with console.warn (D-06
 *      best-effort; one task's failure does not abort the cohort).
 *   6. Single atomic pb.createBatch():
 *        - N × tasks.update(taskId, { next_due_smoothed: iso })
 *        - M × tasks.update(markerTaskId, { reschedule_marker: null })
 *      (D-06 revision — marker has served its purpose for this run;
 *       next rebalance treats the task normally.)
 *   7. revalidatePath for the three main home views.
 *   8. Return { ok:true, updated: N }.
 */
export async function rebalanceApplyAction(
  homeId: string,
): Promise<RebalanceResult> {
  const pre = await fetchAndClassify(homeId);
  if (!pre.ok) {
    return mapPreambleError(pre.error, 'apply');
  }

  const { homeTz, now, allTasks, latestByTask, overridesByTask, buckets } =
    pre.data;

  try {
    // D-04: fresh household load map — includes contributions from
    // ALL current tasks (anchored, override-preserved, from-now-on,
    // OOFT due-date, dormant-aware, pre-existing smoothed cycle). The
    // rebalanceable placements will thread ON TOP of this baseline,
    // distributing into the least-dense dates within tolerance.
    const householdLoad = computeHouseholdLoad(
      allTasks,
      latestByTask,
      overridesByTask,
      now,
      120,
      homeTz,
    );

    // D-03 REBAL-07 ascending-ideal sort. We sort a *copy* of the bucket
    // with its natural-ideal date attached; placeNextDue itself derives
    // naturalIdeal internally, so this extra computation exists SOLELY
    // for the sort key. OOFT already excluded by the classifier, so
    // frequency_days here is a positive integer.
    const ranked = buckets.rebalanceable.map((task) => {
      const last = latestByTask.get(task.id) ?? null;
      const baseIso = last?.completed_at ?? task.created;
      const freq = task.frequency_days as number;
      const naturalIdeal = addDays(new Date(baseIso), freq);
      return { task, naturalIdeal };
    });
    ranked.sort(
      (a, b) => a.naturalIdeal.getTime() - b.naturalIdeal.getTime(),
    );

    // Phase 28+ idempotency fix: subtract ALL rebalanceable tasks' CURRENT
    // smoothed contributions from the load map BEFORE the placement loop.
    // Without this, Run 2 and Run 3 see different starting maps (Run 3
    // reads Run 2's just-written smoothed values), which drifts placement
    // between runs. By stripping the rebalanceable bucket first, every
    // re-run starts from a "rebalanceable-has-not-been-placed" state that
    // is stable across runs — so placement output stays bit-identical.
    // placeNextDue already self-excludes the target task (Phase 19
    // PATCH-03); this loop extends the exclusion to all siblings in the
    // bucket. Net effect: idempotent re-run over a stable set.
    for (const { task } of ranked) {
      if (task.next_due_smoothed) {
        try {
          const existing = new Date(task.next_due_smoothed);
          if (!isNaN(existing.getTime())) {
            const k = isoDateKey(existing, homeTz);
            const prev = householdLoad.get(k) ?? 0;
            if (prev > 0) householdLoad.set(k, prev - 1);
          }
        } catch {
          // stale / corrupt value — skip subtraction
        }
      }
    }

    // REBAL-07: sequential placement loop with in-memory load-map
    // threading. Mirrors lib/actions/seed.ts:171-223 (Phase 13 TCSEM)
    // and the completeTaskAction step 7.5 pattern (Phase 12 Plan 12-03).
    // Each placement mutates the Map at isoDateKey(placedDate, homeTz)
    // so subsequent placements see prior placements' effects —
    // Pitfall 7 tz alignment: isoDateKey MUST be used on both write
    // (Map.set) and lookup (placeNextDue scoring) sides.
    const placedDates = new Map<string, string>(); // task.id → ISO
    for (const { task } of ranked) {
      try {
        const last = latestByTask.get(task.id) ?? null;
        const lastCompletion: Completion | null = last
          ? { completed_at: last.completed_at }
          : null;
        // Pass the ORIGINAL task — placeNextDue ignores
        // next_due_smoothed (it recomputes from lastCompletion). We
        // do NOT synthesize a naturalView here the way the classifier
        // does for dormancy detection; placeNextDue has its own
        // seasonal guards and the classifier already excluded any
        // dormant-seasonal tasks from rebalanceable.
        const placedDate = placeNextDue(
          task,
          lastCompletion,
          householdLoad,
          now,
          {
            preferredDays: task.preferred_days ?? undefined,
            timezone: homeTz,
          },
        );
        const key = isoDateKey(placedDate, homeTz);
        householdLoad.set(key, (householdLoad.get(key) ?? 0) + 1);
        placedDates.set(task.id, placedDate.toISOString());
      } catch (e) {
        // Per-task best-effort (D-06). Skipped tasks keep their
        // existing next_due_smoothed (or null) — next rebalance or
        // completion writes a fresh value.
        console.warn(
          `[rebalanceApplyAction] placement failed for task ${task.id}:`,
          (e as Error).message,
        );
      }
    }

    // D-05 single atomic batch. One transaction wraps:
    //   - N × tasks.update(taskId, { next_due_smoothed: iso })   (rebalanceable)
    //   - M × tasks.update(taskId, { reschedule_marker: null })  (from_now_on)
    //
    // PB rolls the entire batch back on any op failure — no partial
    // rebalance state possible. When there's nothing to write (empty
    // home / all-preserved home), skip batch.send() entirely to avoid
    // a no-op PB roundtrip.
    const pb = await createServerClient();
    const batch = pb.createBatch();
    let updateCount = 0;

    for (const [taskId, iso] of placedDates) {
      batch.collection('tasks').update(taskId, { next_due_smoothed: iso });
      updateCount++;
    }

    // D-06 revision: clear reschedule_marker on from_now_on bucket.
    // PB 0.37.1 DateField clear value is null (Phase 15 convention —
    // see lib/actions/reschedule.ts where markerIso ISO strings
    // co-exist with null on never-written rows).
    for (const task of buckets.from_now_on) {
      batch.collection('tasks').update(task.id, {
        reschedule_marker: null,
      });
    }

    if (updateCount > 0 || buckets.from_now_on.length > 0) {
      await batch.send();
    }

    // Revalidate the three main home views (same set as seed.ts —
    // every view reads next_due_smoothed).
    revalidatePath(`/h/${homeId}`);
    revalidatePath(`/h/${homeId}/by-area`);
    revalidatePath(`/h/${homeId}/person`);

    return { ok: true, updated: updateCount };
  } catch {
    return { ok: false, formError: 'Could not apply rebalance' };
  }
}

// ─── Error mapper ────────────────────────────────────────────────

function mapPreambleError(
  err: PreambleFailure,
  mode: 'preview' | 'apply',
): { ok: false; formError: string } {
  switch (err.kind) {
    case 'missing-id':
      return { ok: false, formError: 'Missing home id' };
    case 'not-signed-in':
      return { ok: false, formError: 'Not signed in' };
    case 'not-member':
      return {
        ok: false,
        formError: 'You are not a member of this home',
      };
    case 'fetch-failed':
      return {
        ok: false,
        formError:
          mode === 'preview'
            ? 'Could not build rebalance preview'
            : 'Could not apply rebalance',
      };
  }
}
