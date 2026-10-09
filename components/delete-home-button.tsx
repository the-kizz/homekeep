'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { deleteHome } from '@/lib/actions/homes';
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
 * DeleteHomeButton (04-03, D-16 Danger Zone).
 *
 * Confirm-dialog wrapping deleteHome. Kept deliberately simple for
 * Phase 4 — a typed-name confirm (matching the home's name) is deferred
 * to Phase 5 per the 02-04 STATE note. Users still get a friction-ful
 * "Delete home" button + confirm + server action.
 *
 * On success: router.push('/h'); if the user had multiple homes the
 * last_viewed_home_id cascade (Phase 2 HOME-03) puts them on the next
 * one; otherwise they see the empty /h "Create your first home" state.
 */
export function DeleteHomeButton({
  homeId,
  homeName,
}: {
  homeId: string;
  homeName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      const r = await deleteHome(homeId);
      if (!r.ok) {
        toast.error(r.formError || 'Could not delete home');
        return;
      }
      toast.success(`${homeName} deleted`);
      setOpen(false);
      router.push('/h');
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        onClick={() => setOpen(true)}
        data-testid="delete-home-button"
      >
        Delete home
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="delete-home-dialog">
          <DialogHeader>
            <DialogTitle>Delete {homeName}?</DialogTitle>
            <DialogDescription>
              This permanently removes the home, its areas, and tasks for
              every member. This cannot be undone.
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
              data-testid="delete-home-confirm"
            >
              {isPending ? 'Deleting…' : 'Delete home'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
