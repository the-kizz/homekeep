import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Separator } from '@/components/ui/separator';
import { createServerClient } from '@/lib/pocketbase-server';
import { assertMembership } from '@/lib/membership';
import {
  getCompletionsForHome,
  reduceLatestByTask,
} from '@/lib/completions';
import {
  computeAreaCoverage,
  computeAreaCounts,
} from '@/lib/area-coverage';
import { AreaCard } from '@/components/area-card';
import type { Task } from '@/lib/task-scheduling';
import { getActiveOverridesForHome } from '@/lib/schedule-overrides';

/**
 * /h/[homeId]/by-area — By Area view (05-02 Task 1, D-04/D-05/D-06,
 * AREA-V-01/02/03).
 *
 * Server Component following the Phase 3 dashboard fetch pattern:
 *   - assertMembership (Phase 4) gates non-members via notFound()
 *   - homes.getOne (viewRule) for title + timezone
 *   - areas.getFullList filtered by home_id, sorted by sort_order,name
 *   - tasks.getFullList (archived=false) for per-area coverage + counts
 *   - completions 13-month window via getCompletionsForHome; reduce
 *     to a latestByTask Map for the pure helpers.
 *
 * The per-area compute step is O(areas * tasks_in_area) — with realistic
 * area counts (≤10) and task ceiling of 200 per household (SPEC §19)
 * this is well under 2000 ops/request.
 *
 * Whole Home pinning (D-05): the `is_whole_home_system=true` area is
 * rendered ABOVE a Separator; other areas go below in a responsive grid.
 *
 * Empty-home invariant (D-22): when only Whole Home exists, surface a
 * CTA link to /h/[homeId]/areas.
 */
export default async function ByAreaPage({
  params,
}: {
  params: Promise<{ homeId: string }>;
}) {
  const { homeId } = await params;
  const pb = await createServerClient();

  try {
    await assertMembership(pb, homeId);
  } catch {
    notFound();
  }

  let home;
  try {
    home = await pb.collection('homes').getOne(homeId, {
      fields: 'id,name,timezone',
    });
  } catch {
    notFound();
  }

  const areas = await pb.collection('areas').getFullList({
    filter: `home_id = "${homeId}"`,
    sort: 'sort_order,name',
    fields: 'id,name,icon,color,sort_order,is_whole_home_system',
  });

  const tasksRaw = await pb.collection('tasks').getFullList({
    filter: `home_id = "${homeId}" && archived = false`,
    fields:
      'id,name,area_id,created,frequency_days,schedule_mode,anchor_date,archived',
  });

  const now = new Date();
  const timezone = (home.timezone as string) || 'Australia/Perth';
  const taskIds = tasksRaw.map((t) => t.id);
  const completions = await getCompletionsForHome(pb, taskIds, now);
  const latestByTask = reduceLatestByTask(completions);

  // 10-02 Plan: batch-fetch overrides once per render (D-08). Passed
  // directly to the pure helpers — no RSC boundary to cross here since
  // AreaCard receives pre-computed numbers, not the Map itself.
  const overridesByTask = await getActiveOverridesForHome(pb, homeId);

  // Group tasks by area_id, seeding every area (including empties) so
  // their coverage/counts resolve to the empty-home invariant (100% /
  // {0,0,0}) without a dedicated branch.
  const tasksByArea = new Map<string, Task[]>();
  for (const a of areas) tasksByArea.set(a.id as string, []);
  for (const t of tasksRaw) {
    const bucket = tasksByArea.get(t.area_id as string);
    if (!bucket) continue;
    bucket.push({
      id: t.id,
      created: t.created as string,
      archived: Boolean(t.archived),
      frequency_days: t.frequency_days as number,
      schedule_mode:
        (t.schedule_mode as string) === 'anchored' ? 'anchored' : 'cycle',
      anchor_date: (t.anchor_date as string) || null,
    });
  }

  const cards = areas.map((a) => {
    const tasksInArea = tasksByArea.get(a.id as string) ?? [];
    return {
      area: {
        id: a.id as string,
        name: a.name as string,
        icon: (a.icon as string) || 'home',
        color: (a.color as string) || '#D4A574',
        is_whole_home_system: Boolean(a.is_whole_home_system),
      },
      coverage: computeAreaCoverage(
        tasksInArea,
        latestByTask,
        overridesByTask,
        now,
      ),
      counts: computeAreaCounts(
        tasksInArea,
        latestByTask,
        overridesByTask,
        now,
        timezone,
      ),
    };
  });

  const whole = cards.find((c) => c.area.is_whole_home_system);
  const rest = cards.filter((c) => !c.area.is_whole_home_system);

  return (
    <div
      className="mx-auto max-w-4xl space-y-4 p-6"
      data-by-area-view
      data-home-id={homeId}
    >
      <header>
        <h1 className="text-2xl font-semibold">By Area</h1>
        <p className="text-sm text-muted-foreground">{home.name as string}</p>
      </header>

      {whole && (
        <AreaCard
          area={whole.area}
          coverage={whole.coverage}
          counts={whole.counts}
          homeId={homeId}
        />
      )}
      {whole && rest.length > 0 && <Separator />}

      {rest.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-empty-state="no-areas">
          <Link
            href={`/h/${homeId}/areas`}
            className="underline underline-offset-2 hover:text-foreground"
          >
            Add an area
          </Link>{' '}
          to organize tasks.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((c) => (
            <AreaCard
              key={c.area.id}
              area={c.area}
              coverage={c.coverage}
              counts={c.counts}
              homeId={homeId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
