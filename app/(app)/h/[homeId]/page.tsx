import { notFound, redirect } from 'next/navigation';
import { createServerClient } from '@/lib/pocketbase-server';
import {
  getCompletionsForHome,
  type CompletionRecord,
} from '@/lib/completions';
import { BandView, type TaskWithName } from '@/components/band-view';
import { AvatarStack } from '@/components/avatar-stack';
import { HouseholdStreakBadge } from '@/components/household-streak-badge';
import { computeHouseholdStreak } from '@/lib/household-streak';
import { resolveAssignee, type Member } from '@/lib/assignment';
import { getActiveOverridesForHome } from '@/lib/schedule-overrides';

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
      fields: 'id,name,timezone,onboarded',
    });
  } catch {
    notFound();
  }

  // 05-03 (D-14): redirect first-run homes to the seed wizard. The
  // migration 1714953604 backfilled existing homes to onboarded=true,
  // so only homes created via createHome (which sets onboarded=false)
  // enter the wizard. Skipping or completing the wizard flips the flag.
  if (home.onboarded === false) {
    redirect(`/h/${homeId}/onboarding`);
  }

  // 04-03: fetch home members + areas (with default_assignee_id) so the
  // cascading resolveAssignee can run server-side. Also drives the
  // AvatarStack in the dashboard header.
  const memberRows = await pb.collection('home_members').getFullList({
    filter: `home_id = "${homeId}"`,
    expand: 'user_id',
    fields:
      'id,role,user_id,expand.user_id.id,expand.user_id.name,expand.user_id.email',
  });
  const members: Member[] = memberRows
    .map((r): Member | null => {
      const u = (
        r.expand as
          | Record<string, { id?: string; name?: string; email?: string }>
          | undefined
      )?.user_id;
      if (!u?.id) return null;
      return {
        id: u.id,
        name: (u.name as string) || (u.email as string) || 'Member',
        email: u.email as string | undefined,
        role: r.role as 'owner' | 'member',
      };
    })
    .filter((m): m is Member => m !== null);

  const areasRaw = await pb.collection('areas').getFullList({
    filter: `home_id = "${homeId}"`,
    fields: 'id,default_assignee_id',
  });
  const areaById = new Map(
    areasRaw.map((a) => [
      a.id as string,
      {
        id: a.id as string,
        default_assignee_id: (a.default_assignee_id as string) || null,
      },
    ]),
  );

  const tasks = await pb.collection('tasks').getFullList({
    filter: `home_id = "${homeId}" && archived = false`,
    expand: 'area_id',
    fields:
      'id,name,frequency_days,schedule_mode,anchor_date,archived,created,icon,color,area_id,notes,assigned_to_id,active_from_month,active_to_month,expand.area_id.name',
  });

  const now = new Date();
  const taskIds = tasks.map((t) => t.id);
  const completions = await getCompletionsForHome(pb, taskIds, now);

  // 10-02 Plan (D-06 + D-08): fetch active overrides ONCE per render.
  // Serialize the Map to a plain Record for the RSC→Client boundary;
  // BandView reconstructs the Map inline. Empty Record when the home
  // has no active overrides → v1.0 behavior preserved for the 99% path.
  const overridesMap = await getActiveOverridesForHome(pb, homeId);
  const overridesByTask = Object.fromEntries(overridesMap);

  // 06-03 D-11 / D-16 / GAME-01: household-wide streak badge for the
  // dashboard header. computeHouseholdStreak counts ANY-member
  // completions per week (D-10) — already a pure fn; no Date.now reads.
  const householdStreak = computeHouseholdStreak(
    completions,
    now,
    home.timezone as string,
  );

  // Map PB records -> BandView's TaskWithName shape. The expand shape
  // for `area_id` is Record<string, RecordModel>, so we narrow it to
  // the name projection we requested via `fields`.
  const mappedTasks: TaskWithName[] = tasks.map((t) => {
    const assignedToId = (t.assigned_to_id as string) || null;
    const areaId = t.area_id as string;
    const area =
      areaById.get(areaId) ?? { id: areaId, default_assignee_id: null };
    const effective = resolveAssignee(
      { id: t.id, assigned_to_id: assignedToId, area_id: areaId },
      area,
      members,
    );
    return {
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
      area_id: areaId,
      area_name:
        (
          t.expand as Record<string, { name?: string }> | undefined
        )?.area_id?.name ?? undefined,
      notes: (t.notes as string) ?? '',
      assigned_to_id: assignedToId,
      active_from_month: (t.active_from_month as number) ?? null,
      active_to_month: (t.active_to_month as number) ?? null,
      effective,
    };
  });

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
    <>
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-6 pt-4 pb-6 text-sm text-muted-foreground">
        <div className="flex items-center gap-3">
          {/* Mobile: tighter single-line title using serif. Desktop keeps
              same line but in the regular header density. */}
          <h1 className="font-display text-xl font-medium tracking-tight text-foreground sm:text-lg sm:font-normal">
            {home.name as string}
          </h1>
          {/* 06-03 D-11 / D-16 / GAME-01: household streak badge. Sits
              next to the home name on the left; CoverageRing stays in
              BandView on the right — symmetric at the above-the-fold
              header level (see 06-03 plan <interfaces> decision). */}
          <HouseholdStreakBadge streak={householdStreak} />
        </div>
        <AvatarStack
          members={members}
          href={`/h/${homeId}/members`}
          title={`${members.length} member${members.length === 1 ? '' : 's'} — view members`}
        />
      </div>
      <BandView
        tasks={mappedTasks}
        completions={completions}
        userId={userId}
        homeId={homeId}
        timezone={home.timezone as string}
        now={now.toISOString()}
        emptyStateHref={`/h/${homeId}/tasks/new`}
        lastCompletionsByTaskId={lastCompletionsByTaskId}
        overridesByTask={overridesByTask}
      />
    </>
  );
}
