import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { createServerClient } from '@/lib/pocketbase-server';
import { assertOwnership } from '@/lib/membership';
import { Button } from '@/components/ui/button';
import { RebalanceCard } from '@/components/rebalance-card';

/**
 * /h/[homeId]/settings/scheduling — owner-gated Scheduling settings
 * (Phase 17 Plan 17-02 Task 1, REBAL-05, D-07).
 *
 * Section: Rebalance schedule (Phase 17). Future sections (v1.2+) may
 * add auto-rebalance triggers, default tolerance, etc. — this page is
 * the intentional home for household-wide scheduling controls.
 *
 * Non-owner access: redirect to /h/[homeId] matching Phase 4 Settings
 * convention (settings/page.tsx uses the same pattern). notFound is
 * reserved for genuinely bogus home ids (the getOne below).
 *
 * Security (T-17-02-01): assertOwnership throws on non-owner → redirect.
 * This is a Server Component — the gate runs BEFORE any render, so
 * URL-manipulation bypass is impossible.
 */
export default async function SchedulingSettingsPage({
  params,
}: {
  params: Promise<{ homeId: string }>;
}) {
  const { homeId } = await params;
  const pb = await createServerClient();

  try {
    await assertOwnership(pb, homeId);
  } catch {
    redirect(`/h/${homeId}`);
  }

  let home;
  try {
    home = await pb.collection('homes').getOne(homeId, {
      fields: 'id,name',
    });
  } catch {
    notFound();
  }

  const homeName = (home.name as string) ?? 'Home';

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <Button asChild variant="ghost" size="sm">
        <Link href={`/h/${homeId}/settings`}>← Back to Settings</Link>
      </Button>

      <h1 className="text-xl font-semibold">{homeName} — Scheduling</h1>

      <RebalanceCard homeId={homeId} />
    </main>
  );
}
