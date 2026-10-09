'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTransition } from 'react';
// Check marks the current home in the list. avoid-ai-design-ignore: I3
import { ChevronDown, Check, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { switchHome } from '@/lib/actions/homes';

type HomeEntry = { id: string; name: string; role?: 'owner' | 'member' };

/**
 * HomeSwitcher — top-left nav affordance on every /h/* route (HOME-04).
 *
 * Accepts the user's homes list + currentHomeId as props from the server
 * (the authed layout fetches them). Renders a shadcn DropdownMenu listing
 * each home plus a "Create another home" link.
 *
 * On selecting a different home, wraps the switchHome server-action call
 * in useTransition (so pending UI stays honest) and then router.push's to
 * the target /h/[id]. Per Open Q #3 we use router.push over
 * revalidatePath('/','layout') to avoid a full-tree invalidation on every
 * switch — the switchHome action revalidates just the /h layout which is
 * enough for the switcher to reflect the new current.
 */
export function HomeSwitcher({
  homes,
  currentHomeId,
}: {
  homes: HomeEntry[];
  currentHomeId: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const current = homes.find((h) => h.id === currentHomeId);

  function selectHome(id: string) {
    if (id === currentHomeId) return;
    startTransition(async () => {
      await switchHome(id);
      router.push(`/h/${id}`);
      router.refresh();
    });
  }

  // Empty state: no homes yet (first-run before the create flow). The
  // switcher degrades to a plain /h/new CTA.
  if (homes.length === 0) {
    return (
      <Button variant="ghost" asChild size="sm">
        <Link href="/h/new">
          <Plus className="mr-1 size-4" /> Create home
        </Link>
      </Button>
    );
  }

  // Single-home users don't need a switcher — the home name is already
  // shown as the h1 on the page body, and exposing a dropdown that
  // just toggles open/closed on a single item is pure noise (Phase 9
  // UX audit finding). Rendering `null` keeps the top-nav flex row
  // tidy; the AccountMenu on the right still provides "Create another
  // home" via the /h route, and the /h empty state CTA covers the
  // zero-homes case above.
  if (homes.length === 1) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 max-w-[12rem]"
          disabled={isPending}
        >
          {/* Multi-home: show the CURRENT home's name (not the generic
              "Select home" which made it look like nothing was picked).
              Truncate long names — the dropdown lists the full text. */}
          <span className="truncate">
            {current?.name ?? homes[0]?.name ?? 'Your homes'}
          </span>
          <ChevronDown className="size-4 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Your homes
        </DropdownMenuLabel>
        {homes.map((h) => (
          <DropdownMenuItem
            key={h.id}
            onSelect={() => selectHome(h.id)}
            className="flex items-center justify-between"
          >
            <span className="flex items-center gap-1.5 truncate">
              <span className="truncate">{h.name}</span>
              {h.role === 'owner' && (
                <span className="text-xs text-muted-foreground">
                  Owner
                </span>
              )}
            </span>
            {h.id === currentHomeId && (
              <Check className="size-4 text-link" />
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/h/new" className="flex items-center gap-1">
            <Plus className="size-4" /> Create another home
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
