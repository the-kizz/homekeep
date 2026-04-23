import { notFound } from 'next/navigation';
import { createServerClient } from '@/lib/pocketbase-server';
import { assertMembership } from '@/lib/membership';
import { getCompletionsForHome } from '@/lib/completions';
import {
  filterCompletions,
  type HistoryFilter,
  type HistoryRange,
} from '@/lib/history-filter';
import {
  HistoryTimeline,
  type HistoryEntry,
} from '@/components/history-timeline';
import { HistoryFilters } from '@/components/history-filters';

const HISTORY_PAGE_CAP = 50;

/**
 * /h/[homeId]/history — reverse-chronological household completion feed
 * (05-02 Task 3, D-09/D-10/D-11, HIST-01/02/03).
 *
 * Server Component. Reads the three filter params from searchParams
 * (Next 16 async contract), validates `range` against the canonical
 * four values (T-05-02-03: unknown strings fall back to 'month'),
 * applies `filterCompletions` (05-01), and caps at 50 items per
 * CONTEXT D-10 + T-05-02-05.
 *
 * Render:
 *   - <HistoryFilters> (client, URL-param writer)
 *   - <HistoryTimeline> (day-grouped, sticky headers)
 *   - "Showing N of M" footer when filtered count exceeds the cap
 */
export default async function HistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ homeId: string }>;
  searchParams: Promise<{ person?: string; area?: string; range?: string }>;
}) {
  const { homeId } = await params;
  const sp = await searchParams;

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

  // T-05-02-03 mitigation: whitelist range. Unknown values fall back.
  const allowedRanges: HistoryRange[] = ['today', 'week', 'month', 'all'];
  const rawRange = sp.range;
  const range: HistoryRange = allowedRanges.includes(rawRange as HistoryRange)
    ? (rawRange as HistoryRange)
    : 'month';
  const filter: HistoryFilter & {
    personId: string | null;
    areaId: string | null;
  } = {
    personId: sp.person && sp.person.length > 0 ? sp.person : null,
    areaId: sp.area && sp.area.length > 0 ? sp.area : null,
    range,
  };

  const timezone = (home.timezone as string) || 'Australia/Perth';

  // Members (for filter dropdown + timeline display names).
  const memberRows = await pb.collection('home_members').getFullList({
    filter: pb.filter('home_id = {:hid}', { hid: homeId }),
    expand: 'user_id',
    fields:
      'id,user_id,expand.user_id.id,expand.user_id.name,expand.user_id.email',
  });
  const members = memberRows
    .map((r) => {
      const u = (
        r.expand as
          | Record<string, { id?: string; name?: string; email?: string }>
          | undefined
      )?.user_id;
      if (!u?.id) return null;
      return {
        id: u.id,
        name: (u.name as string) || (u.email as string) || 'Member',
      };
    })
    .filter((m): m is { id: string; name: string } => m !== null);

  // Areas (filter dropdown + area chip color).
  const areasRaw = await pb.collection('areas').getFullList({
    filter: pb.filter('home_id = {:hid}', { hid: homeId }),
    sort: 'sort_order,name',
    fields: 'id,name,color',
  });
  const areaById = new Map<string, { id: string; name: string; color: string }>(
    areasRaw.map((a) => [
      a.id as string,
      {
        id: a.id as string,
        name: a.name as string,
        color: (a.color as string) || '#D4A574',
      },
    ]),
  );

  // Tasks (for taskAreaMap + name lookup).
  const tasksRaw = await pb.collection('tasks').getFullList({
    filter: pb.filter('home_id = {:hid}', { hid: homeId }),
    fields: 'id,name,area_id',
  });
  const taskAreaMap = new Map<string, string>(
    tasksRaw.map((t) => [t.id as string, t.area_id as string]),
  );
  const taskById = new Map<string, { id: string; name: string; area_id: string }>(
    tasksRaw.map((t) => [
      t.id as string,
      {
        id: t.id as string,
        name: t.name as string,
        area_id: t.area_id as string,
      },
    ]),
  );

  // Completions (13-month window).
  const now = new Date();
  const completions = await getCompletionsForHome(
    pb,
    tasksRaw.map((t) => t.id as string),
    now,
  );

  const filtered = filterCompletions(
    completions,
    filter,
    taskAreaMap,
    now,
    timezone,
  );

  // Lookup for user name by id (members may include the current user too).
  const userNameById = new Map<string, string>(
    members.map((m) => [m.id, m.name]),
  );

  const shown = filtered.slice(0, HISTORY_PAGE_CAP);
  const entries: HistoryEntry[] = shown.map((c) => {
    const task = taskById.get(c.task_id);
    const area = task ? areaById.get(task.area_id) : undefined;
    return {
      id: c.id,
      completed_at: c.completed_at,
      user: {
        id: c.completed_by_id,
        name: userNameById.get(c.completed_by_id) ?? 'Member',
      },
      task: {
        id: c.task_id,
        name: task?.name ?? 'Task',
      },
      area: area ?? { id: '', name: '—', color: '#D4A574' },
    };
  });

  return (
    <div
      className="mx-auto max-w-4xl space-y-4 p-6"
      data-history-view
      data-home-id={homeId}
      data-filtered-count={filtered.length}
    >
      <header>
        <h1 className="text-2xl font-semibold">History</h1>
        <p className="text-sm text-muted-foreground">
          {home.name as string} — who did what, when.
        </p>
      </header>

      <HistoryFilters
        members={members}
        areas={areasRaw.map((a) => ({
          id: a.id as string,
          name: a.name as string,
        }))}
        initial={filter}
      />

      <HistoryTimeline entries={entries} timezone={timezone} />

      {filtered.length > HISTORY_PAGE_CAP && (
        <p
          className="text-center text-xs text-muted-foreground"
          data-history-footer
        >
          Showing {HISTORY_PAGE_CAP} of {filtered.length}
        </p>
      )}
    </div>
  );
}
