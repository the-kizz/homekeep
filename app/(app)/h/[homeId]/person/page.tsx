import { notFound } from 'next/navigation';
import { startOfMonth, startOfWeek } from 'date-fns';
import { fromZonedTime, toZonedTime, formatInTimeZone } from 'date-fns-tz';
import { formatDistanceToNow } from 'date-fns';
import { createServerClient } from '@/lib/pocketbase-server';
import { assertMembership } from '@/lib/membership';
import {
  getCompletionsForHome,
  type CompletionRecord,
} from '@/lib/completions';
import {
  resolveAssignee,
  type Member,
  type AreaLite,
} from '@/lib/assignment';
import { computePersonalStreak } from '@/lib/personal-streak';
import {
  PersonTaskList,
  type PersonTask,
} from '@/components/person-task-list';
import { getActiveOverridesForHome } from '@/lib/schedule-overrides';
import { normalizeMonth } from '@/lib/task-scheduling';
import { PersonalStats } from '@/components/personal-stats';
import { NotificationPrefsForm } from '@/components/notification-prefs-form';
import type { NotificationPrefs } from '@/lib/schemas/notification-prefs';
import { Card, CardContent } from '@/components/ui/card';

/**
 * /h/[homeId]/person — Person view (05-02 Task 2, D-07 + D-08,
 * PERS-01/02/03/04).
 *
 * Four sections:
 *   1. Your tasks — tasks where resolveAssignee(task,area,members) lands
 *      on the current user (task-level OR area-default). Rendered via
 *      <PersonTaskList/> which preserves tap-to-complete + guard.
 *   2. Your history — user's completions in the last 30 days, grouped
 *      flat as a reverse-chronological list of "{task} · {relative time}".
 *   3. Your stats — weekly / monthly completion counts + personal streak.
 *   4. Notifications — disabled preview of the Phase 6 prefs form.
 *
 * Security posture: assertMembership (Phase 4) gates non-members via
 * notFound(); PB's viewRule on tasks/completions/areas scopes the
 * fetches to the home's data. The `authId` filter happens in-process
 * on already-member-scoped results — no row gets exposed by this page
 * that PB rules wouldn't already have allowed the user to read.
 */
export default async function PersonPage({
  params,
}: {
  params: Promise<{ homeId: string }>;
}) {
  const { homeId } = await params;
  const pb = await createServerClient();

  const authId = pb.authStore.record?.id as string | undefined;
  if (!authId) notFound();

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

  const timezone = (home.timezone as string) || 'Australia/Perth';

  // Members (for cascade + history display names).
  const memberRows = await pb.collection('home_members').getFullList({
    filter: pb.filter('home_id = {:hid}', { hid: homeId }),
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

  // Areas (for default_assignee cascade).
  const areasRaw = await pb.collection('areas').getFullList({
    filter: pb.filter('home_id = {:hid}', { hid: homeId }),
    fields: 'id,default_assignee_id',
  });
  const areaById = new Map<string, AreaLite>(
    areasRaw.map((a) => [
      a.id as string,
      {
        id: a.id as string,
        default_assignee_id: (a.default_assignee_id as string) || null,
      },
    ]),
  );

  // Tasks (active only). Phase 14 (SEAS-06): active_from_month +
  // active_to_month added to the projection so PersonTaskList's
  // classifyDormantTasks can identify dormant tasks and render the
  // Sleeping section below HorizonStrip. Phase 16 Plan 01 (LVIZ-03,
  // LVIZ-05): widen with next_due_smoothed + preferred_days +
  // due_date + reschedule_marker so PersonTaskList can compute the
  // shift map (⚖️ badges) + TaskDetailSheet (not used on Person view,
  // but field parity keeps the PersonTask type aligned with TaskWithName).
  const tasksRaw = await pb.collection('tasks').getFullList({
    filter: pb.filter('home_id = {:hid} && archived = false', { hid: homeId }),
    fields:
      'id,name,area_id,created,frequency_days,schedule_mode,anchor_date,archived,assigned_to_id,active_from_month,active_to_month,next_due_smoothed,preferred_days,due_date,reschedule_marker',
  });

  // Filter to tasks whose effective assignee is the current user. Note:
  // 'anyone' does NOT match — per D-07 PERS-01, "Your tasks" means tasks
  // assigned specifically to YOU (via task-level or area-default cascade).
  const myTasks: PersonTask[] = [];
  for (const t of tasksRaw) {
    const areaId = t.area_id as string;
    const area = areaById.get(areaId) ?? {
      id: areaId,
      default_assignee_id: null,
    };
    const effective = resolveAssignee(
      {
        id: t.id,
        assigned_to_id: (t.assigned_to_id as string) || null,
        area_id: areaId,
      },
      area,
      members,
    );
    if (effective.kind === 'anyone') continue;
    if (effective.user.id !== authId) continue;
    myTasks.push({
      id: t.id,
      name: t.name as string,
      created: t.created as string,
      archived: Boolean(t.archived),
      frequency_days: t.frequency_days as number,
      schedule_mode:
        (t.schedule_mode as string) === 'anchored' ? 'anchored' : 'cycle',
      anchor_date: (t.anchor_date as string) || null,
      // Phase 14 (SEAS-06): seasonal window fields — null on the Person
      // view means "year-round", honoring the paired-or-null invariant
      // Phase 11 locked at the zod layer. PersonTaskList reads these to
      // classify dormants.
      // Phase 19 PATCH-01: normalizeMonth collapses PB 0.37.1
      // cleared-NumberField=0 to null (year-round parity).
      active_from_month: normalizeMonth(t.active_from_month),
      active_to_month: normalizeMonth(t.active_to_month),
      // Phase 16 Plan 01 (LVIZ-03): threaded to PersonTaskList so the
      // shift-map compute can run per render. '' → null coercion
      // handles PB 0.37.1's empty-DateField read-back.
      next_due_smoothed: (t.next_due_smoothed as string | null) || null,
      preferred_days:
        (t.preferred_days as 'any' | 'weekend' | 'weekday' | null) || null,
      due_date: (t.due_date as string | null) || null,
      reschedule_marker: (t.reschedule_marker as string | null) || null,
      area_id: areaId,
      effective,
    });
  }

  // All home completions within the 13-month window (drives stats +
  // streak). Then narrow to current user for the user-scoped surfaces.
  const now = new Date();
  const allTaskIds = tasksRaw.map((t) => t.id);
  const homeCompletions = await getCompletionsForHome(pb, allTaskIds, now);

  // 10-02 Plan (D-06, D-08): batch-fetch active overrides once per
  // render; serialize for the RSC→Client boundary when passing to
  // PersonTaskList (Maps don't survive Next.js serialization).
  const overridesMap = await getActiveOverridesForHome(pb, homeId);
  const overridesByTask = Object.fromEntries(overridesMap);
  const myCompletions: CompletionRecord[] = homeCompletions.filter(
    (c) => c.completed_by_id === authId,
  );

  // Week / month counts (anchored at local midnight in the home's tz —
  // same DST-safe idiom as band-classification + history-filter).
  const zonedNow = toZonedTime(now, timezone);
  const weekStart = fromZonedTime(startOfWeek(zonedNow), timezone);
  const monthStart = fromZonedTime(startOfMonth(zonedNow), timezone);
  const completionsThisWeek = myCompletions.filter(
    (c) => new Date(c.completed_at) >= weekStart,
  ).length;
  const completionsThisMonth = myCompletions.filter(
    (c) => new Date(c.completed_at) >= monthStart,
  ).length;
  const streak = computePersonalStreak(myCompletions, now, timezone);

  // 30-day history slice (reverse-chronological, capped at 30 days per
  // D-07 section 2). homeCompletions is already sorted DESC by PB, so
  // myCompletions preserves that order.
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
  const historyEntries = myCompletions
    .filter((c) => new Date(c.completed_at) >= thirtyDaysAgo)
    .slice(0, 200); // sanity cap; 30d * many/day would blow out page weight

  // Task name lookup for history rendering.
  const taskNameById = new Map<string, string>(
    tasksRaw.map((t) => [t.id, t.name as string]),
  );

  // 06-03: fetch the current user's notification preferences so the form
  // can pre-fill. The users collection viewRule allows self-read; if a
  // field is missing (pre-migration row) we coerce to the product default.
  const userRecord = await pb.collection('users').getOne(authId, {
    fields:
      'id,ntfy_topic,notify_overdue,notify_assigned,notify_partner_completed,notify_weekly_summary,weekly_summary_day',
  });
  const initialPrefs: NotificationPrefs = {
    ntfy_topic: (userRecord.ntfy_topic as string) || '',
    notify_overdue: Boolean(userRecord.notify_overdue),
    notify_assigned: Boolean(userRecord.notify_assigned),
    notify_partner_completed: Boolean(userRecord.notify_partner_completed),
    notify_weekly_summary: Boolean(userRecord.notify_weekly_summary),
    weekly_summary_day:
      userRecord.weekly_summary_day === 'monday' ? 'monday' : 'sunday',
  };

  return (
    <div
      className="mx-auto max-w-4xl space-y-6 p-6"
      data-person-view
      data-home-id={homeId}
      data-user-id={authId}
    >
      <header>
        <h1 className="text-2xl font-semibold">You</h1>
        <p className="text-sm text-muted-foreground">
          Your slice of {home.name as string}.
        </p>
      </header>

      {/* Section 1 — Your tasks */}
      <section
        className="space-y-3"
        data-section="your-tasks"
        data-your-tasks-count={myTasks.length}
      >
        <h2 className="text-lg font-medium">Your tasks</h2>
        {myTasks.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              Nothing is assigned to you right now.
            </CardContent>
          </Card>
        ) : (
          <PersonTaskList
            tasks={myTasks}
            completions={homeCompletions}
            userId={authId}
            homeId={homeId}
            timezone={timezone}
            now={now.toISOString()}
            overridesByTask={overridesByTask}
          />
        )}
      </section>

      {/* Section 2 — Your history (last 30 days) */}
      <section
        className="space-y-3"
        data-section="your-history"
        data-your-history-count={historyEntries.length}
      >
        <h2 className="text-lg font-medium">Your history</h2>
        {historyEntries.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              No completions in the last 30 days.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-4">
              <ul className="divide-y" data-your-history-list>
                {historyEntries.map((c) => {
                  const taskName = taskNameById.get(c.task_id) ?? 'Task';
                  return (
                    <li
                      key={c.id}
                      data-your-history-entry
                      data-completion-id={c.id}
                      data-task-id={c.task_id}
                      className="flex items-center justify-between gap-2 py-2 text-sm"
                    >
                      <span className="truncate font-medium">{taskName}</span>
                      <span
                        className="shrink-0 text-xs text-muted-foreground tabular-nums"
                        title={formatInTimeZone(
                          new Date(c.completed_at),
                          timezone,
                          'MMM d, yyyy h:mm a',
                        )}
                      >
                        {formatDistanceToNow(new Date(c.completed_at), {
                          addSuffix: true,
                        })}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}
      </section>

      {/* Section 3 — Your stats */}
      <section className="space-y-3" data-section="your-stats">
        <h2 className="text-lg font-medium">Your stats</h2>
        <PersonalStats
          weekly={completionsThisWeek}
          monthly={completionsThisMonth}
          streak={streak}
        />
      </section>

      {/* Section 4 — Notifications (06-03: real form replaces Phase 5 stub) */}
      <section className="space-y-3" data-section="notifications">
        <NotificationPrefsForm initialPrefs={initialPrefs} />
      </section>
    </div>
  );
}
