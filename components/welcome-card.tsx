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
import { CalendarDays, History, Mountain } from 'lucide-react';
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
  {
    Icon: History,
    tone: 'text-status-overdue',
    text: 'Overdue is what slipped. No judgement.',
  },
  {
    Icon: CalendarDays,
    tone: 'text-status-soon-deep',
    text: "This week is what's coming up next.",
  },
  {
    Icon: Mountain,
    tone: 'text-status-healthy',
    text: 'Horizon is the year at a glance. A stronger colour means a busier month.',
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
      className="mx-auto mb-6 max-w-6xl px-4 sm:px-6"
    >
      <div className="rounded-xl border border-hairline bg-surface-2 p-4 sm:p-5">
        <p className="font-display text-xl font-medium tracking-tight text-foreground">
          Here&rsquo;s how to read your home.
        </p>
        <ul className="mt-3 space-y-2.5 text-sm leading-5 text-foreground/85">
          {LINES.map(({ Icon, tone, text }) => (
            <li key={text} className="flex items-start gap-3">
              <Icon
                aria-hidden="true"
                strokeWidth={1.75}
                className={`size-[18px] shrink-0 ${tone}`}
              />
              <span>{text}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button asChild variant="outline">
            <Link href={`/h/${homeId}/settings`}>Invite someone</Link>
          </Button>
          <Button type="button" onClick={dismiss}>
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
