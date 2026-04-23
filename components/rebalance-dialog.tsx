'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  rebalancePreviewAction,
  rebalanceApplyAction,
  type RebalancePreview,
} from '@/lib/actions/rebalance';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

/**
 * Phase 17 Plan 17-02 Rebalance preview + apply Dialog (REBAL-05, REBAL-06,
 * D-08, D-09).
 *
 * Flow:
 *   1. User taps "Rebalance schedule" button → Dialog opens.
 *   2. On open: startTransition fires rebalancePreviewAction(homeId).
 *      While pending, a "Loading preview…" placeholder renders.
 *   3. On preview resolved: counts render per D-09 template —
 *        "Will update: N. Will preserve: M (A anchored, B active
 *         snoozes, C from-now-on)."
 *      update_count === 0 → friendly "Nothing to rebalance" copy +
 *      only a "Close" button (no Apply).
 *   4. Apply button (when update_count > 0): startTransition fires
 *      rebalanceApplyAction(homeId). On success: Sonner toast
 *      "Rebalanced N tasks" + setOpen(false) + router.refresh() for
 *      Next.js revalidatePath pickup. On error: toast.error(formError)
 *      and Dialog stays open.
 *
 * Security posture:
 *   - homeId is a prop from the parent Server Component (Scheduling
 *     page) — not user-editable. Actions re-validate via
 *     assertMembership regardless (Wave 1 T-17-01-07).
 *   - T-17-02-02 (double-click guard): Apply button is disabled while
 *     isPending === true. React's useTransition latch prevents a second
 *     action call during the transition.
 *   - T-17-02-03 (info disclosure): error text comes from the Wave 1
 *     sanitized formError — no PB internals, no stack traces.
 *   - T-17-02-05 (XSS): all preview numbers are JSON-parsed numbers from
 *     the server action result. React auto-escapes text children; no
 *     dangerouslySetInnerHTML anywhere.
 *
 * Reset-on-close: when the Dialog closes, we clear preview + error so
 * the next open re-fetches fresh counts. Important because household
 * state may have changed between opens (tasks added, completions
 * recorded, etc.).
 */
export function RebalanceDialog({ homeId }: { homeId: string }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<RebalancePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen && preview === null && !isPending) {
      startTransition(async () => {
        const r = await rebalancePreviewAction(homeId);
        if (r.ok) {
          setPreview(r.preview);
          setError(null);
        } else {
          setError(r.formError);
          setPreview(null);
        }
      });
    }
    if (!nextOpen) {
      // Reset on close so next open re-fetches fresh counts — household
      // state may have changed (tasks added, completions logged).
      setPreview(null);
      setError(null);
    }
  };

  const handleApply = () => {
    startTransition(async () => {
      const r = await rebalanceApplyAction(homeId);
      if (r.ok) {
        toast.success(
          `Rebalanced ${r.updated} task${r.updated === 1 ? '' : 's'}`,
        );
        setOpen(false);
        router.refresh();
      } else {
        toast.error(r.formError);
      }
    });
  };

  const isEmpty = preview !== null && preview.update_count === 0;
  const isLoadingPreview = isPending && preview === null && error === null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button data-testid="rebalance-trigger">Rebalance schedule</Button>
      </DialogTrigger>
      <DialogContent data-testid="rebalance-dialog">
        <DialogHeader>
          <DialogTitle>Rebalance schedule</DialogTitle>
          <DialogDescription>
            Preview which tasks will be re-placed before applying.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p
            role="alert"
            className="text-sm text-destructive"
            data-testid="rebalance-error"
          >
            {error}
          </p>
        )}

        {isLoadingPreview && (
          <p
            className="text-sm text-muted-foreground"
            data-testid="rebalance-loading"
          >
            Loading preview…
          </p>
        )}

        {preview && !isEmpty && (
          <p className="text-sm" data-testid="rebalance-counts">
            Will update: <strong>{preview.update_count}</strong>. Will
            preserve: <strong>{preview.preserve_total}</strong> (
            {preview.preserve_anchored} anchored,{' '}
            {preview.preserve_override} active snoozes,{' '}
            {preview.preserve_from_now_on} from-now-on).
          </p>
        )}

        {preview && isEmpty && (
          <p className="text-sm" data-testid="rebalance-empty">
            Nothing to rebalance — every task is already preserved or
            placed.
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isPending}
            data-testid="rebalance-cancel"
          >
            {isEmpty ? 'Close' : 'Cancel'}
          </Button>
          {preview && !isEmpty && (
            <Button
              type="button"
              onClick={handleApply}
              disabled={isPending}
              data-testid="rebalance-apply"
            >
              {isPending ? 'Applying…' : 'Apply rebalance'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
