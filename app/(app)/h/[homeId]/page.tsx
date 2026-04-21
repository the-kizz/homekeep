import { notFound } from 'next/navigation';
import { createServerClient } from '@/lib/pocketbase-server';
import {
  getCompletionsForHome,
  type CompletionRecord,
} from '@/lib/completions';
import { BandView, type TaskWithName } from '@/components/band-view';

/**
 * /h/[homeId] — Phase 3 three-band dashboard (D-11, D-18, D-19).
 *
 * Replaces the Phase 2 "areas list + task counts" stub entirely —
 * areas remain accessible via /h/[homeId]/areas (untouched Phase 2
 * route). This file is the Server Component baseline: it fetches
 * home + tasks + completions in (at most) three round-trips, reduces
 * completions client-side via reduceLatestByTask inside
 * <BandView>, and hands the Client Component a stable props snapshot
 * keyed to a single server-owned `now` instant.
 *
 * Security:
 *   - `pb.collection('homes').getOne(homeId)` triggers the PB
 *     viewRule (@request.auth.id != "" && owner_id =
 *     @request.auth.id); forged homeIds 404 via notFound().
 *   - Tasks are filtered `archived = false` at the PB layer.
 *   - completions are bounded to a 13-month window via
 *     getCompletionsForHome (03-01 Pattern 2).
 *
 * Next 16 async params contract: `params: Promise<{ homeId }>`.
 */
export default async function HomeDashboardPage({
  params,
}: {
  params: Promise<{ homeId: string }>;
}) {
  const { homeId } = await params;
  const pb = await createServerClient();
  const userId = pb.authStore.record?.id as string | undefined;
  if (!userId) notFound();

  let home;
  try {
    home = await pb.collection('homes').getOne(homeId, {
      fields: 'id,name,timezone',
    });
  } catch {
    notFound();
  }

  const tasks = await pb.collection('tasks').getFullList({
    filter: `home_id = "${homeId}" && archived = false`,
    expand: 'area_id',
    fields:
      'id,name,frequency_days,schedule_mode,anchor_date,archived,created,icon,color,area_id,notes,expand.area_id.name',
  });

  const now = new Date();
  const taskIds = tasks.map((t) => t.id);
  const completions = await getCompletionsForHome(pb, taskIds, now);

  // Map PB records -> BandView's TaskWithName shape. The expand shape
  // for `area_id` is Record<string, RecordModel>, so we narrow it to
  // the name projection we requested via `fields`.
  const mappedTasks: TaskWithName[] = tasks.map((t) => ({
    id: t.id,
    name: t.name as string,
    created: t.created as string,
    archived: Boolean(t.archived),
    frequency_days: t.frequency_days as number,
    schedule_mode:
      (t.schedule_mode as string) === 'anchored' ? 'anchored' : 'cycle',
    anchor_date: (t.anchor_date as string) || null,
    icon: (t.icon as string) ?? '',
    color: (t.color as string) ?? '',
    area_id: t.area_id as string,
    area_name:
      (
        t.expand as Record<string, { name?: string }> | undefined
      )?.area_id?.name ?? undefined,
    notes: (t.notes as string) ?? '',
  }));

  // Build per-task last-5 completions map for TaskDetailSheet (03-03).
  // `completions` is already sorted DESC by completed_at (getFullList
  // sort: '-completed_at' in getCompletionsForHome), so slicing the
  // first 5 after bucketing gives the correct "recent" ordering.
  const byTask = new Map<string, CompletionRecord[]>();
  for (const c of completions) {
    const arr = byTask.get(c.task_id) ?? [];
    arr.push(c);
    byTask.set(c.task_id, arr);
  }
  const lastCompletionsByTaskId: Record<
    string,
    Array<{ id: string; completed_at: string }>
  > = {};
  for (const [taskId, arr] of byTask) {
    lastCompletionsByTaskId[taskId] = arr
      .slice(0, 5)
      .map((c) => ({ id: c.id, completed_at: c.completed_at }));
  }

  return (
    <BandView
      tasks={mappedTasks}
      completions={completions}
      userId={userId}
      homeId={homeId}
      timezone={home.timezone as string}
      now={now.toISOString()}
      emptyStateHref={`/h/${homeId}/tasks/new`}
      lastCompletionsByTaskId={lastCompletionsByTaskId}
    />
  );
}
