'use server';

import { revalidatePath } from 'next/cache';
import { formatInTimeZone } from 'date-fns-tz';
import { createServerClient } from '@/lib/pocketbase-server';
import { assertMembership } from '@/lib/membership';
import { shouldWarnEarly } from '@/lib/early-completion-guard';
import { computeNextDue } from '@/lib/task-scheduling';

/**
 * Completion server action (03-01 Plan, Pattern 4, Pitfalls 5/6/13).
 *
 * Exports:
 *   - completeTaskAction(taskId, { force? })
 *
 * Security posture (threat_model T-03-01-01..08):
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
        'id,home_id,frequency_days,schedule_mode,anchor_date,archived,created,name',
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
        .getFirstListItem(`task_id = "${taskId}"`, {
          sort: '-completed_at',
          fields: 'id,completed_at',
        });
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

    // Write the completion. `completed_by_id` is server-set from
    // `pb.authStore` — NEVER from client input (T-03-01-02). PB
    // createRule also enforces the body match as defense-in-depth.
    const created = await pb.collection('completions').create({
      task_id: taskId,
      completed_by_id: userId,
      completed_at: now.toISOString(),
      via: 'tap', // Pitfall 13
      notes: '',
    });

    // Compute next-due for the success toast.
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
    };
  } catch {
    return { ok: false, formError: 'Could not record completion' };
  }
}
