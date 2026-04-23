import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createServerClient } from '@/lib/pocketbase-server';
import { archiveTask } from '@/lib/actions/tasks';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TaskForm } from '@/components/forms/task-form';

/**
 * /h/[homeId]/tasks/[taskId] — task detail + edit + archive.
 *
 * The edit form reuses TaskForm in mode="edit"; archive is a separate
 * inline <form> with a single-purpose Server Action that wraps
 * archiveTask and redirects back to the task's area after success. This
 * keeps the archive flow server-rendered + zero-JS-friendly (same pattern
 * as the logout form in AccountMenu from 02-03).
 */
export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ homeId: string; taskId: string }>;
}) {
  const { homeId, taskId } = await params;
  const pb = await createServerClient();

  let task;
  try {
    task = await pb.collection('tasks').getOne(taskId, {
      fields:
        'id,home_id,area_id,name,description,frequency_days,schedule_mode,anchor_date,notes,archived,archived_at,assigned_to_id',
    });
  } catch {
    notFound();
  }

  // Defensive: belt-and-braces that the URL's homeId matches the task's
  // home_id (PB viewRule already scoped by owner).
  if (task.home_id !== homeId) {
    notFound();
  }

  const areasRaw = await pb.collection('areas').getFullList({
    filter: pb.filter('home_id = {:hid}', { hid: homeId }),
    sort: 'sort_order,name',
    fields: 'id,name',
  });
  const areas = areasRaw.map((a) => ({
    id: a.id,
    name: (a.name as string) ?? '',
  }));

  // 04-03 TASK-02: members for the assignee dropdown (see new/page.tsx).
  const memberRows = await pb.collection('home_members').getFullList({
    filter: pb.filter('home_id = {:hid}', { hid: homeId }),
    expand: 'user_id',
    fields:
      'id,user_id,expand.user_id.id,expand.user_id.name,expand.user_id.email',
  });
  const members = memberRows
    .map((r) => {
      const u = (
        r.expand as
          | Record<string, { id?: string; name?: string; email?: string }>
          | undefined
      )?.user_id;
      if (!u?.id) return null;
      return {
        id: u.id,
        name: (u.name as string) || (u.email as string) || 'Member',
      };
    })
    .filter((m): m is { id: string; name: string } => m !== null);

  const archived = Boolean(task.archived);

  // Inline Server Action for the archive form. Placing 'use server'
  // inside an async function expression is allowed in Next 16 Server
  // Components for single-purpose one-liners like this. The redirect
  // bounces the user back to the area detail page where the task is
  // now filtered out.
  async function handleArchive() {
    'use server';
    await archiveTask(taskId);
    redirect(`/h/${homeId}/areas/${task!.area_id as string}`);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <Button asChild variant="ghost" size="sm">
        <Link href={`/h/${homeId}/areas/${task.area_id as string}`}>
          ← Back to area
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>
            {archived ? `${task.name as string} (archived)` : (task.name as string)}
          </CardTitle>
          <CardDescription>
            {archived
              ? 'This task is archived. Restore functionality lands in a future plan.'
              : 'Update the task’s details or archive it when no longer needed.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {archived ? (
            <p className="text-sm text-muted-foreground">
              Archived on{' '}
              {typeof task.archived_at === 'string' && task.archived_at.length > 0
                ? new Date(task.archived_at).toLocaleDateString()
                : 'an unknown date'}
              .
            </p>
          ) : (
            <TaskForm
              mode="edit"
              homeId={homeId}
              areas={areas}
              members={members}
              task={{
                id: task.id,
                home_id: String(task.home_id),
                area_id: String(task.area_id),
                name: String(task.name ?? ''),
                description: String(task.description ?? ''),
                frequency_days: Number(task.frequency_days ?? 7),
                schedule_mode: (task.schedule_mode === 'anchored'
                  ? 'anchored'
                  : 'cycle') as 'cycle' | 'anchored',
                anchor_date:
                  typeof task.anchor_date === 'string' && task.anchor_date.length > 0
                    ? (task.anchor_date as string)
                    : null,
                notes: String(task.notes ?? ''),
                assigned_to_id:
                  typeof task.assigned_to_id === 'string' &&
                  task.assigned_to_id.length > 0
                    ? (task.assigned_to_id as string)
                    : null,
              }}
            />
          )}
        </CardContent>
      </Card>

      {!archived && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Archive task</CardTitle>
            <CardDescription>
              Hides the task from the active list. Historical completions
              (Phase 3+) will still reference it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={handleArchive}>
              <Button variant="destructive" type="submit">
                Archive task
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
