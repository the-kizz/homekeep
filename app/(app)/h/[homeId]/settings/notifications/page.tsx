import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerClient } from '@/lib/pocketbase-server';
import { assertMembership } from '@/lib/membership';
import { Button } from '@/components/ui/button';
import { NotificationPrefsForm } from '@/components/notification-prefs-form';
import type { NotificationPrefs } from '@/lib/schemas/notification-prefs';

/**
 * /h/[homeId]/settings/notifications — the signed-in user's own push
 * preferences (ntfy topic + which notifications they want).
 *
 * Unlike the other settings pages this is membership-gated, not
 * owner-gated: preferences belong to the user, so every member must be
 * able to reach them. Members arrive from the Person page link; owners
 * also see a card on /settings.
 *
 * The users collection viewRule allows self-read. Missing fields on a
 * pre-migration row coerce to the product defaults.
 */
export default async function NotificationSettingsPage({
  params,
}: {
  params: Promise<{ homeId: string }>;
}) {
  const { homeId } = await params;
  const pb = await createServerClient();

  const authId = pb.authStore.record?.id as string | undefined;
  if (!authId) notFound();

  let role: 'owner' | 'member';
  try {
    ({ role } = await assertMembership(pb, homeId));
  } catch {
    notFound();
  }

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

  // Non-owners are bounced away from /settings, so send them back to
  // the Person page they came from instead.
  const back =
    role === 'owner'
      ? { href: `/h/${homeId}/settings`, label: '← Back to Settings' }
      : { href: `/h/${homeId}/person`, label: '← Back to you' };

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6 *:max-w-2xl">
      <Button asChild variant="ghost" size="sm">
        <Link href={back.href}>{back.label}</Link>
      </Button>

      <h1 className="text-xl font-semibold">Notifications</h1>

      <NotificationPrefsForm initialPrefs={initialPrefs} />
    </main>
  );
}
