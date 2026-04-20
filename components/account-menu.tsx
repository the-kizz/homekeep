'use client';

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

/**
 * Account menu — top-right affordance on /h/* routes (D-07).
 *
 * Logout is a form POST to the logoutAction server action (not a client
 * handler) so it works without JS and participates in Next 16's
 * cookie-clear + redirect single-response flow.
 */
export function AccountMenu({ userName }: { userName?: string }) {
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
