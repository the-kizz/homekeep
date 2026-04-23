import cron, { type ScheduledTask } from 'node-cron';
import { startOfWeek } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import type PocketBase from 'pocketbase';
import { createAdminClient } from '@/lib/pocketbase-admin';
import {
  getCompletionsForHome,
  reduceLatestByTask,
} from '@/lib/completions';
import { computeNextDue, type Task } from '@/lib/task-scheduling';
import { sendNtfy } from '@/lib/ntfy';
import { HOMEKEEP_BUILD } from '@/lib/constants';
import {
  buildOverdueRefCycle,
  buildWeeklyRefCycle,
  buildAssignedRefCycle,
  buildPartnerRefCycle,
  hasNotified,
  recordNotification,
} from '@/lib/notifications';
import {
  computeWeeklySummary,
  type TaskWithAreaName,
} from '@/lib/weekly-summary';
import { getActiveOverridesForHome } from '@/lib/schedule-overrides';

/**
 * In-process scheduler (06-02 Task 1, D-04, D-05, D-08, D-09).
 *
 * Boots from `instrumentation.ts` on Next.js server start when
 * `process.env.DISABLE_SCHEDULER !== 'true'`. Runs two hourly crons, both
 * wall-clocked at `0 * * * *` UTC:
 *
 *   - processOverdueNotifications: iterates every home + non-archived
 *     task, detects tasks past their `nextDue`, and sends one ntfy per
 *     (opted-in member × overdue-cycle). Dedupes via the
 *     `(user_id, ref_cycle)` unique index on the `notifications`
 *     collection (Wave 1 D-05).
 *
 *   - processWeeklySummaries: iterates homes + members. Only fires for
 *     members whose configured `weekly_summary_day` and `home.timezone`
 *     map to Sunday/Monday 09:00 LOCAL at the current UTC hour. Idempotent
 *     via `user:{userId}:weekly:{weekStartIso}` ref_cycle.
 *
 * Helpers exported for Wave 2 server-action hooks:
 *
 *   - sendAssignedNotification(pb, params): called from
 *     updateTaskAction when assigned_to_id changes to a new non-null user.
 *   - sendPartnerCompletedNotifications(pb, params): called from
 *     completeTaskAction — notifies OTHER home members (D-07, NOTF-05).
 *
 * Idempotent-start discipline (D-08):
 *   - `started` module flag; re-entrant start() returns immediately.
 *   - DISABLE_SCHEDULER=true short-circuits so test runners and CI stay
 *     silent even when the module is imported transitively.
 *
 * Error posture (D-03):
 *   - Every sendNtfy result is recorded — we write the notifications row
 *     whether or not the POST succeeded. Better to miss a single ping
 *     than to spam via retries. Exceptions are logged (console.warn)
 *     never propagated; a single member's failure never aborts the loop.
 *
 * Admin-client auth surface (T-06-02-01):
 *   - All PB reads/writes in this module use createAdminClient() which
 *     holds superuser creds. The module is server-only and never imported
 *     by client components. instrumentation.ts dynamic-imports it so the
 *     edge-runtime bundle stays clean.
 */

// ─── module-level state ────────────────────────────────────────────────

let started = false;
let overdueTask: ScheduledTask | null = null;
let weeklyTask: ScheduledTask | null = null;

// ─── public API ────────────────────────────────────────────────────────

export function start(): void {
  if (started) return; // D-08 idempotent start
  if (process.env.DISABLE_SCHEDULER === 'true') return; // D-09

  if (!cron.validate('0 * * * *')) {
    throw new Error('[scheduler] invalid cron pattern: 0 * * * *');
  }

  overdueTask = cron.schedule(
    '0 * * * *',
    async () => {
      try {
        await processOverdueNotifications();
      } catch (e) {
        console.error('[scheduler] overdue tick failed', e);
      }
    },
    { timezone: 'UTC' },
  );

  weeklyTask = cron.schedule(
    '0 * * * *',
    async () => {
      try {
        await processWeeklySummaries();
      } catch (e) {
        console.error('[scheduler] weekly tick failed', e);
      }
    },
    { timezone: 'UTC' },
  );

  started = true;
  // One-time provenance line — survives tree-shaking because the
  // constant is imported from a separate module (lib/constants.ts).
  console.info(
    `[scheduler] started (overdue + weekly ticks) — build=${HOMEKEEP_BUILD}`,
  );
}

export function stop(): void {
  try {
    overdueTask?.stop();
  } catch {
    /* best-effort teardown */
  }
  try {
    weeklyTask?.stop();
  } catch {
    /* best-effort teardown */
  }
  overdueTask = null;
  weeklyTask = null;
  started = false;
}

export async function runOnce(
  opts: { kind?: 'overdue' | 'weekly' | 'both' } = {},
): Promise<{ overdueSent: number; weeklySent: number }> {
  const kind = opts.kind ?? 'both';
  let overdueSent = 0;
  let weeklySent = 0;
  if (kind === 'overdue' || kind === 'both') {
    overdueSent = await processOverdueNotifications();
  }
  if (kind === 'weekly' || kind === 'both') {
    weeklySent = await processWeeklySummaries();
  }
  return { overdueSent, weeklySent };
}

// ─── overdue pass ──────────────────────────────────────────────────────

type MemberLite = {
  userId: string;
  name: string;
  ntfyTopic: string;
  notifyOverdue: boolean;
  notifyWeeklySummary: boolean;
  notifyPartnerCompleted: boolean;
  weeklySummaryDay: 'sunday' | 'monday';
};

async function fetchHomeMembers(
  pb: PocketBase,
  homeId: string,
): Promise<MemberLite[]> {
  const rows = await pb.collection('home_members').getFullList({
    filter: pb.filter('home_id = {:hid}', { hid: homeId }),
    expand: 'user_id',
  });
  return rows.map((r) => {
    const e = (r.expand as { user_id?: Record<string, unknown> } | undefined)
      ?.user_id ?? {};
    return {
      userId: (e.id as string) ?? (r.user_id as string),
      name: (e.name as string) ?? '',
      ntfyTopic: (e.ntfy_topic as string) ?? '',
      notifyOverdue: Boolean(e.notify_overdue),
      notifyWeeklySummary: Boolean(e.notify_weekly_summary),
      notifyPartnerCompleted: Boolean(e.notify_partner_completed),
      weeklySummaryDay:
        (e.weekly_summary_day as 'sunday' | 'monday') ?? 'sunday',
    };
  });
}

function ntfyUrl(): string {
  return process.env.NTFY_URL || 'https://ntfy.sh';
}

export async function processOverdueNotifications(
  now: Date = new Date(),
): Promise<number> {
  const pb = await createAdminClient();
  let sent = 0;

  const homes = await pb.collection('homes').getFullList({
    fields: 'id,name,timezone',
  });

  for (const home of homes) {
    const homeId = home.id as string;
    const homeName = (home.name as string) ?? '';

    const members = await fetchHomeMembers(pb, homeId);
    const eligible = members.filter(
      (m) => m.notifyOverdue && m.ntfyTopic.length > 0,
    );
    if (eligible.length === 0) continue;

    const tasks = (await pb.collection('tasks').getFullList({
      filter: pb.filter('home_id = {:hid} && archived = false', { hid: homeId }),
      fields:
        'id,home_id,name,frequency_days,schedule_mode,anchor_date,created,archived',
    })) as unknown as Array<Task & { name: string }>;
    if (tasks.length === 0) continue;

    const taskIds = tasks.map((t) => t.id);
    const completions = await getCompletionsForHome(pb, taskIds, now);
    const latestByTask = reduceLatestByTask(completions);
    // 10-02 Plan (D-06, D-08, SNZE-10): batch-fetch active overrides ONCE
    // per home before the per-task loop. Eliminates N+1 roundtrips and
    // lets `computeNextDue` return post-override next-due, which means
    // `buildOverdueRefCycle` keys automatically on the snoozed ISO —
    // "free-by-construction" ref_cycle rotation for snoozed tasks.
    const overridesByTask = await getActiveOverridesForHome(pb, homeId);

    for (const task of tasks) {
      const last = latestByTask.get(task.id) ?? null;
      const nextDue = computeNextDue(
        task,
        last,
        now,
        overridesByTask.get(task.id),
      );
      if (!nextDue) continue;
      if (nextDue.getTime() > now.getTime()) continue;

      const refCycle = buildOverdueRefCycle(task.id, nextDue.toISOString());
      const body = `Your ${homeName ? `${homeName} ` : ''}${task.name.toLowerCase()} is overdue — ready when you are.`;

      for (const member of eligible) {
        if (await hasNotified(pb, member.userId, refCycle)) continue;

        try {
          await sendNtfy(ntfyUrl(), member.ntfyTopic, {
            title: `Overdue: ${task.name}`,
            body,
            priority: 3,
            tags: ['hourglass'],
          });
        } catch (e) {
          // sendNtfy NEVER throws per its contract — this is belt-and-braces.
          console.warn('[scheduler] sendNtfy threw:', (e as Error).message);
        }

        const written = await recordNotification(pb, {
          user_id: member.userId,
          home_id: homeId,
          task_id: task.id,
          kind: 'overdue',
          sent_at: now.toISOString(),
          ref_cycle: refCycle,
        });
        if (written) sent += 1;
      }
    }
  }

  return sent;
}

// ─── weekly summary pass ───────────────────────────────────────────────

export async function processWeeklySummaries(
  now: Date = new Date(),
): Promise<number> {
  const pb = await createAdminClient();
  let sent = 0;

  const homes = await pb.collection('homes').getFullList({
    fields: 'id,name,timezone',
  });

  for (const home of homes) {
    const homeId = home.id as string;
    const homeName = (home.name as string) ?? '';
    const timezone = (home.timezone as string) ?? 'UTC';

    // Per-home local time: must be 09:00 local, on the member's configured day.
    let zonedNow: Date;
    try {
      zonedNow = toZonedTime(now, timezone);
    } catch {
      // Bad timezone in the home record — skip.
      continue;
    }
    const localHour = zonedNow.getHours();
    const localWeekday = zonedNow.getDay(); // 0=Sunday, 1=Monday

    if (localHour !== 9) continue;
    if (localWeekday !== 0 && localWeekday !== 1) continue;

    const members = await fetchHomeMembers(pb, homeId);
    const eligible = members.filter(
      (m) =>
        m.notifyWeeklySummary &&
        m.ntfyTopic.length > 0 &&
        ((m.weeklySummaryDay === 'sunday' && localWeekday === 0) ||
          (m.weeklySummaryDay === 'monday' && localWeekday === 1)),
    );
    if (eligible.length === 0) continue;

    const tasks = (await pb.collection('tasks').getFullList({
      filter: pb.filter('home_id = {:hid} && archived = false', { hid: homeId }),
      fields:
        'id,home_id,area_id,name,frequency_days,schedule_mode,anchor_date,created,archived',
    })) as unknown as TaskWithAreaName[];

    const areas = (await pb.collection('areas').getFullList({
      filter: pb.filter('home_id = {:hid}', { hid: homeId }),
      fields: 'id,name',
    })) as unknown as Array<{ id: string; name: string }>;

    const taskIds = tasks.map((t) => t.id);
    const completions = await getCompletionsForHome(pb, taskIds, now);

    // 10-02 Plan: batch-fetch overrides once per home for the weekly
    // summary's coverage + mostNeglected reducers (D-08, SNZE-09).
    const overridesByTask = await getActiveOverridesForHome(pb, homeId);

    // Compute weekStartIso once per home.
    const weekStart = fromZonedTime(startOfWeek(zonedNow), timezone);
    const weekStartIso = weekStart.toISOString();

    const summary = computeWeeklySummary(
      completions,
      tasks,
      areas,
      overridesByTask,
      now,
      timezone,
    );

    for (const member of eligible) {
      const refCycle = buildWeeklyRefCycle(member.userId, weekStartIso);
      if (await hasNotified(pb, member.userId, refCycle)) continue;

      const houseLabel = homeName || 'The house';
      const body =
        `This week: ${summary.completionsCount} tasks. ` +
        `${houseLabel} is ${summary.coveragePercent}% maintained. ` +
        `Top area: ${summary.topArea}.` +
        (summary.mostNeglectedTask
          ? ` Most neglected: ${summary.mostNeglectedTask.name}.`
          : '');

      try {
        await sendNtfy(ntfyUrl(), member.ntfyTopic, {
          title: `Weekly summary — ${homeName || 'HomeKeep'}`,
          body,
          priority: 2,
          tags: ['house_with_garden'],
        });
      } catch (e) {
        console.warn('[scheduler] sendNtfy threw:', (e as Error).message);
      }

      const written = await recordNotification(pb, {
        user_id: member.userId,
        home_id: homeId,
        task_id: null,
        kind: 'weekly_summary',
        sent_at: now.toISOString(),
        ref_cycle: refCycle,
      });
      if (written) sent += 1;
    }
  }

  return sent;
}

// ─── Wave 2 hook helpers (consumed by server actions) ──────────────────

export async function sendAssignedNotification(
  pb: PocketBase,
  params: {
    assigneeUserId: string;
    taskId: string;
    taskName: string;
    homeId: string;
    homeName?: string;
    assignedAtIso: string;
    now?: Date;
  },
): Promise<boolean> {
  const now = params.now ?? new Date();

  let user: Record<string, unknown>;
  try {
    user = await pb
      .collection('users')
      .getOne(params.assigneeUserId, {
        fields:
          'id,name,ntfy_topic,notify_assigned',
      });
  } catch {
    return false;
  }

  const ntfyTopic = (user.ntfy_topic as string) ?? '';
  const notifyAssigned = Boolean(user.notify_assigned);
  if (!notifyAssigned || ntfyTopic.length === 0) return false;

  const refCycle = buildAssignedRefCycle(params.taskId, params.assignedAtIso);
  if (await hasNotified(pb, params.assigneeUserId, refCycle)) return false;

  const homeLabel = params.homeName ? `${params.homeName} — ` : '';

  try {
    await sendNtfy(ntfyUrl(), ntfyTopic, {
      title: `You've got a task`,
      body: `${homeLabel}${params.taskName}`,
      priority: 3,
      tags: ['pushpin'],
    });
  } catch (e) {
    console.warn('[scheduler] sendNtfy threw:', (e as Error).message);
  }

  const written = await recordNotification(pb, {
    user_id: params.assigneeUserId,
    home_id: params.homeId,
    task_id: params.taskId,
    kind: 'assigned',
    sent_at: now.toISOString(),
    ref_cycle: refCycle,
  });
  return !!written;
}

export async function sendPartnerCompletedNotifications(
  pb: PocketBase,
  params: {
    completerUserId: string;
    completionId: string;
    taskName: string;
    homeId: string;
    now?: Date;
  },
): Promise<number> {
  const now = params.now ?? new Date();

  // Fetch home members to know who to notify (excluding the completer).
  const members = await fetchHomeMembers(pb, params.homeId);

  // CRITICAL: filter OUT the completer — partner-completed is about OTHERS.
  const recipients = members.filter(
    (m) =>
      m.userId !== params.completerUserId &&
      m.notifyPartnerCompleted &&
      m.ntfyTopic.length > 0,
  );
  if (recipients.length === 0) return 0;

  // Resolve completer name (for body copy).
  let completerName = 'Someone';
  try {
    const c = await pb
      .collection('users')
      .getOne(params.completerUserId, { fields: 'id,name' });
    completerName = (c.name as string) || 'Someone';
  } catch {
    /* fall through with default */
  }

  const refCycle = buildPartnerRefCycle(params.completionId);
  let sent = 0;

  for (const member of recipients) {
    if (await hasNotified(pb, member.userId, refCycle)) continue;

    try {
      await sendNtfy(ntfyUrl(), member.ntfyTopic, {
        title: `${completerName} completed a task`,
        body: `${completerName} completed: ${params.taskName}`,
        priority: 2,
        tags: ['sparkles'],
      });
    } catch (e) {
      console.warn('[scheduler] sendNtfy threw:', (e as Error).message);
    }

    const written = await recordNotification(pb, {
      user_id: member.userId,
      home_id: params.homeId,
      task_id: null,
      kind: 'partner_completed',
      sent_at: now.toISOString(),
      ref_cycle: refCycle,
    });
    if (written) sent += 1;
  }

  return sent;
}
