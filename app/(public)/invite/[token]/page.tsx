import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/pocketbase-server';
import { acceptInvite } from '@/lib/actions/invites';
import { Card } from '@/components/ui/card';

/**
 * Public invite landing (04-02 HOME-06, Pattern 8).
 *
 * Flow:
 *   1. Token arrives as a URL path param (/invite/TOKEN). Base64url
 *      chars are URL-safe by spec — do NOT wrap with encodeURIComponent
 *      (RESEARCH Anti-Pattern, T-04-02-10).
 *   2. Shape-validate the token up-front (regex from acceptInviteSchema
 *      — mirrored here because we branch on the result BEFORE invoking
 *      the action). Malformed tokens render the invalid-invite card.
 *   3. Auth gate: if the user is not signed in, redirect to
 *      /signup?next=/invite/TOKEN. Next 16 `redirect()` throws
 *      internally to abort rendering — callers beyond this point are
 *      reachable only when authed.
 *   4. Run `acceptInvite(token)` server-side. The discriminated-union
 *      result drives either:
 *        - ok → redirect to /h/{homeId} (success path)
 *        - reason=expired|already-accepted|invalid → friendly error card
 *        - reason=error → generic fallback
 *
 * Referrer-Policy (T-04-02-04): the global app layout sets
 * `<meta name="referrer" content="no-referrer" />` as belt-and-braces
 * so the invite URL is not leaked via Referer on outbound link clicks.
 */

export const dynamic = 'force-dynamic';

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

export default async function InviteAcceptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (typeof token !== 'string' || !TOKEN_RE.test(token)) {
    return <InviteError message="This invite link is invalid." />;
  }

  const pb = await createServerClient();
  if (!pb.authStore.isValid) {
    // Base64url is URL-safe by spec — pass the token through unwrapped
    // (RESEARCH Anti-Pattern: do NOT encodeURIComponent the token).
    redirect(`/signup?next=/invite/${token}`);
  }

  const result = await acceptInvite(token);

  if (result.ok) {
    redirect(`/h/${result.homeId}`);
  }

  const message =
    result.reason === 'expired'
      ? 'This invite has expired. Ask the home owner for a new one.'
      : result.reason === 'already-accepted'
        ? 'This invite was already used by someone else.'
        : result.reason === 'invalid'
          ? 'This invite link is invalid.'
          : result.reason === 'not-authed'
            ? 'Please sign in to accept this invite.'
            : 'Something went wrong accepting this invite.';

  return <InviteError message={message} />;
}

function InviteError({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm space-y-4 p-6">
        <h1 className="text-xl font-semibold">Invite unavailable</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        <Link className="text-primary hover:underline" href="/h">
          Go to your homes
        </Link>
      </Card>
    </main>
  );
}
