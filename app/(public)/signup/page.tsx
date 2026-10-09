import Link from 'next/link';
import { SignupForm } from '@/components/forms/signup-form';
import { Card } from '@/components/ui/card';

/**
 * Signup page. Next 16 async searchParams contract: searchParams is a
 * Promise<Record<string, string|undefined>>. We read `next` (04-02
 * Pitfall 5) so the invite landing (/invite/TOKEN) can redirect here
 * with `?next=/invite/TOKEN` and have the token survive the
 * signup → post-signup-redirect round trip.
 *
 * `next` is passed as a string (or undefined) to <SignupForm>, which
 * renders it as a hidden input. `safeNext` on the server rejects any
 * hostile / cross-origin value, so we don't need to validate here.
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  // Thread next through the login link too — if the user clicks "Log in"
  // after landing on /invite/TOKEN → /signup?next=/invite/TOKEN, they
  // should not lose the destination when choosing login instead.
  const loginHref = next ? `/login?next=${next}` : '/login';

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm space-y-4 p-6">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-medium tracking-tight">Create your account</h1>
          <p className="text-sm text-muted-foreground">
            One account, one household. More members can join later.
          </p>
        </div>
        <SignupForm next={next} />
        <p className="text-sm text-muted-foreground">
          {/* Phase 9 UX audit: the warm primary (hsl 30 45% 65%) sits
              right on the 4.5:1 edge against the cream card background,
              so color alone isn't a reliable signal that this is a
              link. Add a persistent underline with underline-offset-2
              (kept subtle) so the affordance is legible to anyone who
              can't distinguish the hue from body copy. */}
          Already have an account?{' '}
          <Link
            href={loginHref}
            className="text-link underline underline-offset-2 hover:text-link/80 bold-link"
          >
            Log in
          </Link>
        </p>
      </Card>
    </main>
  );
}
