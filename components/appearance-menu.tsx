'use client';

import { Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ThemeToggle } from '@/components/theme-toggle';

/**
 * Appearance control for the public pages (landing, login, signup, reset,
 * invite), where there is no account menu yet. It opens the same two rows
 * as the account menu (ThemeToggle), which persist through the cookie and
 * localStorage only, so no account is needed.
 *
 * Positioned in the top-right corner of the nearest `relative` ancestor.
 */
export function AppearanceMenu() {
  return (
    <div className="absolute top-[max(0.5rem,env(safe-area-inset-top))] right-2 z-40 sm:top-3 sm:right-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Appearance"
            className="size-11 rounded-full text-muted-foreground hover:text-foreground"
          >
            <Palette className="size-5" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <ThemeToggle />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
