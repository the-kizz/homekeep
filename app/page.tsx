import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/pocketbase-server';
import clsx from 'clsx';
import { Button } from '@/components/ui/button';
import { BAND_STACK, BAND_SURFACE, BandHeader } from '@/components/band-header';
import { AppearanceMenu } from '@/components/appearance-menu';

/**
 * Public landing page at `/`. Authed users are immediately forwarded to
 * `/h`; unauthed users see the marketing summary + CTAs. Note that Next
 * route groups (`(public)` / `(app)`) do not create URL segments, so the
 * root path lives at the top-level `app/page.tsx` file — we do NOT create
 * `app/(public)/page.tsx` (would collide and 500 at build).
 *
 * Round 2 design: the page says what HomeKeep does in one paragraph and
 * then shows it, with a captioned, static example of the dashboard.
 */
/*
 * The landing shows the product doing its one job: a small, static example
 * of the dashboard (the same band headers the app uses, so the palette
 * carries through). It is captioned as an example and is inert: hidden
 * from assistive tech, no pointer events, no hover, no check buttons.
 * One band of three rows plus a Horizon strip shows the three-band idea
 * without reading as a to-do list. On phone it sits below the buttons; on
 * desktop beside the pitch.
 */
const SAMPLE_ROWS = [
  { name: 'Descale the kettle', meta: 'Every month', due: 'today' },
  { name: 'Clean the gutters', meta: 'Every 6 months', due: 'tomorrow' },
  { name: 'Test the smoke alarms', meta: 'Every 3 months', due: 'in 4 days' },
] as const;

/** Tasks per month for the example Horizon, starting next month. */
const SAMPLE_HORIZON: readonly number[] = [2, 0, 1, 3, 0, 1];

const DENSITY_FILL: Record<number, string> = {
  0: '',
  1: 'bg-status-soon/8 bold:bg-density-1 bold:border-transparent',
  2: 'bg-status-soon/18 bold:bg-density-2 bold:border-transparent',
  3: 'bg-status-soon/32 bold:bg-density-3 bold:border-transparent bold:[&_span]:text-on-density-3',
};

function sampleMonths(now: Date): string[] {
  const fmt = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' });
  return SAMPLE_HORIZON.map((_, i) =>
    fmt.format(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1 + i, 1))),
  );
}

export default async function LandingPage() {
  const pb = await createServerClient();
  if (pb.authStore.isValid) {
    redirect('/h');
  }
  const months = sampleMonths(new Date());

  return (
    <main className="relative mx-auto grid min-h-screen w-full max-w-5xl content-center gap-y-10 px-6 py-12 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] lg:gap-x-16 lg:gap-y-6">
      <AppearanceMenu />
      <div className="flex flex-col gap-6 lg:self-end">
        <h1 className="font-display text-[44px] leading-none font-medium tracking-tight bold:font-bold lg:text-[56px]">
          HomeKeep
        </h1>
        <p className="text-[15px] leading-[26px] text-foreground/85 sm:text-[17px] sm:leading-7">
          Every recurring job in your home, from gutters to smoke alarms, on
          one shared list. See what slipped, what&apos;s due this week, and
          the year ahead.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/signup">Create an account</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/login">Log in</Link>
          </Button>
        </div>
      </div>

      <div className="flex w-full max-w-md flex-col gap-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center">
        <div>
          <p className="text-[15px] leading-6 font-medium">What your home looks like</p>
          <p className="text-[13px] leading-5 text-muted-foreground">
            An example. Your own list appears after you sign in.
          </p>
        </div>
        {/* An example of the dashboard, for looking at only. */}
        <div
          aria-hidden="true"
          className="pointer-events-none flex flex-col gap-5 opacity-90 select-none"
        >
          <section className={BAND_STACK}>
            <BandHeader label="This week" count={SAMPLE_ROWS.length} variant="thisWeek" as="h2" />
            <ul className={clsx(BAND_SURFACE, 'divide-y divide-hairline')}>
              {SAMPLE_ROWS.map((r) => (
                <li key={r.name} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-5 font-medium">{r.name}</p>
                    <p className="text-xs leading-5 text-muted-foreground">{r.meta}</p>
                  </div>
                  <span className="text-xs font-medium tabular-nums text-status-soon-deep">
                    {r.due}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className={BAND_STACK}>
            <BandHeader
              label="Horizon"
              count={SAMPLE_HORIZON.reduce((a, b) => a + b, 0)}
              variant="horizon"
              as="h2"
            />
            <div className={clsx(BAND_SURFACE, 'p-3')}>
              <div className="grid grid-cols-6 gap-1.5">
                {SAMPLE_HORIZON.map((count, i) => (
                  <div
                    key={months[i]}
                    className={clsx(
                      'flex min-h-10 flex-col justify-between rounded-md border border-hairline px-1.5 py-1',
                      DENSITY_FILL[count],
                    )}
                  >
                    <span
                      className={clsx(
                        'text-[11px] leading-none font-medium',
                        count > 0 ? 'text-foreground/80' : 'text-muted-foreground/70',
                      )}
                    >
                      {months[i]}
                    </span>
                    {count > 0 && (
                      <span className="self-end text-xs leading-none font-semibold tabular-nums text-foreground">
                        {count}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>

      <p className="text-[13px] leading-5 text-muted-foreground lg:col-start-1 lg:row-start-2 lg:self-start">
        Self-hosted and AGPL-3.0-or-later, with no telemetry. The source is
        at{' '}
        <a
          href="https://github.com/the-kizz/homekeep"
          className="text-link underline-offset-2 hover:underline bold-link"
        >
          github.com/the-kizz/homekeep
        </a>
        .
      </p>
    </main>
  );
}
