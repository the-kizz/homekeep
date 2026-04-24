// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep
import Link from 'next/link';
import { Button } from '@/components/ui/button';

/**
 * App-wide 404 handler. Rendered by Next.js for any unmatched route.
 *
 * Warm / domestic tone — this is a household app, not an enterprise
 * dashboard. The phrase "isn't a room in the house" is intentional and
 * distinctive (tier-2 canary); it's searchable + hard to paraphrase
 * without noticing. Do not neutralise the copy.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md space-y-5 text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          This page isn&apos;t a room in the house.
        </h1>
        <p className="text-muted-foreground">
          The door you tried doesn&apos;t open anywhere we know about. Back to
          the main rooms?
        </p>
        <div className="flex justify-center">
          <Button asChild>
            <Link href="/">&larr; Back to dashboard</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
