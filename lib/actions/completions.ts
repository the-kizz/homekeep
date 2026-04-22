'use server';

import { revalidatePath } from 'next/cache';
import { formatInTimeZone } from 'date-fns-tz';
import { createServerClient } from '@/lib/pocketbase-server';
import { createAdminClient } from '@/lib/pocketbase-admin';
import { assertMembership } from '@/lib/membership';
import { shouldWarnEarly } from '@/lib/early-completion-guard';
import { computeNextDue, type Task } from '@/lib/task-scheduling';
import {
  getCompletionsForHome,
  reduceLatestByTask,
  type CompletionRecord,
} from '@/lib/completions';
import { detectAreaCelebration } from '@/lib/area-celebration';
import {
  getActiveOverride,
  getActiveOverridesForHome,
} from '@/lib/schedule-overrides';

/**
 * Completion server action (03-01 Plan, Pattern 4, Pitfalls 5/6/13).
 *
 * Exports:
 *   - completeTaskAction(taskId, { force? })
 *
 * Security posture (threat_model T-03-01-01..08, T-10-02):
 *   - T-03-01-01 Spoofing: ownership preflight via
 *     `pb.collection('tasks').getOne(taskId)`. The tasks collection
 *     viewRule enforces `home_id.owner_id = @request.auth.id` — a
 *     cross-user forged id 404s here before the write.
 *   - T-03-01-02 Tampering (body): `completed_by_id` is sourced server-
 *     side from `pb.authStore.record.id`. PB createRule also enforces
 *     `@request.body.completed_by_id = @request.auth.id` as defense-
 *     in-depth.
 *   - T-03-01-03 Repudiation: completions migration sets updateRule=null
 *     and deleteRule=null — append-only (proven by integration test).
 *   - T-03-01-07 Tampering (force flag): the server RE-EVALUATES
 *     `shouldWarnEarly` when force=false. The flag is the user's
 *     explicit acknowledgement of the confirm dialog, not a privilege
 *     escalation vector.
 *   - T-03-01-08 Business logic (archived task): returns a typed
 *     formError before attempting the write.
 *   - T-10-02 Tampering (simultaneous-snooze race): the completion
 *     write and the active-override's consumed_at flip are bundled
 *     into a single `pb.createBatch().send()` transaction. If any op
 *     fails, PB rolls BOTH back — no orphaned "completion landed but
 *     override still active" state possible. If a concurrent writer
 *     consumed the override between `getActiveOverride` and
 *     `batch.send`, the update targets an already-consumed row and
 *     either succeeds (harmless overwrite of consumed_at) or the
 *     whole batch rolls back — either outcome is safe.
 *
 * Phase 10 (D-10 atomic consumption): completeTaskAction batches
 * `completions.create` with `schedule_overrides.update({consumed_at:
 * now})` in a single `pb.createBatch().send()` transaction when an
 * active override exists. Atomicity prevents the "completion landed
 * but override still active" race — no orphaned state possible on PB
 * failure (Pitfall 5 mitigation). The read-time D-10 filter in
 * `computeNextDue` is the defense-in-depth half.
 *
 * Phase 11 (D-04, OOFT-02, T-11-03): when the task is one-off
 * (task.frequency_days === null), an additional
 * `tasks.update({archived: true, archived_at: now})` op is appended to
 * the SAME batch. Atomicity extends to this op — if it fails, the
 * completion and the override-consumption (if any) roll back together.
 * No "completed but unarchived" orphan state possible. Mirrors Phase
 * 10's atomic-consumption invariant; reuses the exact same batch
 * primitive (no new transaction, no extra roundtrip).
 *
 * Error-shape contract (Pitfall 5):
 *   - Input validation + auth errors → `{ ok: false, formError }`.
 *   - Guard fired + force=false → `{ requiresConfirm: true, ... }`.
 *   - Success → `{ ok: true, completion, nextDueFormatted }`.
 *   - PB / network exception → caught and returned as
 *     `{ ok: false, formError: 'Could not record completion' }`.
 * Business outcomes are NEVER thrown — they're returned as typed
 * results so React Server Actions can bind to them directly.
 */

export type CompleteResult =
  | {
      ok: true;
      completion: { id: string; completed_at: string };
      nextDueFormatted: string;
      // 06-02 GAME-04: present IFF the task's area crossed from <100% →
      // 100% coverage via this completion. Client triggers animation.
      celebration?: { kind: 'area-100'; areaId: string; areaName: string };
    }
  | { ok: false; formError: string }
  | {
      requiresConfirm: true;
      elapsed: number;
      frequency: number;
      lastCompletedAt: string | null;
    };

export async function completeTaskAction(
  taskId: string,
  opts: { force?: boolean } = {},
): Promise<CompleteResult> {
  // Input validation — outside the try/catch so the typed error is explicit.
  if (typeof taskId !== 'string' || taskId.length === 0) {
    return { ok: false, formError: 'Missing task id' };
  }

  const pb = await createServerClient();
  if (!pb.authStore.isValid) {
    return { ok: false, formError: 'Not signed in' };
  }
  const userId = pb.authStore.record?.id as string;

  try {
    // Ownership preflight (T-03-01-01): the tasks viewRule is
    // `home_id.owner_id = @request.auth.id`; a forged id 404s here.
    const task = await pb.collection('tasks').getOne(taskId, {
      fields:
        'id,home_id,area_id,frequency_days,schedule_mode,anchor_date,archived,created,name',
    });

    // 04-02 D-13: completeTaskAction is member-permitted. assertMembership
    // on task.home_id runs AFTER the tasks.getOne (we need home_id to
    // check) but BEFORE the archived/timing guards — a non-member should
    // never see the archived-status or early-warning leakage either.
    try {
      await assertMembership(pb, task.home_id as string);
    } catch {
      return { ok: false, formError: 'You are not a member of this home' };
    }

    if (task.archived) {
      return { ok: false, formError: 'Task is archived' };
    }

    // Home lookup (for timezone-aware next-due formatting in the toast).
    const homeId = task.home_id as string;
    const home = await pb
      .collection('homes')
      .getOne(homeId, { fields: 'id,timezone' });

    // Latest completion for client-stale defense — the guard re-check
    // below uses this to decide whether to return `requiresConfirm`.
    let lastCompletion: { id: string; completed_at: string } | null = null;
    try {
      const rec = await pb
        .collection('completions')
        .getFirstListItem(
          pb.filter('task_id = {:tid}', { tid: taskId }),
          {
            sort: '-completed_at',
            fields: 'id,completed_at',
          },
        );
      lastCompletion = {
        id: rec.id,
        completed_at: rec.completed_at as string,
      };
    } catch {
      // No prior completion — that's fine; lastCompletion stays null.
    }

    const now = new Date();

    // Server-side guard re-check (Pitfall 5 + T-03-01-07). When
    // force=false (default) and the guard trips, return the typed
    // `requiresConfirm` payload so the client can show its dialog.
    if (!opts.force) {
      const warn = shouldWarnEarly(
        {
          created: task.created as string,
          frequency_days: task.frequency_days as number,
        },
        lastCompletion
          ? { completed_at: lastCompletion.completed_at }
          : null,
        now,
      );
      if (warn) {
        const refIso = lastCompletion?.completed_at ?? (task.created as string);
        const elapsed =
          (now.getTime() - new Date(refIso).getTime()) / 86400000;
        return {
          requiresConfirm: true,
          elapsed,
          frequency: task.frequency_days as number,
          lastCompletedAt: lastCompletion?.completed_at ?? null,
        };
      }
    }

    // 06-02 GAME-04: snapshot the task's area coverage BEFORE the write so
    // we can detect the <100% → 100% crossover after the completion lands.
    // Fetch sibling tasks + recent completions once; reuse for the after-
    // snapshot via an overlay Map that swaps in the fresh completion.
    const areaId = task.area_id as string;
    const tasksInArea = (await pb.collection('tasks').getFullList({
      filter: pb.filter(
        'home_id = {:hid} && area_id = {:aid} && archived = false',
        { hid: homeId, aid: areaId },
      ),
      fields: 'id,created,archived,frequency_days,schedule_mode,anchor_date',
    })) as unknown as Task[];
    const areaTaskIds = tasksInArea.map((t) => t.id);
    const areaCompletions = await getCompletionsForHome(pb, areaTaskIds, now);
    const latestBefore = reduceLatestByTask(areaCompletions);

    // Phase 10 (D-10 atomic consumption): fetch active overrides BEFORE
    // the write. Two lookups serve one Map — one for the task-under-
    // completion (consumed in the same batch, below) and one for the
    // home-wide Map fed into `detectAreaCelebration` so the celebration
    // predicate sees the full override state of sibling tasks in the
    // area (Wave 2 handoff option 2). Both reads fail-open to null /
    // empty Map; if PB is down the completion write will fail later
    // anyway and the outer try/catch returns the typed formError.
    const activeOverride = await getActiveOverride(pb, taskId);
    const overridesByTask = await getActiveOverridesForHome(pb, homeId);

    // Phase 10 (D-10 atomic consumption, Pitfall 5 mitigation).
    // Single atomic PB transaction: the completion write PLUS — when an
    // active override exists — the `consumed_at = now` flip on that
    // override. If either op fails, PB rolls the whole transaction back
    // (T-10-02). Exemplars: lib/actions/seed.ts:93, lib/actions/
    // invites.ts:192. `completed_by_id` is server-set from
    // `pb.authStore` — NEVER from client input (T-03-01-02). PB
    // createRule also enforces the body match as defense-in-depth.
    const batch = pb.createBatch();
    batch.collection('completions').create({
      task_id: taskId,
      completed_by_id: userId,
      completed_at: now.toISOString(),
      via: 'tap', // Pitfall 13
      notes: '',
    });
    if (activeOverride) {
      batch.collection('schedule_overrides').update(activeOverride.id, {
        consumed_at: now.toISOString(),
      });
    }
    // Phase 11 (D-04, OOFT-02): one-off tasks auto-archive atomically
    // with the completion write. Same PB transaction — if the archive op
    // fails (e.g. task deleted by another user mid-batch), PB rolls back
    // the completion AND the override-consumption too (T-11-03). No
    // "completed but unarchived" orphan state possible. The
    // `frequency_days` field is already selected in the task.getOne()
    // fields list above — no additional fetch needed. `archived_at` is
    // the DateField on the tasks collection (see migration
    // 1714780800_init_homekeep.js line 145) — grep-verified present in
    // the baseline schema.
    //
    // OOFT marker: `frequency_days === null` is the semantic, but PB
    // 0.37.1 stores a cleared NumberField as `0` on the wire (the D-02
    // `required: false` flip doesn't coerce stored nulls). Both values
    // route to the archive op — discovered during Plan 11-03 integration
    // Scenario 2 where `frequency_days: null` on create round-tripped as
    // `0` and the archive op skipped. Matches the isOoft guard in
    // lib/task-scheduling.ts (computeNextDue OOFT branch).
    const freqOoft =
      task.frequency_days === null || task.frequency_days === 0;
    if (freqOoft) {
      batch.collection('tasks').update(task.id, {
        archived: true,
        archived_at: now.toISOString(),
      });
    }
    // PB SDK 0.26.8 `.send()` resolves to `Array<{ status, body }>` in
    // declaration order (BatchRequestResult — see
    // node_modules/pocketbase/dist/pocketbase.es.d.ts:1168). Verified
    // observationally in Plan 10-03 integration Scenario 9: the
    // completion row's id/completed_at round-trip through results[0]
    // .body cleanly (A1 resolved — no follow-up getOne needed).
    // Phase 11: the OOFT archive op lands at results[1] or results[2]
    // depending on whether an override was also consumed. Only results[0]
    // is order-sensitive reads; nothing downstream reads the archive
    // result directly.
    const results = await batch.send();
    const created = results[0].body as {
      id: string;
      completed_at: string;
      task_id: string;
    };

    // 06-02 GAME-04: build the after-snapshot by overlaying the fresh
    // completion on top of latestBefore (don't re-fetch — avoids a
    // needless PB roundtrip). detectAreaCelebration returns true IFF
    // area coverage crossed from strictly-below 1.0 to exactly 1.0.
    const afterCompletion: CompletionRecord = {
      id: created.id,
      task_id: taskId,
      completed_by_id: userId,
      completed_at: created.completed_at as string,
      notes: '',
      via: 'tap',
    };
    const latestAfter = new Map(latestBefore);
    latestAfter.set(taskId, afterCompletion);
    let celebration:
      | { kind: 'area-100'; areaId: string; areaName: string }
      | undefined;
    // Phase 10 (Wave 3): inject the real override Map so the celebration
    // predicate sees accurate coverage for sibling tasks in the area.
    // The just-consumed override for `taskId` has already had its
    // consumed_at flipped in the batch above; `overridesByTask` still
    // holds its pre-consumption row in-memory, BUT `detectAreaCelebration`
    // uses `computeAreaCoverage` which calls `computeNextDue` which
    // applies the D-10 read-time filter — since `latestAfter` now has
    // the fresh completion at snooze_until's threshold, D-10 stales the
    // entry correctly. Net: the after-snapshot reflects the consumed
    // override semantically even though the Map hasn't been re-fetched.
    if (
      detectAreaCelebration(
        tasksInArea,
        latestBefore,
        latestAfter,
        overridesByTask,
        now,
      )
    ) {
      try {
        const area = await pb
          .collection('areas')
          .getOne(areaId, { fields: 'id,name' });
        celebration = {
          kind: 'area-100',
          areaId,
          areaName: area.name as string,
        };
      } catch {
        /* area gone? silently skip — celebration is nice-to-have */
      }
    }

    // 06-02 NOTF-05: fire partner-completed ntfys to OTHER home members
    // who opted-in. Wrapped in try/catch per D-03 best-effort; a ntfy
    // failure MUST NOT block the completion success response.
    try {
      const admin = await createAdminClient();
      const { sendPartnerCompletedNotifications } = await import(
        '@/lib/scheduler'
      );
      await sendPartnerCompletedNotifications(admin, {
        completerUserId: userId,
        completionId: created.id,
        taskName: task.name as string,
        homeId,
      });
    } catch (e) {
      console.warn(
        '[completeTask] partner-completed failed:',
        (e as Error).message,
      );
    }

    // Compute next-due for the success toast. Phase 10 (D-10): pass
    // `undefined` as the 4th arg — the active override (if any) was
    // just consumed in the batch above, so the natural next-due is the
    // correct answer here. Even if the read raced, D-10's read-time
    // filter (snooze_until > lastCompletion.completed_at) would stale
    // the just-consumed override since lastCompletion is now === now.
    const nextDue = computeNextDue(
      {
        id: task.id,
        created: task.created as string,
        archived: false,
        frequency_days: task.frequency_days as number,
        schedule_mode: task.schedule_mode as 'cycle' | 'anchored',
        anchor_date: (task.anchor_date as string | null) || null,
      },
      { completed_at: now.toISOString() },
      now,
      undefined,
    );
    const nextDueFormatted = nextDue
      ? formatInTimeZone(nextDue, home.timezone as string, 'MMM d, yyyy')
      : 'soon';

    // Pitfall 6 — revalidatePath here; the client component calls
    // router.refresh() on receipt. These are complementary.
    revalidatePath(`/h/${homeId}`);

    return {
      ok: true,
      completion: {
        id: created.id,
        completed_at: created.completed_at as string,
      },
      nextDueFormatted,
      ...(celebration && { celebration }),
    };
  } catch {
    return { ok: false, formError: 'Could not record completion' };
  }
}
