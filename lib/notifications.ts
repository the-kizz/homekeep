import type PocketBase from 'pocketbase';

/**
 * Notification record + ref-cycle builders + dedupe helpers (06-01 Task 2, D-05).
 *
 * Two concerns live in this module:
 *
 *   1. **Deterministic ref_cycle string builders** (pure, side-effect free).
 *      Every scheduler-originated send derives its dedupe key from the
 *      event's intrinsic identity:
 *        - overdue:           `task:{taskId}:overdue:{nextDueIso}`
 *        - assigned:          `task:{taskId}:assigned:{assignedAtIso}`
 *        - weekly summary:    `user:{userId}:weekly:{weekStartIso}`
 *        - partner-completed: `completion:{completionId}:partner`
 *      These keys combine with `user_id` to form the (user_id, ref_cycle)
 *      unique index that blocks duplicate inserts at the DB layer.
 *
 *   2. **Best-effort PB accessors** (`hasNotified`, `recordNotification`).
 *      These are the scheduler's check-then-insert primitives. Both
 *      swallow all errors and return null/false; the unique index is the
 *      idempotency safety net, so `recordNotification` failing silently
 *      on a race is the correct behaviour — the OTHER winner already sent
 *      the ntfy.
 *
 * Filter injection: `hasNotified` uses `pb.filter('... = {:u} && ... = {:r}', {u, r})`
 * to prevent user-supplied strings from escaping into the filter DSL
 * (defence-in-depth for Wave 2 when ref_cycle formation might eventually
 * accept caller-provided segments).
 *
 * Auth posture: both accessors are auth-agnostic — the caller (Wave 2's
 * scheduler) supplies a pb client that's been authed as a superuser via
 * `createAdminClient()`. This module never authenticates anything itself.
 */

export type NotificationKind =
  | 'overdue'
  | 'assigned'
  | 'partner_completed'
  | 'weekly_summary';

export type NotificationRecord = {
  id: string;
  user_id: string;
  home_id: string;
  task_id: string | null;
  kind: NotificationKind;
  sent_at: string;
  ref_cycle: string;
};

// ─── ref_cycle builders (pure) ─────────────────────────────────────────

export function buildOverdueRefCycle(
  taskId: string,
  nextDueIso: string,
): string {
  return `task:${taskId}:overdue:${nextDueIso}`;
}

export function buildAssignedRefCycle(
  taskId: string,
  assignedAtIso: string,
): string {
  return `task:${taskId}:assigned:${assignedAtIso}`;
}

export function buildWeeklyRefCycle(
  userId: string,
  weekStartIso: string,
): string {
  return `user:${userId}:weekly:${weekStartIso}`;
}

export function buildPartnerRefCycle(completionId: string): string {
  return `completion:${completionId}:partner`;
}

// ─── PB accessors (best-effort) ────────────────────────────────────────

/**
 * Returns true when a notifications row already exists for (userId, refCycle).
 * Swallows ALL errors (including network failures) and returns false — the
 * worst case is a duplicate send attempt, which the DB unique index will
 * then catch.
 */
export async function hasNotified(
  pb: PocketBase,
  userId: string,
  refCycle: string,
): Promise<boolean> {
  try {
    const row = await pb.collection('notifications').getFirstListItem(
      pb.filter('user_id = {:u} && ref_cycle = {:r}', {
        u: userId,
        r: refCycle,
      }),
    );
    return !!row?.id;
  } catch {
    // PB throws ClientResponseError 404 when no row matches; that's the
    // common "not yet notified" case. Any other error collapses the
    // same way — the unique index will still prevent a duplicate insert.
    return false;
  }
}

/**
 * Inserts a notifications row. Returns the created record on success,
 * or null on ANY failure (including unique-index violation when a race
 * winner has already inserted). Callers MUST treat null as a successful
 * idempotent no-op, not a send-failure — the ntfy POST itself is
 * a separate concern already handled by `lib/ntfy.ts`.
 */
export async function recordNotification(
  pb: PocketBase,
  row: Omit<NotificationRecord, 'id'>,
): Promise<NotificationRecord | null> {
  try {
    const created = await pb.collection('notifications').create({
      user_id: row.user_id,
      home_id: row.home_id,
      task_id: row.task_id,
      kind: row.kind,
      sent_at: row.sent_at,
      ref_cycle: row.ref_cycle,
    });
    return {
      id: created.id,
      user_id: created.user_id,
      home_id: created.home_id,
      task_id: created.task_id ?? null,
      kind: created.kind as NotificationKind,
      sent_at: created.sent_at,
      ref_cycle: created.ref_cycle,
    };
  } catch {
    return null;
  }
}
