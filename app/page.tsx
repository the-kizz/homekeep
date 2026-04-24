import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/pocketbase-server';
import { Button } from '@/components/ui/button';

/**
 * Public landing page at `/`. Authed users are immediately forwarded to
 * `/h`; unauthed users see the marketing summary + CTAs. Note that Next
 * route groups (`(public)` / `(app)`) do not create URL segments, so the
 * root path lives at the top-level `app/page.tsx` file — we do NOT create
 * `app/(public)/page.tsx` (would collide and 500 at build).
 *
 * Phase 9 UX audit: previous iteration was ~90% whitespace on desktop.
 * This revision introduces a warm presence without piling on marketing
 * copy: a subtle coverage-ring echo behind the wordmark, the existing
 * tagline, CTAs, a 3-item value strip (self-hosted · AGPL · no
 * telemetry), and a small footer link to the GitHub repo.
 */
export default async function LandingPage() {
  const pb = await createServerClient();
  if (pb.authStore.isValid) {
    redirect('/h');
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <div className="relative flex w-full max-w-sm flex-col items-center gap-6 text-center">
        {/* Subtle presence: a muted warm ring behind the wordmark
            echoes the app's CoverageRing motif without being loud.
            Sits behind via -z-10 + absolute so it doesn't affect
            layout; size tuned so it frames the wordmark + tagline. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-[-2.5rem] left-1/2 -z-10 size-44 -translate-x-1/2 rounded-full border-[1.5px] border-primary/20"
        />
        <h1 className="font-display text-4xl font-medium tracking-tight">
          HomeKeep
        </h1>
        <p className="text-muted-foreground">
          Make household maintenance visible, shared, and calm.
        </p>
        <div className="flex justify-center gap-3">
          <Button asChild>
            <Link href="/signup">Get started</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/login">Log in</Link>
          </Button>
        </div>
        {/* Tagline strip — three short value bullets separated by a
            warm divider dot. Intentionally understated; the goal is
            presence, not a sales page. */}
        <ul className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <li>self-hosted</li>
          <li aria-hidden="true" className="text-primary/60">
            ·
          </li>
          <li>AGPL-3.0-or-later</li>
          <li aria-hidden="true" className="text-primary/60">
            ·
          </li>
          <li>no telemetry</li>
        </ul>
      </div>
      {/* Footer: distinct from the content block (extra gap from the
          parent flex) so it reads as a quiet attribution link rather
          than part of the primary pitch. */}
      <a
        href="https://github.com/the-kizz/homekeep"
        className="text-xs text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
      >
        github.com/the-kizz/homekeep
      </a>
    </main>
  );
}
