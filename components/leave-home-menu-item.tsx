'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { leaveHome } from '@/lib/actions/members';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/**
 * LeaveHomeMenuItem (04-03, D-15).
 *
 * Renders an in-menu button that opens a confirm Dialog; on confirm,
 * calls leaveHome(homeId) server action. On success, router.push's to
 * the server-supplied redirectTo (typically /h).
 *
 * Why a separate component rather than inlined into AccountMenu:
 *   - Isolates the Dialog + useTransition state so the menu stays simple
 *     for the default (owner) case.
 *   - Keeps the leaveHome import out of AccountMenu, since AccountMenu
 *     is on every /h/* page even for owners who'd never use this path.
 *
 * Note: the menu item is NOT wrapped in DropdownMenuItem — Radix's
 * DropdownMenu auto-closes when an item is clicked, which would dismiss
 * our Dialog trigger. We render a lookalike button styled to match
 * DropdownMenuItem's visuals and manage open state manually.
 */
export function LeaveHomeMenuItem({ homeId }: { homeId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      const r = await leaveHome(homeId);
      if (r.ok) {
        setOpen(false);
        router.push(r.redirectTo);
        router.refresh();
      } else {
        toast.error(r.formError || 'Could not leave home');
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          // Radix menus use pointerdown to close; stop propagation so the
          // dropdown stays open, then open the Dialog. After the click
          // the dropdown will still close naturally once the Dialog
          // portals out — acceptable UX.
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        data-testid="leave-home-menu-item"
        className="relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive outline-none transition-colors hover:bg-accent focus:bg-accent"
      >
        Leave home
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="leave-home-dialog">
          <DialogHeader>
            <DialogTitle>Leave this home?</DialogTitle>
            <DialogDescription>
              Your task assignments will fall back to the area default. You
              can rejoin later if you’re invited again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={onConfirm}
              disabled={isPending}
              data-testid="leave-home-confirm"
            >
              {isPending ? 'Leaving…' : 'Leave home'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
