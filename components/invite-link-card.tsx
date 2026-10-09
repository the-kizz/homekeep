'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  createInvite,
  revokeInvite,
  type CreateInviteResult,
} from '@/lib/actions/invites';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * InviteLinkCard (04-03, D-04 + D-16) — renders:
 *   - "Create invite link" button that invokes createInvite server action
 *   - On success: the URL in a read-only input + a Copy button + expiry
 *     label + an HTTP-LAN fallback when clipboard API is unavailable
 *   - A "Pending invites" list below with a Revoke button per row
 *
 * HTTP-LAN deploy fallback (T-04-03-06): navigator.clipboard is undefined
 * in insecure contexts (e.g. http://192.0.2.10). The Copy button
 * gracefully degrades to a "Copy failed — select the URL manually" toast.
 * We do NOT polyfill execCommand (RESEARCH Don't Hand-Roll — deprecated
 * API + inconsistent behavior). Phase 7 may surface a system-wide
 * "features unavailable" banner.
 *
 * Test hooks:
 *   data-testid="invite-link-card"
 *   data-testid="create-invite-button"
 *   data-testid="invite-url"
 *   data-testid="invite-copy-button"
 *   data-testid="invite-row-<id>"
 *   data-testid="revoke-invite-<id>"
 */
export type PendingInvite = {
  id: string;
  token: string;
  expiresAt: string;
  created: string;
};

export function InviteLinkCard({
  homeId,
  pendingInvites,
}: {
  homeId: string;
  pendingInvites: PendingInvite[];
}) {
  const [isCreating, startCreate] = useTransition();
  const [latest, setLatest] = useState<CreateInviteResult | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  function handleCreate() {
    startCreate(async () => {
      const r = await createInvite(homeId);
      setLatest(r);
      if (!r.ok) {
        toast.error(r.formError || 'Could not create invite');
      } else {
        toast.success('Invite link created');
      }
    });
  }

  async function handleCopy(url: string) {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(url);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Copy failed — select the URL manually');
    }
  }

  function handleRevoke(inviteId: string) {
    setRevoking(inviteId);
    void (async () => {
      const r = await revokeInvite(inviteId);
      setRevoking(null);
      if (!r.ok) {
        toast.error(r.formError || 'Could not revoke');
      } else {
        toast.success('Invite revoked');
      }
    })();
  }

  const createdUrl = latest && latest.ok ? latest.url : null;
  const createdExpires = latest && latest.ok ? latest.expiresAt : null;

  return (
    <div
      className="space-y-4 rounded-md border p-4"
      data-testid="invite-link-card"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium">Invite a member</p>
          <p className="text-xs text-muted-foreground">
            Links expire after 14 days. Share via any messenger.
          </p>
        </div>
        <Button
          type="button"
          onClick={handleCreate}
          disabled={isCreating}
          data-testid="create-invite-button"
          className="w-full sm:w-auto"
        >
          {isCreating ? 'Creating…' : 'Create invite link'}
        </Button>
      </div>

      {createdUrl && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              readOnly
              value={createdUrl}
              data-testid="invite-url"
              aria-label="Invite URL"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => handleCopy(createdUrl)}
              data-testid="invite-copy-button"
            >
              Copy
            </Button>
          </div>
          {createdExpires && (
            <p className="text-xs text-muted-foreground">
              Expires {new Date(createdExpires).toLocaleDateString()}
            </p>
          )}
        </div>
      )}

      {pendingInvites.length > 0 && (
        <div className="space-y-2">
          <p className="section-label">
            Pending invites
          </p>
          <ul className="space-y-1">
            {pendingInvites.map((i) => (
              <li
                key={i.id}
                className="flex items-center justify-between gap-2 rounded border bg-background px-3 py-2 text-sm"
                data-testid={`invite-row-${i.id}`}
              >
                <span className="flex flex-col">
                  <span className="font-mono text-xs truncate">
                    {i.token.slice(0, 8)}…
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Expires {new Date(i.expiresAt).toLocaleDateString()}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={revoking === i.id}
                  onClick={() => handleRevoke(i.id)}
                  data-testid={`revoke-invite-${i.id}`}
                >
                  {revoking === i.id ? 'Revoking…' : 'Revoke'}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
