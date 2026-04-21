import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerClient } from '@/lib/pocketbase-server';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AreaForm } from '@/components/forms/area-form';

/**
 * /h/[homeId]/areas/[areaId] — edit area + future task list surface.
 *
 * For 02-04: renders the <AreaForm mode="edit"> for name/icon/color
 * changes. Whole Home areas are editable (name/icon/color) — only delete
 * is blocked — so we surface the same form without gating.
 *
 * 02-05 extends this page with a "Tasks in this area" section.
 */
export default async function AreaDetailPage({
  params,
}: {
  params: Promise<{ homeId: string; areaId: string }>;
}) {
  const { homeId, areaId } = await params;
  const pb = await createServerClient();

  let area;
  try {
    area = await pb.collection('areas').getOne(areaId, {
      fields:
        'id,home_id,name,icon,color,sort_order,scope,is_whole_home_system',
    });
  } catch {
    notFound();
  }

  // Defensive: belt-and-braces enforcement that the area belongs to the
  // URL's homeId (PB's viewRule already gated the getOne).
  if (area.home_id !== homeId) {
    notFound();
  }

  const isSystem = Boolean(area.is_whole_home_system);

  return (
    <div className="mx-auto max-w-md space-y-4 p-6">
      <Button asChild variant="ghost" size="sm">
        <Link href={`/h/${homeId}/areas`}>← Back to areas</Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>
            {isSystem ? 'Edit Whole Home' : `Edit ${area.name as string}`}
          </CardTitle>
          <CardDescription>
            {isSystem
              ? 'You can rename or restyle the Whole Home area. It cannot be deleted.'
              : 'Update this area’s name, icon, or color.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AreaForm
            mode="edit"
            homeId={homeId}
            area={{
              id: area.id,
              home_id: String(area.home_id),
              name: String(area.name ?? ''),
              icon: String(area.icon ?? 'home'),
              color: String(area.color ?? '#D4A574'),
              sort_order: Number(area.sort_order ?? 0),
              scope: (area.scope === 'whole_home'
                ? 'whole_home'
                : 'location') as 'location' | 'whole_home',
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tasks</CardTitle>
          <CardDescription>
            Task list for this area lands in 02-05.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
