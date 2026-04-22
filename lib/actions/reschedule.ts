'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/pocketbase-server';
import { assertMembership } from '@/lib/membership';
import { getActiveOverride } from '@/lib/schedule-overrides';

/**
 * Phase 15 reschedule server actions (D-13, D-14, D-15).
 *
 * Exports:
 *   - snoozeTaskAction(input)        — "Just this time" writes a
 *     schedule_overrides row. Reuses Phase 10 D-02 atomic-replace-active
 *     pattern: if an active override already exists, batch consumes it
 *     and creates the new one in a single pb.createBatch().send().
 *   - rescheduleTaskAction(input)    — "From now on" mutates
 *     tasks.anchor_date (anchored) OR tasks.next_due_smoothed (cycle)
 *     AND sets tasks.reschedule_marker = now. No schedule_overrides
 *     row written (D-09). Phase 17 REBAL preservation reads the marker.
 *
 * Both return the same discriminated-union shape used by Phase 2/3
 * action callers (createTask, completeTaskAction): `{ ok: true, ... }
 * | { ok: false, formError }`. Business outcomes are NEVER thrown —
 * returned as typed results (Pitfall 5).
 *
 * Security posture:
 *   - Membership gate via assertMembership(pb, task.home_id) BEFORE
 *     any write. A forged task_id from a different home fails at the
 *     PB viewRule (tasks.viewRule scopes home_id.owner_id =
 *     @request.auth.id) — the getOne throws, we catch + return a
 *     sanitized formError.
 *   - created_by_id on the override is sourced server-side from
 *     pb.authStore.record.id — NEVER from client input. Mirrors the
 *     completions T-03-01-02 pattern.
 *   - reschedule_marker is server-timestamped (now.toISOString()) —
 *     never read from client input. The action signature only takes
 *     task_id + new_date so a crafted form POST cannot forge a marker.
 *
 * Threat register (see plan <threat_model>):
 *   - T-15-01-01 Spoofing: tasks.getOne preflight, 404 on forged id.
 *   - T-15-01-02 Tampering body: created_by_id server-set.
 *   - T-15-01-03 Tampering marker: server-timestamped.
 *   - T-15-01-04 Payload conflation: ternary writes EXACTLY ONE date
 *     field per mode — unit test asserts .not.toHaveProperty on the
 *     other branch field.
 *   - T-15-01-05 Orphan-active override: pb.createBatch in
 *     snoozeTaskAction consumes prior + creates new in one transaction.
 *   - T-15-01-06 Error leakage: generic sanitized formError strings.
 *   - T-15-01-08 EoP non-member: assertMembership gate before write.
 */

export type SnoozeResult =
  | { ok: true; override: { id: string; snooze_until: string } }
  | { ok: false; formError: string };

export type RescheduleResult =
  | { ok: true; task: { id: string; reschedule_marker: string } }
  | { ok: false; formError: string };

/**
 * "Just this time" — snoozeTaskAction writes a schedule_overrides row.
 * When an active override already exists for the task, this batch
 * atomically consumes the prior row and creates the new one in a
 * single pb.createBatch().send() transaction (Phase 10 D-02
 * atomic-replace-active invariant preserved). No orphan-active-rows
 * window.
 */
export async function snoozeTaskAction(input: {
  task_id: string;
  snooze_until: string; // ISO 8601
}): Promise<SnoozeResult> {
  // Input validation (outside try/catch — typed errors are explicit).
  if (typeof input?.task_id !== 'string' || input.task_id.length === 0) {
    return { ok: false, formError: 'Missing task id' };
  }
  const parsed = new Date(input?.snooze_until ?? '');
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, formError: 'Invalid snooze date' };
  }

  const pb = await createServerClient();
  if (!pb.authStore.isValid) {
    return { ok: false, formError: 'Not signed in' };
  }
  const userId = pb.authStore.record?.id as string;

  try {
    // Ownership preflight (T-15-01-01) — the tasks viewRule is
    // `home_id.owner_id = @request.auth.id`; a forged id 404s here.
    const task = await pb.collection('tasks').getOne(input.task_id, {
      fields: 'id,home_id',
    });
    try {
      await assertMembership(pb, task.home_id as string);
    } catch {
      return { ok: false, formError: 'You are not a member of this home' };
    }

    // Phase 10 D-02 atomic-replace-active precedent
    // (lib/actions/completions.ts:222-245): pre-fetch the current
    // active override and consume it in the same batch as the new-
    // override create. Single pb.createBatch().send() — no orphan-
    // active-rows window (T-15-01-05).
    const prior = await getActiveOverride(pb, input.task_id);
    const now = new Date();

    const batch = pb.createBatch();
    batch.collection('schedule_overrides').create({
      task_id: input.task_id,
      snooze_until: parsed.toISOString(),
      consumed_at: null,
      created_by_id: userId,
    });
    if (prior) {
      batch.collection('schedule_overrides').update(prior.id, {
        consumed_at: now.toISOString(),
      });
    }
    const results = await batch.send();
    const created = results[0].body as {
      id: string;
      snooze_until: string;
    };

    revalidatePath(`/h/${task.home_id}`);
    return {
      ok: true,
      override: {
        id: created.id,
        snooze_until: created.snooze_until,
      },
    };
  } catch {
    return { ok: false, formError: 'Could not save snooze' };
  }
}

/**
 * "From now on" — rescheduleTaskAction mutates the task's scheduling
 * field based on schedule_mode AND stamps reschedule_marker = now.
 *
 * D-14:
 *   - schedule_mode === 'anchored' → { anchor_date, reschedule_marker }
 *   - schedule_mode === 'cycle'    → { next_due_smoothed, reschedule_marker }
 *
 * No schedule_overrides row written (D-09). Phase 17 REBAL preservation
 * reads the non-null reschedule_marker as "user intent wins over
 * recompute" (D-08).
 *
 * OOFT note: one-off tasks (frequency_days=null) still route through
 * the cycle ternary branch here because their schedule_mode stays
 * 'cycle' (D-02 from 15-CONTEXT). The plan defers OOFT-specific
 * "edit the task instead" UX to Wave 2 — the action layer treats
 * OOFT rescheduling symmetrically with cycle tasks at this wave.
 */
export async function rescheduleTaskAction(input: {
  task_id: string;
  new_date: string; // ISO 8601 (date or datetime)
}): Promise<RescheduleResult> {
  if (typeof input?.task_id !== 'string' || input.task_id.length === 0) {
    return { ok: false, formError: 'Missing task id' };
  }
  const parsed = new Date(input?.new_date ?? '');
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, formError: 'Invalid new date' };
  }

  const pb = await createServerClient();
  if (!pb.authStore.isValid) {
    return { ok: false, formError: 'Not signed in' };
  }

  try {
    const task = await pb.collection('tasks').getOne(input.task_id, {
      fields: 'id,home_id,schedule_mode',
    });
    try {
      await assertMembership(pb, task.home_id as string);
    } catch {
      return { ok: false, formError: 'You are not a member of this home' };
    }

    const now = new Date();
    const markerIso = now.toISOString();
    const newDateIso = parsed.toISOString();

    // D-14: anchored-mode writes anchor_date; cycle-mode writes
    // next_due_smoothed. Both set reschedule_marker. No
    // schedule_overrides row (D-09). T-15-01-04: exactly one of the
    // two date fields is written — unit tests assert
    // .not.toHaveProperty on the other.
    const payload =
      task.schedule_mode === 'anchored'
        ? { anchor_date: newDateIso, reschedule_marker: markerIso }
        : { next_due_smoothed: newDateIso, reschedule_marker: markerIso };

    const updated = await pb
      .collection('tasks')
      .update(input.task_id, payload);

    revalidatePath(`/h/${task.home_id}`);
    return {
      ok: true,
      task: {
        id: updated.id,
        reschedule_marker: markerIso,
      },
    };
  } catch {
    return { ok: false, formError: 'Could not reschedule task' };
  }
}
