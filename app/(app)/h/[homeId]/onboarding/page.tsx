import { notFound, redirect } from 'next/navigation';
import { createServerClient } from '@/lib/pocketbase-server';
import { assertMembership } from '@/lib/membership';
import { OnboardingWizard } from '@/components/onboarding-wizard';
import { SEED_LIBRARY } from '@/lib/seed-library';

/**
 * /h/[homeId]/onboarding — first-run seed library wizard (05-03 Task 2, D-13/D-14).
 *
 * Server Component flow:
 *   1. assertMembership gates non-members via notFound().
 *   2. Fetch home (including the `onboarded` flag).
 *   3. If home.onboarded === true → redirect to /h/[id] (short-circuit —
 *      already onboarded, no reason to re-run the wizard).
 *   4. Fetch areas (Whole Home always exists via Phase 2 hook) → pass to
 *      the OnboardingWizard client component along with SEED_LIBRARY.
 *
 * The wizard owns the submit UX; this page is a thin server shell.
 *
 * Next 16 async params contract: `params: Promise<{ homeId }>`.
 */
export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ homeId: string }>;
}) {
  const { homeId } = await params;
  const pb = await createServerClient();

  try {
    await assertMembership(pb, homeId);
  } catch {
    notFound();
  }

  let home;
  try {
    home = await pb.collection('homes').getOne(homeId, {
      fields: 'id,name,owner_id,onboarded,timezone',
    });
  } catch {
    notFound();
  }

  if (home.onboarded === true) {
    redirect(`/h/${homeId}`);
  }

  const areas = await pb.collection('areas').getFullList({
    filter: pb.filter('home_id = {:hid}', { hid: homeId }),
    sort: 'sort_order,name',
    fields: 'id,name,is_whole_home_system',
  });

  const areasShape = areas.map((a) => ({
    id: a.id as string,
    name: a.name as string,
    is_whole_home_system: Boolean(a.is_whole_home_system),
  }));

  return (
    <OnboardingWizard
      home={{ id: homeId, name: home.name as string }}
      areas={areasShape}
      seeds={SEED_LIBRARY}
    />
  );
}
