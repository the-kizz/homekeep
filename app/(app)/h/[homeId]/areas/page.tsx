import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerClient } from '@/lib/pocketbase-server';
import { Button } from '@/components/ui/button';
import {
  SortableAreaList,
  type SortableArea,
} from '@/components/sortable-area-list';
import { NewAreaDialog } from '@/components/forms/new-area-dialog';

/**
 * /h/[homeId]/areas — full area management (AREA-05).
 *
 * Server Component:
 *   - Fetches home (for page title) + all areas (sorted).
 *   - Passes areas to the client SortableAreaList which handles drag
 *     reorder (optimistic + rollback) + edit link + delete dialog.
 *   - Renders the NewAreaDialog (client) for inline create.
 */
export default async function AreasPage({
  params,
}: {
  params: Promise<{ homeId: string }>;
}) {
  const { homeId } = await params;
  const pb = await createServerClient();

  let home;
  try {
    home = await pb.collection('homes').getOne(homeId, {
      fields: 'id,name',
    });
  } catch {
    notFound();
  }

  const areas = await pb.collection('areas').getFullList({
    filter: `home_id = "${homeId}"`,
    sort: 'sort_order,name',
    fields: 'id,name,icon,color,sort_order,is_whole_home_system',
  });

  const initial: SortableArea[] = areas.map((a) => ({
    id: a.id,
    name: String(a.name ?? ''),
    icon: String(a.icon ?? 'home'),
    color: String(a.color ?? '#D4A574'),
    sort_order: Number(a.sort_order ?? 0),
    is_whole_home_system: Boolean(a.is_whole_home_system),
  }));

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Areas</h1>
          <p className="text-sm text-muted-foreground">
            {home.name as string}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="ghost">
            <Link href={`/h/${homeId}`}>Back</Link>
          </Button>
          <NewAreaDialog homeId={homeId} />
        </div>
      </header>

      <SortableAreaList homeId={homeId} initial={initial} />
    </div>
  );
}
