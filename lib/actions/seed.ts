'use server';

import { revalidatePath } from 'next/cache';
import { addDays } from 'date-fns';
import { createServerClient } from '@/lib/pocketbase-server';
import { assertMembership } from '@/lib/membership';
import { SEED_LIBRARY } from '@/lib/seed-library';
import { batchCreateSeedsSchema } from '@/lib/schemas/seed';
import { type Completion, type Task } from '@/lib/task-scheduling';
import {
  getCompletionsForHome,
  reduceLatestByTask,
} from '@/lib/completions';
import { getActiveOverridesForHome } from '@/lib/schedule-overrides';
import {
  computeFirstIdealDate,
  computeHouseholdLoad,
  isoDateKey,
  placeNextDue,
} from '@/lib/load-smoothing';

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
      filter: pb.filter('home_id = {:hid}', { hid: parsed.data.home_id }),
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

  // Phase 14 (SEAS-09): build an id→entry Map for O(1) lookup while
  // threading active_from/to into the tasks.create body below. Reads
  // ONLY from SEED_LIBRARY — client-supplied active_from/to would be
  // ignored even if present (T-14-02: cannot forge seasonal window
  // for a non-seasonal seed).
  const SEED_BY_ID_14 = new Map(SEED_LIBRARY.map((s) => [s.id, s] as const));

  // ─── Phase 13 TCSEM-05 + D-08: load-map threading ──────────────────
  // Pre-compute next_due_smoothed per seed, threading an in-memory load
  // Map forward across seeds so a cohort naturally distributes. Each
  // placement mutates the Map (+1 at the chosen ISO date key) so the
  // NEXT seed's scoring sees the prior seed's chosen date.
  //
  // Seeds are all schedule_mode='cycle' (D-12 Phase 5 invariant) with
  // real positive frequencies (seed-library schema: min(1).max(365)) —
  // no anchored or OOFT bypasses possible here.
  //
  // Atomic-batch preserved (T-05-03-10 + D-09 Phase 5 contract): the
  // N tasks.create + 1 homes.update still ship in ONE pb.createBatch()
  // transaction. Phase 13's only addition is the pre-computed
  // next_due_smoothed per seed; the transaction shape is unchanged.
  try {
    const now = new Date();

    // Fetch home timezone for isoDateKey alignment (Pitfall 7 — same
    // tz on write + lookup sides).
    const home = await pb
      .collection('homes')
      .getOne(parsed.data.home_id, { fields: 'id,timezone' });
    const homeTz = (home.timezone as string) ?? 'UTC';

    // Fetch existing home state for the load map. Seeds run on fresh
    // onboarding but also potentially on a home that already has tasks
    // (user re-opens the wizard after dismissing — defensive).
    const existingTasks = (await pb.collection('tasks').getFullList({
      filter: pb.filter('home_id = {:hid} && archived = false', {
        hid: parsed.data.home_id,
      }),
      fields: [
        'id', 'created', 'archived',
        'frequency_days', 'schedule_mode', 'anchor_date',
        'preferred_days', 'active_from_month', 'active_to_month',
        'due_date', 'next_due_smoothed',
      ].join(','),
    })) as unknown as Task[];

    const existingTaskIds = existingTasks.map((t) => t.id);
    const existingCompletions = await getCompletionsForHome(
      pb, existingTaskIds, now,
    );
    const existingLatestByTask = reduceLatestByTask(existingCompletions);
    const overridesByTask = await getActiveOverridesForHome(
      pb, parsed.data.home_id,
    );

    const householdLoad = computeHouseholdLoad(
      existingTasks,
      existingLatestByTask,
      overridesByTask,
      now,
      120,
      homeTz,
    );

    // Per-seed placement: compute, place, mutate load map, record ISO.
    // index → ISO string (or absent entry = fallback '' in create body).
    const placedDates = new Map<number, string>();

    for (let i = 0; i < parsed.data.selections.length; i++) {
      const s = parsed.data.selections[i];
      try {
        // Seeds have no last_done (D-08 clause 1 — "seeds rarely have
        // last_done"). Smart default kicks in per TCSEM-03.
        const firstIdeal = computeFirstIdealDate(
          'cycle',
          s.frequency_days,
          null, // seeds never carry a last-done date
          now,
        );

        // Synthesize Task + lastCompletion (see createTask Task 2
        // rationale). placeNextDue's internal naturalIdeal =
        // baseIso + freq = firstIdeal.
        const syntheticLastCompletion: Completion = {
          completed_at: addDays(firstIdeal, -s.frequency_days).toISOString(),
        };
        const syntheticTask: Task = {
          id: `seed-pending-${i}`,
          created: now.toISOString(),
          archived: false,
          frequency_days: s.frequency_days,
          schedule_mode: 'cycle',
          anchor_date: null,
          preferred_days: null,
        };

        const placedDate = placeNextDue(
          syntheticTask,
          syntheticLastCompletion,
          householdLoad,
          now,
          { timezone: homeTz },
        );

        // D-08 step 3: mutate the load map in-place so seed i+1's
        // scoring sees seed i's chosen date. isoDateKey is the SAME
        // helper used by computeHouseholdLoad + placeNextDue — DO
        // NOT hand-roll YYYY-MM-DD (Pitfall 7).
        const key = isoDateKey(placedDate, homeTz);
        householdLoad.set(key, (householdLoad.get(key) ?? 0) + 1);

        placedDates.set(i, placedDate.toISOString());
      } catch (e) {
        console.warn(
          `[batchCreateSeedTasks] seed ${i} placement failed (falling back to natural):`,
          (e as Error).message,
        );
        // placedDates absent for this index → create body uses '' fallback.
        // D-06 per-seed best-effort.
      }
    }

    // Atomic batch: N tasks.create + 1 homes.update. If any op fails,
    // PB rolls the whole transaction back (T-05-03-10 preserved from
    // Phase 5). Phase 13 addition: next_due_smoothed pre-computed per
    // seed, included in the create body directly.
    const batch = pb.createBatch();
    for (let i = 0; i < parsed.data.selections.length; i++) {
      const s = parsed.data.selections[i];
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
        // Phase 13 (TCSEM-04): pre-computed smoothed date; '' for any
        // seed whose placement threw (D-06 fallback).
        next_due_smoothed: placedDates.get(i) ?? '',
        // Phase 14 (SEAS-09): thread seasonal window from the matched
        // SEED_LIBRARY entry. Non-seasonal seeds have these undefined,
        // in which case we pass '' (PB NumberField cleared-value) so
        // the Phase 11 zod refine 2 paired-or-null invariant holds at
        // both storage and read sides (null + null = year-round =
        // current v1.0 behaviour for all 30 existing seeds). Matches
        // the `anchor_date: ''` convention used above.
        active_from_month:
          SEED_BY_ID_14.get(s.seed_id)?.active_from_month ?? '',
        active_to_month:
          SEED_BY_ID_14.get(s.seed_id)?.active_to_month ?? '',
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
