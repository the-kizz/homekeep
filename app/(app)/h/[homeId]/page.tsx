import Link from 'next/link';
import { notFound } from 'next/navigation';
import * as Icons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { createServerClient } from '@/lib/pocketbase-server';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/**
 * /h/[homeId] — home dashboard (02-04 stub; 02-05 adds task counts).
 *
 * For this plan:
 *   - Fetches the home + its areas (sorted by sort_order, name tiebreak).
 *   - Renders area tiles (icon + color swatch + name) each linking to
 *     /h/[homeId]/areas/[areaId].
 *   - "Manage areas" button jumps to the full reorder/manage page.
 *
 * Next 16 async params contract: `params: Promise<{ homeId: string }>`.
 */

function kebabToPascal(s: string): string {
  return s
    .split('-')
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : ''))
    .join('');
}

const IconModule = Icons as unknown as Record<string, LucideIcon | undefined>;

export default async function HomeDashboardPage({
  params,
}: {
  params: Promise<{ homeId: string }>;
}) {
  const { homeId } = await params;
  const pb = await createServerClient();

  let home;
  try {
    home = await pb.collection('homes').getOne(homeId, { fields: 'id,name,address' });
  } catch {
    notFound();
  }

  const areas = await pb.collection('areas').getFullList({
    filter: `home_id = "${homeId}"`,
    sort: 'sort_order,name',
    fields: 'id,name,icon,color,is_whole_home_system,sort_order',
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{home.name as string}</h1>
          {home.address ? (
            <p className="text-sm text-muted-foreground">
              {home.address as string}
            </p>
          ) : null}
        </div>
        <Button asChild variant="outline">
          <Link href={`/h/${homeId}/areas`}>Manage areas</Link>
        </Button>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Areas</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {areas.map((a) => {
            const Icon =
              IconModule[kebabToPascal(String(a.icon ?? 'home'))] ??
              Icons.HelpCircle;
            return (
              <li key={a.id}>
                <Link href={`/h/${homeId}/areas/${a.id}`}>
                  <Card className="p-4 transition-colors hover:bg-muted">
                    <div className="flex items-center gap-3">
                      <span
                        className="inline-flex size-8 items-center justify-center rounded-md text-white"
                        style={{ background: String(a.color ?? '#D4A574') }}
                        aria-hidden
                      >
                        <Icon className="size-4" />
                      </span>
                      <div className="flex-1 truncate">
                        <div className="font-medium">{a.name as string}</div>
                        <div className="text-xs text-muted-foreground">
                          {/* 02-05 fills real task counts here. */}
                          Tasks coming in 02-05
                        </div>
                      </div>
                    </div>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <Card>
          <CardHeader>
            <CardTitle>Tasks</CardTitle>
            <CardDescription>
              Task management lands in 02-05 (three-band view in Phase 3).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              This home has {areas.length} area{areas.length === 1 ? '' : 's'}{' '}
              ready for tasks.
            </p>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
