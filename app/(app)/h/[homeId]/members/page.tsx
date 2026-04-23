import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/pocketbase-server';
import { assertOwnership } from '@/lib/membership';
import { MembersList, type MemberRow } from '@/components/members-list';
import { Button } from '@/components/ui/button';

/**
 * /h/[homeId]/members — owner-gated members route (04-03 D-07).
 *
 * Lists all home members with name, email, role, join date, and
 * (for non-self non-owner rows) a Remove button with a confirm Dialog.
 *
 * Non-owner access → redirect to the home dashboard.
 */
export default async function MembersPage({
  params,
}: {
  params: Promise<{ homeId: string }>;
}) {
  const { homeId } = await params;
  const pb = await createServerClient();
  const authId = pb.authStore.record?.id as string | undefined;
  if (!authId) redirect('/login');

  try {
    await assertOwnership(pb, homeId);
  } catch {
    redirect(`/h/${homeId}`);
  }

  const rows = await pb.collection('home_members').getFullList({
    filter: pb.filter('home_id = {:hid}', { hid: homeId }),
    expand: 'user_id',
    sort: '-role,joined_at',
    fields:
      'id,role,joined_at,user_id,expand.user_id.id,expand.user_id.name,expand.user_id.email',
  });

  const members: MemberRow[] = rows.map((r) => {
    const u = (
      r.expand as
        | Record<string, { id?: string; name?: string; email?: string }>
        | undefined
    )?.user_id;
    return {
      memberRowId: r.id,
      userId: (u?.id as string) ?? '',
      name: (u?.name as string) || (u?.email as string) || 'Member',
      email: (u?.email as string) ?? '',
      role: r.role as 'owner' | 'member',
      joinedAt: r.joined_at as string,
    };
  });

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <Button asChild variant="ghost" size="sm">
        <Link href={`/h/${homeId}/settings`}>← Back to settings</Link>
      </Button>
      <h1 className="text-xl font-semibold">Members</h1>
      <MembersList
        homeId={homeId}
        members={members}
        currentUserId={authId}
      />
    </main>
  );
}
