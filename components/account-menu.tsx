'use client';

import { usePathname } from 'next/navigation';
import { User } from 'lucide-react';
import { logoutAction } from '@/lib/actions/auth';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LeaveHomeMenuItem } from '@/components/leave-home-menu-item';
import { ThemeToggle } from '@/components/theme-toggle';

/**
 * Account menu — top-right affordance on /h/* routes (D-07 + 04-03 D-15).
 *
 * Logout is a form POST to the logoutAction server action (not a client
 * handler) so it works without JS and participates in Next 16's
 * cookie-clear + redirect single-response flow.
 *
 * 04-03: adds a conditional "Leave home" item when the user is viewing
 * a home they don't own (not in ownedHomeIds). The current homeId is
 * parsed from usePathname() — pathname is reactive so the menu updates
 * when the user navigates between homes.
 */

function parseHomeIdFromPath(pathname: string | null): string | null {
  if (!pathname) return null;
  // Matches /h/<15char id>/... — PB ids are always 15 chars.
  const m = pathname.match(/^\/h\/([a-z0-9]{15})(?:\/|$)/);
  return m ? m[1] : null;
}

export function AccountMenu({
  userName,
  ownedHomeIds = [],
}: {
  userName?: string;
  ownedHomeIds?: string[];
}) {
  const pathname = usePathname();
  const currentHomeId = parseHomeIdFromPath(pathname);
  const isOwnerOfCurrentHome =
    !!currentHomeId && ownedHomeIds.includes(currentHomeId);
  const showLeaveHome = !!currentHomeId && !isOwnerOfCurrentHome;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Account"
          className="rounded-full"
        >
          <User className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {userName && (
          <>
            <DropdownMenuLabel className="font-normal">
              <span className="text-xs text-muted-foreground">Signed in as</span>
              <div className="truncate font-medium">{userName}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        {showLeaveHome && currentHomeId && (
          <>
            <LeaveHomeMenuItem homeId={currentHomeId} />
            <DropdownMenuSeparator />
          </>
        )}
        <ThemeToggle />
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          {/*
            The Log out item wraps a form whose action is the server
            action. Clicking the menu item submits the form, which POSTs to
            the action; the action clears the pb_auth cookie and
            redirect()s to /login. Works without JS.
          */}
          <form action={logoutAction} className="w-full">
            <button
              type="submit"
              className="w-full cursor-default text-left"
            >
              Log out
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
