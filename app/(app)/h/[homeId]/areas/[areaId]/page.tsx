import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Plus } from 'lucide-react';
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
import { TaskList, type TaskRow } from '@/components/task-list';

/**
 * /h/[homeId]/areas/[areaId] — edit area + tasks in this area.
 *
 * 02-04 scope: AreaForm mode="edit" (Whole Home areas editable for
 *              name/icon/color — delete guarded at both UI + action).
 * 02-05 scope: + TaskList rendering active tasks + "+ Add task" link
 *              carrying the areaId query param so the create form
 *              pre-selects this area.
 */
export default async function AreaDetailPage({
  params,
}: {
  params: Promise<{ homeId: string; areaId: string }>;
}) {
  const { homeId, areaId } = await params;
  const pb = await createServerClient();

  let home;
  let area;
  try {
    [home, area] = await Promise.all([
      pb.collection('homes').getOne(homeId, {
        fields: 'id,name,timezone',
      }),
      pb.collection('areas').getOne(areaId, {
        fields:
          'id,home_id,name,icon,color,sort_order,scope,is_whole_home_system',
      }),
    ]);
  } catch {
    notFound();
  }

  // Defensive: the area must belong to the URL's home (PB viewRule also
  // gates this).
  if (area.home_id !== homeId) {
    notFound();
  }

  const tasksRaw = await pb.collection('tasks').getFullList({
    filter: pb.filter('area_id = {:aid} && archived = false', { aid: areaId }),
    sort: '-created',
    fields:
      'id,name,created,frequency_days,schedule_mode,anchor_date,archived',
  });
  const tasks: TaskRow[] = tasksRaw.map((t) => ({
    id: t.id,
    name: (t.name as string) ?? '',
    created: String(t.created ?? ''),
    frequency_days: Number(t.frequency_days ?? 7),
    schedule_mode: (t.schedule_mode === 'anchored'
      ? 'anchored'
      : 'cycle') as 'cycle' | 'anchored',
    anchor_date:
      typeof t.anchor_date === 'string' && t.anchor_date.length > 0
        ? (t.anchor_date as string)
        : null,
    archived: Boolean(t.archived),
  }));

  const timezone =
    typeof home.timezone === 'string' && home.timezone.length > 0
      ? (home.timezone as string)
      : 'Australia/Perth';

  const isSystem = Boolean(area.is_whole_home_system);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
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
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle>Tasks in {area.name as string}</CardTitle>
            <CardDescription>
              {tasks.length === 0
                ? 'No tasks yet. Add the first one.'
                : `${tasks.length} active task${tasks.length === 1 ? '' : 's'}.`}
            </CardDescription>
          </div>
          <Button asChild size="sm">
            <Link href={`/h/${homeId}/tasks/new?areaId=${areaId}`}>
              <Plus className="mr-1 size-4" /> Add task
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          <TaskList
            tasks={tasks}
            homeId={homeId}
            timezone={timezone}
            now={new Date()}
          />
        </CardContent>
      </Card>
    </div>
  );
}
