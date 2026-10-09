import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/pocketbase-server';
import { assertMembership } from '@/lib/membership';
import { leaveHome } from '@/lib/actions/members';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/**
 * /h/[homeId]/leave — linkable confirmation page (04-03 D-15).
 *
 * AccountMenu's LeaveHomeMenuItem opens a Dialog for the common case;
 * this route is a fallback + SSR-friendly alternative for users who
 * land here via direct URL / bookmark. Also useful for tests that want
 * a plain server-submitted form flow with no client JS.
 *
 * Flow:
 *   - Non-member → redirect /h
 *   - Owner (role === 'owner') → redirect /h/[homeId]/settings (delete
 *     instead of leaving)
 *   - Member → render confirm; on POST, call leaveHome + redirect
 */
export default async function LeaveHomePage({
  params,
}: {
  params: Promise<{ homeId: string }>;
}) {
  const { homeId } = await params;
  const pb = await createServerClient();

  try {
    const { role } = await assertMembership(pb, homeId);
    if (role === 'owner') redirect(`/h/${homeId}/settings`);
  } catch {
    redirect('/h');
  }

  async function onConfirm() {
    'use server';
    const r = await leaveHome(homeId);
    if (r.ok) redirect(r.redirectTo);
    // Failure falls through — the user lands back on this page.
  }

  return (
    <main className="mx-auto max-w-md space-y-4 p-6">
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>Leave this home?</CardTitle>
          <CardDescription>
            Your task assignments will fall back to the area default. You
            can rejoin later if you’re invited again.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button asChild variant="outline">
            <Link href={`/h/${homeId}`}>Cancel</Link>
          </Button>
          <form action={onConfirm}>
            <Button variant="destructive" type="submit">
              Leave home
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
