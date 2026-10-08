'use client';

// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep

/**
 * WelcomeCard — a one-time explainer above the dashboard bands.
 *
 * A new household lands on three bands and a ring with no idea what
 * they mean; this card says it in three lines and nudges an invite,
 * then gets out of the way for good.
 *
 * Shown when the URL carries `?welcome=1` (an explicit re-show) or when
 * this browser has never dismissed it for this home
 * (`localStorage['hk:welcomed:<homeId>']` absent). "Got it" writes the
 * key and strips the param.
 *
 * Storage is read through useSyncExternalStore with a `false` server
 * snapshot so returning users never see the card flash during
 * hydration. Every storage access is guarded: private windows and
 * blocked site data throw, and the card must still render and dismiss.
 */

import { Suspense, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CalendarDays, CalendarRange, History } from 'lucide-react';
import { Button } from '@/components/ui/button';

const storageKey = (homeId: string) => `hk:welcomed:${homeId}`;

function readDismissed(homeId: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(homeId)) !== null;
  } catch {
    return false;
  }
}

function writeDismissed(homeId: string): void {
  try {
    window.localStorage.setItem(storageKey(homeId), '1');
  } catch {
    /* storage unavailable — dismissal lasts for this page only */
  }
}

const noopSubscribe = () => () => {};

const LINES = [
  { Icon: History, text: 'Overdue — things that slipped, no judgement.' },
  { Icon: CalendarDays, text: "This week — what's coming up next." },
  {
    Icon: CalendarRange,
    text: 'Horizon — the year at a glance; darker months are busier.',
  },
] as const;

function WelcomeCardInner({ homeId }: { homeId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const forced = searchParams.get('welcome') === '1';

  const dismissedBefore = useSyncExternalStore(
    noopSubscribe,
    () => readDismissed(homeId),
    () => true,
  );
  const [dismissedNow, setDismissedNow] = useState(false);

  if (dismissedNow || (!forced && dismissedBefore)) return null;

  function dismiss() {
    writeDismissed(homeId);
    setDismissedNow(true);
    if (searchParams.has('welcome')) {
      const next = new URLSearchParams(searchParams.toString());
      next.delete('welcome');
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  }

  return (
    <section
      role="region"
      aria-label="Welcome"
      data-welcome-card
      className="mx-auto mb-2 max-w-4xl px-6"
    >
      <div className="rounded-xl border border-primary/20 bg-primary/10 p-4 sm:p-5">
        <p className="font-display text-lg text-foreground/90">
          Here&rsquo;s how to read your home.
        </p>
        <ul className="mt-3 space-y-2 text-sm text-foreground/80">
          {LINES.map(({ Icon, text }) => (
            <li key={text} className="flex items-start gap-2">
              <Icon
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-primary"
              />
              <span>{text}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/h/${homeId}/settings`}>Invite someone</Link>
          </Button>
          <Button type="button" size="sm" onClick={dismiss}>
            Got it
          </Button>
        </div>
      </div>
    </section>
  );
}

/**
 * useSearchParams needs a Suspense boundary so the rest of the page can
 * still stream; the card has nothing worth a fallback.
 */
export function WelcomeCard({ homeId }: { homeId: string }) {
  return (
    <Suspense fallback={null}>
      <WelcomeCardInner homeId={homeId} />
    </Suspense>
  );
}
