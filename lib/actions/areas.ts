'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/pocketbase-server';
import { assertMembership } from '@/lib/membership';
import { areaSchema } from '@/lib/schemas/area';
import type { ActionState } from '@/lib/schemas/auth';
import { AREA_COLORS, AREA_ICONS } from '@/lib/area-palette';

/**
 * Area server actions (02-04 Plan).
 *
 * Exports:
 *   - createArea   → AREA-01/04 (user creates a location-scoped area)
 *   - updateArea   → AREA-05 (edit existing area name/icon/color)
 *   - reorderAreas → AREA-05 drag-to-reorder via atomic pb.createBatch()
 *                    (RESEARCH §Pattern: Drag-to-Reorder lines 1107-1138
 *                    + Pitfall 13: batch atomicity)
 *   - deleteArea   → AREA-02 UI-layer guard on is_whole_home_system=true;
 *                    PB deleteRule gives the defence-in-depth layer.
 *
 * Security posture (threat_model T-02-04-01, T-02-04-03, T-02-04-04):
 *   - createArea/updateArea never accept an `is_whole_home_system` key
 *     from client formData — the Whole Home row is system-only and is
 *     only ever written by the onRecordCreateExecute(homes) hook.
 *   - deleteArea loads the target record server-side to decide the guard;
 *     the client CANNOT bypass the UI absence of the delete button via a
 *     direct action call because the action itself re-checks.
 *   - PB errors never re-thrown — sanitised formError string only.
 */

/**
 * Create a location-scoped area. `scope` is forced to 'location' on the
 * server (regardless of formData). Whole Home areas are only created by
 * the PB hook on home insert — there is no client-facing path to create
 * another whole_home area.
 *
 * `sort_order` auto-appends at the bottom: fetch max existing for the
 * home and add 1. Whole Home starts at 0, so new areas land at 1, 2, …
 */
export async function createArea(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const homeId = String(formData.get('home_id') ?? '').trim();
  const rawIcon = String(formData.get('icon') ?? '').trim() || AREA_ICONS[0];
  const rawColor = String(formData.get('color') ?? '').trim() || AREA_COLORS[0];

  const raw = {
    home_id: homeId,
    name: String(formData.get('name') ?? '').trim(),
    icon: rawIcon,
    color: rawColor,
    sort_order: 0, // placeholder; overwritten below with max+1
    scope: 'location' as const,
  };

  const parsed = areaSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const pb = await createServerClient();
  if (!pb.authStore.isValid) {
    return { ok: false, formError: 'Not signed in' };
  }

  // 04-02 D-13: createArea is member-permitted (not owner-only). Swap
  // the old owner-implicit getOne preflight for the membership helper.
  try {
    await assertMembership(pb, parsed.data.home_id);
  } catch {
    return { ok: false, formError: 'You are not a member of this home' };
  }

  try {
    // Compute sort_order = max(existing) + 1. An empty list returns -1
    // so the first user-created area lands at 0 (Whole Home is already
    // at 0 from the hook, but this is a safe default — E2E reorder test
    // re-writes sort_order anyway).
    const existing = await pb.collection('areas').getFullList({
      filter: pb.filter('home_id = {:hid}', { hid: parsed.data.home_id }),
      sort: '-sort_order',
      fields: 'sort_order',
    });
    const nextSort =
      existing.length > 0
        ? (Number(existing[0].sort_order) || 0) + 1
        : 0;

    await pb.collection('areas').create({
      home_id: parsed.data.home_id,
      name: parsed.data.name,
      icon: parsed.data.icon,
      color: parsed.data.color,
      sort_order: nextSort,
      scope: 'location',
      is_whole_home_system: false,
    });
  } catch {
    return { ok: false, formError: 'Could not create area' };
  }

  revalidatePath(`/h/${parsed.data.home_id}`);
  revalidatePath(`/h/${parsed.data.home_id}/areas`);
  return { ok: true };
}

/**
 * Update an existing area. Does NOT accept scope/is_whole_home_system
 * from formData — those are immutable post-create in this plan.
 */
export async function updateArea(
  areaId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const homeId = String(formData.get('home_id') ?? '').trim();
  const rawIcon = String(formData.get('icon') ?? '').trim() || AREA_ICONS[0];
  const rawColor = String(formData.get('color') ?? '').trim() || AREA_COLORS[0];
  const rawSort = Number(formData.get('sort_order') ?? 0);

  const raw = {
    home_id: homeId,
    name: String(formData.get('name') ?? '').trim(),
    icon: rawIcon,
    color: rawColor,
    sort_order: Number.isFinite(rawSort) ? rawSort : 0,
    // scope is passed through for validation only — we don't write it
    // back on update (see update payload below).
    scope: (String(formData.get('scope') ?? 'location').trim() ||
      'location') as 'location' | 'whole_home',
  };

  const parsed = areaSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const pb = await createServerClient();
  if (!pb.authStore.isValid) {
    return { ok: false, formError: 'Not signed in' };
  }

  // 04-02 D-13: updateArea is member-permitted. Membership-preflight
  // via home_id from the validated form data.
  try {
    await assertMembership(pb, parsed.data.home_id);
  } catch {
    return { ok: false, formError: 'You are not a member of this home' };
  }

  try {
    await pb.collection('areas').update(areaId, {
      name: parsed.data.name,
      icon: parsed.data.icon,
      color: parsed.data.color,
      // sort_order preserved from form so a save from the edit page
      // doesn't clobber drag-reorder state.
      sort_order: parsed.data.sort_order,
    });
  } catch {
    return { ok: false, formError: 'Could not save area' };
  }

  revalidatePath(`/h/${parsed.data.home_id}`);
  revalidatePath(`/h/${parsed.data.home_id}/areas`);
  return { ok: true };
}

/**
 * Atomic drag-reorder via pb.createBatch() per RESEARCH §Pattern:
 * Drag-to-Reorder (lines 1107-1138). All updates commit together or
 * all roll back — Pitfall 13.
 *
 * Each batch sub-request passes through areas.updateRule on the PB side,
 * so a forged /api/batch call trying to reorder areas the user doesn't
 * own is rejected (T-02-04-04).
 */
export async function reorderAreas(
  homeId: string,
  orderedIds: string[],
): Promise<ActionState> {
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return { ok: false, formError: 'No areas to reorder' };
  }

  const pb = await createServerClient();
  if (!pb.authStore.isValid) {
    return { ok: false, formError: 'Not signed in' };
  }

  // 04-02 D-13: reorderAreas is member-permitted.
  try {
    await assertMembership(pb, homeId);
  } catch {
    return { ok: false, formError: 'You are not a member of this home' };
  }

  try {
    const batch = pb.createBatch();
    orderedIds.forEach((id, idx) => {
      batch.collection('areas').update(id, { sort_order: idx });
    });
    await batch.send();
  } catch {
    return { ok: false, formError: 'Could not save area order' };
  }

  revalidatePath(`/h/${homeId}`);
  revalidatePath(`/h/${homeId}/areas`);
  return { ok: true };
}

/**
 * Delete an area. Guards is_whole_home_system=true at the action layer
 * (so the error reaches the UI as a friendly formError rather than a raw
 * PB 403). PB's deleteRule on the areas collection already blocks the
 * same case at the DB layer (defence-in-depth per Open Q #4 resolution
 * + threat_model T-02-04-03).
 */
export async function deleteArea(areaId: string): Promise<ActionState> {
  if (typeof areaId !== 'string' || areaId.length === 0) {
    return { ok: false, formError: 'Missing area id' };
  }

  const pb = await createServerClient();
  if (!pb.authStore.isValid) {
    return { ok: false, formError: 'Not signed in' };
  }

  let homeId: string | undefined;
  try {
    const area = await pb.collection('areas').getOne(areaId);
    homeId = typeof area.home_id === 'string' ? area.home_id : undefined;

    // 04-02 D-13: deleteArea is member-permitted (but the
    // is_whole_home_system guard still blocks deletion of the Whole
    // Home row for everyone including owners — see Phase 2 D-04).
    if (homeId) {
      try {
        await assertMembership(pb, homeId);
      } catch {
        return { ok: false, formError: 'You are not a member of this home' };
      }
    }

    if (area.is_whole_home_system === true) {
      return {
        ok: false,
        formError: 'The Whole Home area cannot be deleted',
      };
    }

    await pb.collection('areas').delete(areaId);
  } catch {
    return { ok: false, formError: 'Could not delete area' };
  }

  if (homeId) {
    revalidatePath(`/h/${homeId}`);
    revalidatePath(`/h/${homeId}/areas`);
  }
  return { ok: true };
}
