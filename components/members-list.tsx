'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { removeMember } from '@/lib/actions/members';
import { AvatarCircle, initialsOf } from '@/components/avatar-circle';
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
 * MembersList (04-03, D-07) — list of home members with a confirm-dialog
 * Remove button per row. The Remove button is suppressed on:
 *   - The current user's own row (self-removal uses Leave Home instead)
 *   - Any 'owner' row (the server-side removeMember action also guards
 *     this, but hiding the button is the first line of defence)
 *
 * Uses AvatarCircle initials for a compact row visual matching the
 * dashboard header's AvatarStack.
 *
 * Test hooks:
 *   data-testid="member-row-<userId>"
 *   data-testid="remove-member-<userId>"
 *   data-testid="remove-confirm-<userId>"
 */
export type MemberRow = {
  memberRowId: string;
  userId: string;
  name: string;
  email: string;
  role: 'owner' | 'member';
  joinedAt: string;
};

export function MembersList({
  homeId,
  members,
  currentUserId,
}: {
  homeId: string;
  members: MemberRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<MemberRow | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    if (!confirming) return;
    const target = confirming;
    startTransition(async () => {
      const r = await removeMember(homeId, target.userId);
      if (!r.ok) {
        toast.error(r.formError || 'Could not remove member');
        return;
      }
      toast.success(`Removed ${target.name}`);
      setConfirming(null);
      router.refresh();
    });
  }

  if (members.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No members found.</p>
    );
  }

  return (
    <>
      <ul className="space-y-2">
        {members.map((m) => {
          const isSelf = m.userId === currentUserId;
          const canRemove = !isSelf && m.role !== 'owner';
          return (
            <li
              key={m.memberRowId}
              className="flex items-center justify-between gap-3 rounded-md border p-3"
              data-testid={`member-row-${m.userId}`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <AvatarCircle
                  initials={initialsOf(m.name)}
                  variant="soft"
                  size="md"
                  title={m.name}
                />
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-medium truncate">
                    {m.name}
                    {isSelf && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        (you)
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground truncate">
                    {m.email}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={
                    m.role === 'owner'
                      ? 'rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-primary'
                      : 'rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground'
                  }
                >
                  {m.role}
                </span>
                {canRemove && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirming(m)}
                    data-testid={`remove-member-${m.userId}`}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <Dialog
        open={!!confirming}
        onOpenChange={(o) => !o && setConfirming(null)}
      >
        <DialogContent data-testid="remove-member-dialog">
          <DialogHeader>
            <DialogTitle>Remove {confirming?.name}?</DialogTitle>
            <DialogDescription>
              Their task assignments will fall back to the area default.
              This cannot be undone — you’ll need to send a new invite to
              bring them back.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirming(null)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirm}
              disabled={isPending}
              data-testid={
                confirming ? `remove-confirm-${confirming.userId}` : undefined
              }
            >
              {isPending ? 'Removing…' : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
