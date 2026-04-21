import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/pocketbase-server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/**
 * /h — homes landing (02-04, replaces 02-03 stub).
 *
 * Behavior:
 *   - No homes        → empty state with "Create your first home" CTA.
 *   - last_viewed_home_id still exists → redirect to /h/[last] (HOME-03).
 *   - Exactly one home → redirect to /h/[only].
 *   - Many homes      → grid of cards linking to /h/[id] (HOME-02).
 *
 * Adapted from RESEARCH §Code Examples lines 1417-1468.
 */
export default async function HomesLandingPage() {
  const pb = await createServerClient();
  if (!pb.authStore.isValid || !pb.authStore.record) {
    redirect('/login');
  }

  const userId = pb.authStore.record.id;
  const lastViewedRaw = pb.authStore.record.last_viewed_home_id;
  const lastViewedHomeId =
    typeof lastViewedRaw === 'string' && lastViewedRaw.length > 0
      ? lastViewedRaw
      : null;

  const homes = await pb.collection('homes').getFullList({
    filter: `owner_id = "${userId}"`,
    sort: '-created',
    fields: 'id,name,address',
  });

  // HOME-03: land on last-viewed when it's still present in the list.
  if (lastViewedHomeId && homes.some((h) => h.id === lastViewedHomeId)) {
    redirect(`/h/${lastViewedHomeId}`);
  }

  // Single-home shortcut — users with exactly one home never see the
  // chooser list.
  if (homes.length === 1) {
    redirect(`/h/${homes[0].id}`);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Your homes</h1>

      {homes.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Welcome to HomeKeep</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-muted-foreground">
              You don&apos;t have any homes yet. Start by creating one.
            </p>
            <Button asChild>
              <Link href="/h/new">Create your first home</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2">
            {homes.map((h) => (
              <li key={h.id}>
                <Link href={`/h/${h.id}`}>
                  <Card className="p-4 transition-colors hover:bg-muted">
                    <div className="font-medium">{h.name as string}</div>
                    {h.address ? (
                      <div className="text-sm text-muted-foreground">
                        {h.address as string}
                      </div>
                    ) : null}
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
          <div>
            <Button asChild variant="outline">
              <Link href="/h/new">+ Create another home</Link>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
