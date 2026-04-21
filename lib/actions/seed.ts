'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/pocketbase-server';
import { assertMembership } from '@/lib/membership';
import { SEED_LIBRARY } from '@/lib/seed-library';
import { batchCreateSeedsSchema } from '@/lib/schemas/seed';

/**
 * Onboarding seed server action (05-03 Task 1, ONBD-01/02/03).
 *
 * `batchCreateSeedTasks` is called by the wizard submit button:
 *   1. Validates the envelope shape via `batchCreateSeedsSchema`.
 *   2. Verifies the caller is a member of the home (defence-in-depth
 *      over PB's tasks.createRule which also checks membership).
 *   3. Verifies every `selection.area_id` belongs to the home
 *      (T-05-03-02 — cross-home area id forging).
 *   4. Verifies every `selection.seed_id` is a real SEED_LIBRARY entry
 *      (T-05-03-01 — fabricated seeds).
 *   5. In a single `pb.createBatch()` transaction: creates N tasks +
 *      flips `homes.onboarded = true`. Atomicity guarantees the home
 *      is never left in a half-seeded state (T-05-03-10).
 *
 * Uses the user's authed pb client (NOT admin) — tasks.createRule gates
 * writes via membership, which the user has (defence-in-depth).
 *
 * PB batch API is enabled via `pocketbase/pb_hooks/bootstrap_batch.pb.js`
 * (Phase 4.2). maxRequests = 50 accommodates the wizard's ceiling of
 * `selections.max(50)` + 1 homes.update op (N+1 ≤ 51, within tolerance).
 */

export type BatchCreateSeedTasksResult =
  | { ok: true; count: number }
  | { ok: false; formError: string };

export async function batchCreateSeedTasks(input: {
  home_id: string;
  selections: Array<{
    seed_id: string;
    name: string;
    frequency_days: number;
    area_id: string;
  }>;
}): Promise<BatchCreateSeedTasksResult> {
  const parsed = batchCreateSeedsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: 'Invalid seed selection' };
  }

  const pb = await createServerClient();
  if (!pb.authStore.isValid) {
    return { ok: false, formError: 'Not signed in' };
  }

  try {
    await assertMembership(pb, parsed.data.home_id);
  } catch {
    return { ok: false, formError: 'You are not a member of this home' };
  }

  // T-05-03-02: verify every selection.area_id belongs to this home.
  // One fetch covers all selections; Set-check is O(1) per selection.
  let areaIds: Set<string>;
  try {
    const areas = await pb.collection('areas').getFullList({
      filter: `home_id = "${parsed.data.home_id}"`,
      fields: 'id',
    });
    areaIds = new Set(areas.map((a) => a.id as string));
  } catch {
    return { ok: false, formError: 'Could not load areas' };
  }

  for (const s of parsed.data.selections) {
    if (!areaIds.has(s.area_id)) {
      return { ok: false, formError: 'Invalid area selected' };
    }
  }

  // T-05-03-01: verify every selection.seed_id is a real SEED_LIBRARY
  // entry. Stops clients from batch-spawning arbitrary seeded payloads
  // outside the curated library.
  const seedIds = new Set(SEED_LIBRARY.map((s) => s.id));
  for (const s of parsed.data.selections) {
    if (!seedIds.has(s.seed_id)) {
      return { ok: false, formError: 'Unknown seed' };
    }
  }

  // Atomic batch: N tasks.create + 1 homes.update. If any op fails, PB
  // rolls the whole transaction back (T-05-03-10).
  try {
    const batch = pb.createBatch();
    for (const s of parsed.data.selections) {
      batch.collection('tasks').create({
        home_id: parsed.data.home_id,
        area_id: s.area_id,
        name: s.name,
        description: '',
        frequency_days: s.frequency_days,
        schedule_mode: 'cycle', // D-12: all seeds are cycle mode
        anchor_date: '',
        icon: '',
        color: '',
        assigned_to_id: '',
        notes: '',
        archived: false,
      });
    }
    batch.collection('homes').update(parsed.data.home_id, {
      onboarded: true,
    });
    await batch.send();
  } catch {
    return { ok: false, formError: 'Could not create tasks' };
  }

  // Revalidate the three Phase 5 per-home views so the freshly-seeded
  // tasks surface immediately on the dashboard + By Area + Person tabs.
  revalidatePath(`/h/${parsed.data.home_id}`);
  revalidatePath(`/h/${parsed.data.home_id}/by-area`);
  revalidatePath(`/h/${parsed.data.home_id}/person`);

  return { ok: true, count: parsed.data.selections.length };
}
