'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/pocketbase-server';
import { createAdminClient } from '@/lib/pocketbase-admin';
import { assertMembership } from '@/lib/membership';
import { taskSchema } from '@/lib/schemas/task';
import type { ActionState } from '@/lib/schemas/auth';

/**
 * Task server actions (02-05 Plan).
 *
 * Exports:
 *   - createTask    → TASK-01 (user creates a task in an area)
 *   - updateTask    → TASK-05 (edit name / frequency / mode / anchor /
 *                    notes / description)
 *   - archiveTask   → TASK-06 (soft-delete: archived=true + archived_at=now)
 *
 * Security posture (threat_model T-02-05-01..08):
 *   - Ownership preflight: `pb.collection('homes').getOne(home_id)` and
 *     `pb.collection('areas').getOne(area_id)`. Both collections have PB
 *     viewRules scoping to `home_id.owner_id = @request.auth.id` (homes) /
 *     `home_id.owner_id = @request.auth.id` (areas), so forged home/area
 *     ids from formData fail at the PB layer first. The preflight surfaces
 *     a friendly error before the create call hits a cryptic 404. (T-02-05-01)
 *   - Archived state is NEVER accepted from client formData — createTask
 *     always sets `archived: false` + no `archived_at`; archiveTask always
 *     sets `archived: true` + `archived_at: new Date().toISOString()`.
 *     (T-02-05-08)
 *   - PB errors never re-thrown — sanitised formError string only. (Generic
 *     "Could not create/save/archive task".)
 *   - User-input values never concatenated into PB filter strings (no
 *     filter call in this file reads formData). (T-02-04-01 carryover)
 *   - XSS on notes/description is handled by React's auto-escape at render
 *     time — we NEVER use dangerouslySetInnerHTML for user text in Phase 2.
 *     (T-02-05-04)
 */

export async function createTask(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const rawDesc = String(formData.get('description') ?? '').trim();
  const rawNotes = String(formData.get('notes') ?? '').trim();
  const rawIcon = String(formData.get('icon') ?? '').trim();
  const rawColor = String(formData.get('color') ?? '').trim();
  const rawAnchor = String(formData.get('anchor_date') ?? '').trim();
  const rawFreq = Number(formData.get('frequency_days') ?? 0);
  const rawMode = String(formData.get('schedule_mode') ?? 'cycle').trim();
  const rawAssigned = String(formData.get('assigned_to_id') ?? '').trim();

  const raw = {
    home_id: String(formData.get('home_id') ?? '').trim(),
    area_id: String(formData.get('area_id') ?? '').trim(),
    name: String(formData.get('name') ?? '').trim(),
    description: rawDesc,
    frequency_days: Number.isFinite(rawFreq) ? rawFreq : 0,
    schedule_mode: (rawMode === 'anchored' ? 'anchored' : 'cycle') as
      | 'cycle'
      | 'anchored',
    // Normalise empty string → null for the refine (anchored requires non-null).
    anchor_date: rawAnchor.length > 0 ? rawAnchor : null,
    icon: rawIcon,
    color: rawColor,
    // 04-02: assigned_to_id is member-user-id or empty string ("" = no
    // specific assignee → resolveAssignee falls through to area default
    // in Wave 3). Validity is enforced by PB's relation field rule; if
    // the client forged a non-member id, the rule rejects the write.
    assigned_to_id: rawAssigned.length > 0 ? rawAssigned : null,
    notes: rawNotes,
  };

  const parsed = taskSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const pb = await createServerClient();
  if (!pb.authStore.isValid) {
    return { ok: false, formError: 'Not signed in' };
  }

  // 04-02 D-13: createTask is member-permitted. Swap the owner-implicit
  // homes.getOne preflight for assertMembership; keep the areas.getOne
  // call for the home_id-mismatch sanity check.
  try {
    await assertMembership(pb, parsed.data.home_id);
  } catch {
    return { ok: false, formError: 'You are not a member of this home' };
  }

  try {
    const area = await pb.collection('areas').getOne(parsed.data.area_id);

    // Defensive: belt-and-braces check that the chosen area actually
    // belongs to the chosen home (PB viewRule already catches this, but
    // a fast server-side sanity check improves error clarity).
    if (area.home_id !== parsed.data.home_id) {
      return { ok: false, formError: 'Selected area does not belong to this home' };
    }

    await pb.collection('tasks').create({
      home_id: parsed.data.home_id,
      area_id: parsed.data.area_id,
      name: parsed.data.name,
      description: parsed.data.description ?? '',
      frequency_days: parsed.data.frequency_days,
      schedule_mode: parsed.data.schedule_mode,
      // PB expects ISO-ish strings for date fields; '' is fine for null.
      anchor_date:
        parsed.data.schedule_mode === 'anchored'
          ? (parsed.data.anchor_date ?? '')
          : '',
      icon: parsed.data.icon ?? '',
      color: parsed.data.color ?? '',
      // 04-02 TASK-02: empty string = null relation in PB.
      assigned_to_id: parsed.data.assigned_to_id ?? '',
      notes: parsed.data.notes ?? '',
      // SECURITY: archived is server-controlled, never from formData.
      archived: false,
    });
  } catch {
    return { ok: false, formError: 'Could not create task' };
  }

  // Revalidate listing pages so the new task appears in the area list and
  // the home dashboard's per-area count.
  revalidatePath(`/h/${parsed.data.home_id}`);
  revalidatePath(`/h/${parsed.data.home_id}/areas/${parsed.data.area_id}`);
  redirect(`/h/${parsed.data.home_id}/areas/${parsed.data.area_id}`);
}

export async function updateTask(
  taskId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const rawDesc = String(formData.get('description') ?? '').trim();
  const rawNotes = String(formData.get('notes') ?? '').trim();
  const rawIcon = String(formData.get('icon') ?? '').trim();
  const rawColor = String(formData.get('color') ?? '').trim();
  const rawAnchor = String(formData.get('anchor_date') ?? '').trim();
  const rawFreq = Number(formData.get('frequency_days') ?? 0);
  const rawMode = String(formData.get('schedule_mode') ?? 'cycle').trim();
  const rawAssigned = String(formData.get('assigned_to_id') ?? '').trim();

  const raw = {
    home_id: String(formData.get('home_id') ?? '').trim(),
    area_id: String(formData.get('area_id') ?? '').trim(),
    name: String(formData.get('name') ?? '').trim(),
    description: rawDesc,
    frequency_days: Number.isFinite(rawFreq) ? rawFreq : 0,
    schedule_mode: (rawMode === 'anchored' ? 'anchored' : 'cycle') as
      | 'cycle'
      | 'anchored',
    anchor_date: rawAnchor.length > 0 ? rawAnchor : null,
    icon: rawIcon,
    color: rawColor,
    // 04-02 TASK-02: passthrough from formData; PB relation-field
    // validation enforces the assignee must be a valid user id.
    assigned_to_id: rawAssigned.length > 0 ? rawAssigned : null,
    notes: rawNotes,
  };

  const parsed = taskSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const pb = await createServerClient();
  if (!pb.authStore.isValid) {
    return { ok: false, formError: 'Not signed in' };
  }

  // 04-02 D-13: updateTask is member-permitted.
  try {
    await assertMembership(pb, parsed.data.home_id);
  } catch {
    return { ok: false, formError: 'You are not a member of this home' };
  }

  // 06-02 D-06: capture previous assignee BEFORE the update so we can
  // detect a non-null change and fire the assigned ntfy afterwards.
  // The tasks.viewRule gates this read (T-06-02-02); a forged taskId for
  // a non-member home 404s here, matching the update behaviour below.
  let previousAssignedToId: string | null = null;
  try {
    const prev = await pb
      .collection('tasks')
      .getOne(taskId, { fields: 'id,home_id,assigned_to_id,name' });
    previousAssignedToId = (prev.assigned_to_id as string) || null;
  } catch {
    /* update will surface the error below */
  }

  try {
    await pb.collection('tasks').update(taskId, {
      name: parsed.data.name,
      description: parsed.data.description ?? '',
      frequency_days: parsed.data.frequency_days,
      schedule_mode: parsed.data.schedule_mode,
      anchor_date:
        parsed.data.schedule_mode === 'anchored'
          ? (parsed.data.anchor_date ?? '')
          : '',
      icon: parsed.data.icon ?? '',
      color: parsed.data.color ?? '',
      // 04-02 TASK-02: empty string = null relation in PB.
      assigned_to_id: parsed.data.assigned_to_id ?? '',
      notes: parsed.data.notes ?? '',
      area_id: parsed.data.area_id,
      // SECURITY: never accept `archived` from formData on update either.
      // Archive is a separate explicit action.
    });
  } catch {
    return { ok: false, formError: 'Could not save task' };
  }

  // 06-02 NOTF-04: fire assigned ntfy when assigned_to_id changes to a
  // NEW non-null user. Admin-client scoped because the authed pb client
  // cannot write to notifications (createRule=null). Wrapped in try/catch —
  // D-03 best-effort: ntfy failure MUST NOT block the update response.
  const newAssignedToId = parsed.data.assigned_to_id ?? null;
  if (newAssignedToId && newAssignedToId !== previousAssignedToId) {
    try {
      const admin = await createAdminClient();
      const { sendAssignedNotification } = await import('@/lib/scheduler');
      await sendAssignedNotification(admin, {
        assigneeUserId: newAssignedToId,
        taskId,
        taskName: parsed.data.name,
        homeId: parsed.data.home_id,
        assignedAtIso: new Date().toISOString(),
      });
    } catch (e) {
      console.warn(
        '[updateTask] assigned-notification failed:',
        (e as Error).message,
      );
    }
  }

  revalidatePath(`/h/${parsed.data.home_id}`);
  revalidatePath(`/h/${parsed.data.home_id}/areas/${parsed.data.area_id}`);
  revalidatePath(`/h/${parsed.data.home_id}/tasks/${taskId}`);
  return { ok: true };
}

/**
 * Soft-archive a task. Sets archived=true + archived_at=nowISO. Does NOT
 * delete the PB record — completions (Phase 3) will reference archived
 * tasks for historical context, so preserving the row matters.
 *
 * Called from the task detail page as a single-purpose button form. The
 * PB updateRule on tasks enforces `home_id.owner_id = @request.auth.id`,
 * so a forged task id belonging to another user is rejected at the DB
 * layer (T-02-05-05).
 */
export async function archiveTask(taskId: string): Promise<ActionState> {
  if (typeof taskId !== 'string' || taskId.length === 0) {
    return { ok: false, formError: 'Missing task id' };
  }

  const pb = await createServerClient();
  if (!pb.authStore.isValid) {
    return { ok: false, formError: 'Not signed in' };
  }

  let homeId: string | undefined;
  let areaId: string | undefined;
  try {
    // Fetch the task so we know which paths to revalidate after the
    // archive. The getOne call also triggers the viewRule — a forged
    // task id for a non-member home 404s here before the update.
    const task = await pb.collection('tasks').getOne(taskId, {
      fields: 'id,home_id,area_id',
    });
    homeId = typeof task.home_id === 'string' ? task.home_id : undefined;
    areaId = typeof task.area_id === 'string' ? task.area_id : undefined;

    // 04-02 D-13: archiveTask is member-permitted. Re-check membership
    // via the fetched home_id — defense in depth over the PB rule.
    if (homeId) {
      try {
        await assertMembership(pb, homeId);
      } catch {
        return { ok: false, formError: 'You are not a member of this home' };
      }
    }

    await pb.collection('tasks').update(taskId, {
      archived: true,
      archived_at: new Date().toISOString(),
    });
  } catch {
    return { ok: false, formError: 'Could not archive task' };
  }

  if (homeId) revalidatePath(`/h/${homeId}`);
  if (homeId && areaId) {
    revalidatePath(`/h/${homeId}/areas/${areaId}`);
  }
  if (homeId) revalidatePath(`/h/${homeId}/tasks/${taskId}`);
  return { ok: true };
}
