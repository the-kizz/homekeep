'use server';

import { revalidatePath } from 'next/cache';
import { addDays } from 'date-fns';
import { createServerClient } from '@/lib/pocketbase-server';
import { assertMembership } from '@/lib/membership';
import {
  SEED_LIBRARY,
  SUGGESTED_AREA_DEFAULTS,
  hemisphereFromTimezone,
  seasonWindow,
  type SeedTask,
} from '@/lib/seed-library';
import {
  batchCreateSeedsSchema,
  SUGGESTED_AREA_KEYS,
  type SeedSelectionInput,
  type SuggestedAreaKey,
} from '@/lib/schemas/seed';
import { areaSchema } from '@/lib/schemas/area';
import { assertAreasQuota, assertTasksQuota } from '@/lib/quotas';
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
 * Onboarding seed server action, called by the wizard's submit button.
 *
 *   1. Validates the envelope (`batchCreateSeedsSchema`) and membership.
 *   2. Resolves every selection against SEED_LIBRARY: unknown seed ids are
 *      rejected, and name / frequency fall back to the library defaults
 *      when the wizard sent no override. Seasonal months come only from
 *      the library's season tag plus the home's hemisphere.
 *   3. Refuses the whole batch if it would take the home past its active
 *      task quota.
 *   4. Resolves each selection's area: an existing id must belong to this
 *      home; a suggested key reuses a same-named area or creates it once
 *      (within the area quota — over quota, those seeds land on Whole Home).
 *      Area creation is not part of the task batch; a stray empty area after
 *      a failed batch is harmless and gets reused on retry.
 *   5. In one `pb.createBatch()` transaction creates the tasks and flips
 *      `homes.onboarded = true`, so the home is never half-seeded.
 *
 * Uses the user's authed client (not admin): PB's createRules re-check
 * membership on every write.
 */

export type BatchCreateSeedTasksResult =
  | { ok: true; count: number; areasCreated: number }
  | { ok: false; formError: string };

type ResolvedSelection = {
  seed: SeedTask;
  name: string;
  frequency_days: number;
  area_id: string;
};

// Mirrors lib/quotas.ts so the additive check below uses the same ceiling
// that assertTasksQuota enforces for single creates.
function maxTasksPerHome(): number {
  const n = parseInt(process.env.MAX_TASKS_PER_HOME ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 500;
}

const TASK_LIMIT_ERROR = 'This home has reached its task limit';

export async function batchCreateSeedTasks(input: {
  home_id: string;
  selections: SeedSelectionInput[];
}): Promise<BatchCreateSeedTasksResult> {
  const parsed = batchCreateSeedsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: 'Invalid seed selection' };
  }
  const homeId = parsed.data.home_id;
  const selections = parsed.data.selections;

  const pb = await createServerClient();
  if (!pb.authStore.isValid) {
    return { ok: false, formError: 'Not signed in' };
  }

  try {
    await assertMembership(pb, homeId);
  } catch {
    return { ok: false, formError: 'You are not a member of this home' };
  }

  // Only curated seeds can be batch-created; this also stops a client
  // from smuggling arbitrary payloads through the seed path.
  const seedById = new Map(SEED_LIBRARY.map((s) => [s.id, s] as const));
  for (const s of selections) {
    if (!seedById.has(s.seed_id)) {
      return { ok: false, formError: 'Unknown seed' };
    }
  }

  let areas: Array<{
    id: string;
    name: string;
    is_whole_home_system: boolean;
    sort_order: number;
  }>;
  try {
    const rows = await pb.collection('areas').getFullList({
      filter: pb.filter('home_id = {:hid}', { hid: homeId }),
      fields: 'id,name,is_whole_home_system,sort_order',
    });
    areas = rows.map((a) => ({
      id: a.id as string,
      name: String(a.name ?? ''),
      is_whole_home_system: a.is_whole_home_system === true,
      sort_order: Number(a.sort_order) || 0,
    }));
  } catch {
    return { ok: false, formError: 'Could not load areas' };
  }

  // Cross-home area ids are rejected before anything is written.
  const areaIds = new Set(areas.map((a) => a.id));
  for (const s of selections) {
    if (s.area.kind === 'existing' && !areaIds.has(s.area.id)) {
      return { ok: false, formError: 'Invalid area selected' };
    }
  }

  let homeTz: string;
  let existingTasks: Task[];
  try {
    const home = await pb
      .collection('homes')
      .getOne(homeId, { fields: 'id,timezone' });
    homeTz = (home.timezone as string) || 'UTC';

    const quota = await assertTasksQuota(pb, homeId);
    if (!quota.ok) return { ok: false, formError: TASK_LIMIT_ERROR };

    existingTasks = (await pb.collection('tasks').getFullList({
      filter: pb.filter('home_id = {:hid} && archived = false', { hid: homeId }),
      fields: [
        'id', 'created', 'archived',
        'frequency_days', 'schedule_mode', 'anchor_date',
        'preferred_days', 'active_from_month', 'active_to_month',
        'due_date', 'next_due_smoothed',
      ].join(','),
    })) as unknown as Task[];
  } catch {
    return { ok: false, formError: 'Could not create tasks' };
  }

  const max = maxTasksPerHome();
  const room = max - existingTasks.length;
  if (selections.length > room) {
    return {
      ok: false,
      formError:
        room > 0
          ? `${TASK_LIMIT_ERROR} — there is room for ${room} more.`
          : TASK_LIMIT_ERROR,
    };
  }

  // ─── Area resolution ──────────────────────────────────────────────────
  const wholeHome = areas.find((a) => a.is_whole_home_system);
  if (!wholeHome) {
    return { ok: false, formError: 'Could not load areas' };
  }

  const neededKeys = new Set<SuggestedAreaKey>();
  for (const s of selections) {
    if (s.area.kind === 'suggested' && s.area.key !== 'whole_home') {
      neededKeys.add(s.area.key);
    }
  }

  const areaIdByKey = new Map<SuggestedAreaKey, string>([
    ['whole_home', wholeHome.id],
  ]);
  let areasCreated = 0;
  let nextSort = Math.max(0, ...areas.map((a) => a.sort_order)) + 1;

  // Fixed key order so area sort order is predictable regardless of the
  // order seeds arrive in.
  for (const key of SUGGESTED_AREA_KEYS) {
    if (key === 'whole_home' || !neededKeys.has(key)) continue;
    const spec = SUGGESTED_AREA_DEFAULTS[key];
    const existing = areas.find(
      (a) =>
        !a.is_whole_home_system &&
        a.name.trim().toLowerCase() === spec.name.toLowerCase(),
    );
    if (existing) {
      areaIdByKey.set(key, existing.id);
      continue;
    }

    const quota = await assertAreasQuota(pb, homeId).catch(() => ({
      ok: false as const,
    }));
    const body = areaSchema.safeParse({
      home_id: homeId,
      name: spec.name,
      icon: spec.icon,
      color: spec.color,
      sort_order: nextSort,
      scope: 'location',
    });
    if (!quota.ok || !body.success) {
      areaIdByKey.set(key, wholeHome.id);
      continue;
    }
    try {
      const created = await pb.collection('areas').create({
        home_id: homeId,
        name: body.data.name,
        icon: body.data.icon,
        color: body.data.color,
        sort_order: body.data.sort_order,
        scope: 'location',
        is_whole_home_system: false,
      });
      areaIdByKey.set(key, created.id as string);
      areasCreated += 1;
      nextSort += 1;
    } catch (e) {
      console.warn(
        `[batchCreateSeedTasks] could not create area '${spec.name}' (using Whole Home):`,
        (e as Error).message,
      );
      areaIdByKey.set(key, wholeHome.id);
    }
  }

  const resolved: ResolvedSelection[] = selections.map((s) => {
    const seed = seedById.get(s.seed_id)!;
    return {
      seed,
      name: s.name ?? seed.name,
      frequency_days: s.frequency_days ?? seed.frequency_days,
      area_id:
        s.area.kind === 'existing'
          ? s.area.id
          : (areaIdByKey.get(s.area.key) ?? wholeHome.id),
    };
  });

  // ─── First-due placement ──────────────────────────────────────────────
  // Each seed is placed through the load-smoothing bridge with the load map
  // threaded forward, so a cohort spreads across days. On top of that the
  // batch is staggered across the cycle so a new home doesn't open with
  // everything due in week one: seed i gets a synthetic last completion
  // (i % 4) quarters of a cycle ago, i.e. it is due after the full,
  // three-quarter, half or quarter cycle. Daily-ish tasks (every 3 days or
  // less) skip the stagger and keep the natural smart default.
  try {
    const now = new Date();
    const existingCompletions = await getCompletionsForHome(
      pb,
      existingTasks.map((t) => t.id),
      now,
    );
    const householdLoad = computeHouseholdLoad(
      existingTasks,
      reduceLatestByTask(existingCompletions),
      await getActiveOverridesForHome(pb, homeId),
      now,
      120,
      homeTz,
    );

    const placedDates = new Map<number, string>();
    for (let i = 0; i < resolved.length; i++) {
      const freq = resolved[i].frequency_days;
      try {
        const syntheticLastCompletion: Completion = {
          completed_at:
            freq <= 3
              ? addDays(
                  computeFirstIdealDate('cycle', freq, null, now),
                  -freq,
                ).toISOString()
              : addDays(now, -Math.round((freq * (i % 4)) / 4)).toISOString(),
        };
        const syntheticTask: Task = {
          id: `seed-pending-${i}`,
          created: now.toISOString(),
          archived: false,
          frequency_days: freq,
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

        // Same key helper as computeHouseholdLoad/placeNextDue so the next
        // seed's scoring sees this one.
        const key = isoDateKey(placedDate, homeTz);
        householdLoad.set(key, (householdLoad.get(key) ?? 0) + 1);
        placedDates.set(i, placedDate.toISOString());
      } catch (e) {
        // Best effort per seed: an empty next_due_smoothed falls back to
        // the natural schedule at read time.
        console.warn(
          `[batchCreateSeedTasks] seed ${i} placement failed (falling back to natural):`,
          (e as Error).message,
        );
      }
    }

    const hemisphere = hemisphereFromTimezone(homeTz);
    const batch = pb.createBatch();
    for (let i = 0; i < resolved.length; i++) {
      const r = resolved[i];
      const seasonal = r.seed.season
        ? seasonWindow(r.seed.season, hemisphere)
        : null;
      batch.collection('tasks').create({
        home_id: homeId,
        area_id: r.area_id,
        name: r.name,
        description: '',
        frequency_days: r.frequency_days,
        schedule_mode: 'cycle',
        anchor_date: '',
        icon: '',
        color: '',
        assigned_to_id: '',
        notes: '',
        archived: false,
        next_due_smoothed: placedDates.get(i) ?? '',
        // '' clears a PB number field: year-round seeds store null/null.
        active_from_month:
          seasonal?.active_from_month ?? r.seed.active_from_month ?? '',
        active_to_month:
          seasonal?.active_to_month ?? r.seed.active_to_month ?? '',
      });
    }
    batch.collection('homes').update(homeId, { onboarded: true });
    await batch.send();
  } catch {
    return { ok: false, formError: 'Could not create tasks' };
  }

  revalidatePath(`/h/${homeId}`);
  revalidatePath(`/h/${homeId}/by-area`);
  revalidatePath(`/h/${homeId}/areas`);
  revalidatePath(`/h/${homeId}/person`);

  return { ok: true, count: resolved.length, areasCreated };
}
