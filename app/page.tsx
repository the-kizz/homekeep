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
 */
export default async function LandingPage() {
  const pb = await createServerClient();
  if (pb.authStore.isValid) {
    redirect('/h');
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md space-y-6 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">HomeKeep</h1>
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
      </div>
    </main>
  );
}
