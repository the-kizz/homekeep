import {
  Card,
  CardContent,
} from '@/components/ui/card';

/**
 * PersonalStats — Person view stats tiles (05-02 Task 2, D-07, PERS-03).
 *
 * Pure presentational: takes three pre-computed numbers and renders
 * three stat cards. Server Component owns the math (weekly/monthly
 * filters on `completions`, `computePersonalStreak` from 05-01).
 *
 * Copy policy (CONTEXT §specifics): when streak is 0, show a warm
 * "New week — let's go!" message instead of a literal "0-week streak"
 * which reads as failure. Weekly/monthly still show literal counts
 * including zero — those are neutral activity totals.
 *
 * Data attributes for Phase 5 E2E (Suite C):
 *   data-personal-stats, data-weekly-count, data-monthly-count,
 *   data-streak-count.
 */
export function PersonalStats({
  weekly,
  monthly,
  streak,
}: {
  weekly: number;
  monthly: number;
  streak: number;
}) {
  return (
    // Phase 9 UX audit: equalize card heights so the streak card's
    // longer zero-state copy ("New week — let's go!" + subline) doesn't
    // make that tile tower over the two numeric tiles. `items-stretch`
    // on the grid + `h-full` on the Card + `min-h-[120px]` on the
    // CardContent gives every card the same visual weight regardless
    // of content length. Body copy in the zero-state also downshifts
    // to text-sm leading-snug so it wraps cleanly inside the fixed
    // height instead of pushing the card taller.
    <div
      data-personal-stats
      className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-3"
    >
      <Card data-weekly-count={weekly} className="h-full">
        <CardContent className="flex min-h-[120px] flex-col items-center justify-center gap-1 py-4 text-center">
          <span className="text-3xl font-semibold tabular-nums">{weekly}</span>
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            this week
          </span>
        </CardContent>
      </Card>
      <Card data-monthly-count={monthly} className="h-full">
        <CardContent className="flex min-h-[120px] flex-col items-center justify-center gap-1 py-4 text-center">
          <span className="text-3xl font-semibold tabular-nums">{monthly}</span>
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            this month
          </span>
        </CardContent>
      </Card>
      <Card data-streak-count={streak} className="h-full">
        <CardContent className="flex min-h-[120px] flex-col items-center justify-center gap-1 py-4 text-center">
          {streak > 0 ? (
            <>
              <span className="text-3xl font-semibold tabular-nums">
                {streak}
              </span>
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {streak === 1 ? 'week streak' : 'weeks streak'}
              </span>
            </>
          ) : (
            <>
              <span className="text-sm font-medium leading-snug">
                New week — let&apos;s go!
              </span>
              <span className="text-[10px] uppercase leading-tight tracking-wide text-muted-foreground">
                streak starts on your next completion
              </span>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
