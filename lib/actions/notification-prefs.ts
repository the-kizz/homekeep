'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/pocketbase-server';
import { notificationPrefsSchema } from '@/lib/schemas/notification-prefs';
import type { ActionState } from '@/lib/schemas/auth';

/**
 * updateNotificationPrefsAction (06-02 Task 2, D-15, NOTF-01 / 05 / 06).
 *
 * Writes the 6 notification-pref fields back to the authed user's row in
 * the `users` collection. The existing users.updateRule (Phase 2) gates
 * writes to self — a forged auth token pointing at another user can't
 * escalate. The action still re-validates via zod defence-in-depth.
 *
 * Input shape (FormData):
 *   - ntfy_topic        : text (4-64 URL-safe chars, or empty)
 *   - notify_overdue          : 'on' | 'true' | absent
 *   - notify_assigned         : 'on' | 'true' | absent
 *   - notify_partner_completed: 'on' | 'true' | absent
 *   - notify_weekly_summary   : 'on' | 'true' | absent
 *   - weekly_summary_day: 'sunday' | 'monday'
 *
 * shadcn Checkbox + RHF wire `name="notify_overdue"` values either as
 * literal 'on' (native checkbox) or 'true' (Controller+Checkbox hybrid).
 * We normalise both here with presence-check semantics.
 */

function readBool(formData: FormData, key: string): boolean {
  const v = formData.get(key);
  if (v === null) return false;
  const s = String(v).toLowerCase();
  return s === 'on' || s === 'true' || s === '1';
}

export async function updateNotificationPrefsAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const raw = {
    ntfy_topic: String(formData.get('ntfy_topic') ?? '').trim(),
    notify_overdue: readBool(formData, 'notify_overdue'),
    notify_assigned: readBool(formData, 'notify_assigned'),
    notify_partner_completed: readBool(formData, 'notify_partner_completed'),
    notify_weekly_summary: readBool(formData, 'notify_weekly_summary'),
    weekly_summary_day: String(
      formData.get('weekly_summary_day') ?? 'sunday',
    ),
  };

  const parsed = notificationPrefsSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const pb = await createServerClient();
  if (!pb.authStore.isValid || !pb.authStore.record) {
    return { ok: false, formError: 'Not signed in' };
  }
  const userId = pb.authStore.record.id;

  try {
    await pb.collection('users').update(userId, {
      ntfy_topic: parsed.data.ntfy_topic,
      notify_overdue: parsed.data.notify_overdue,
      notify_assigned: parsed.data.notify_assigned,
      notify_partner_completed: parsed.data.notify_partner_completed,
      notify_weekly_summary: parsed.data.notify_weekly_summary,
      weekly_summary_day: parsed.data.weekly_summary_day,
    });
  } catch {
    return { ok: false, formError: 'Could not save preferences' };
  }

  // /h and its layouts re-read the user record on render — path revalidation
  // ensures fresh data flows. The caller (Person form) should also issue a
  // client router.refresh() on {ok:true} for immediate UI state.
  revalidatePath('/h');
  return { ok: true };
}
