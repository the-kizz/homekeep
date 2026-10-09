
/**
 * PersonalStats — Person view stats tiles (05-02 Task 2, D-07, PERS-03).
 *
 * Pure presentational: takes three pre-computed numbers and renders
 * three stat cards. Server Component owns the math (weekly/monthly
 * filters on `completions`, `computePersonalStreak` from 05-01).
 *
 * Copy policy (CONTEXT §specifics): when streak is 0, show a warm
 * "New week. Let's go!" message instead of a literal "0-week streak"
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
      className="grid grid-cols-3 items-stretch divide-x divide-hairline overflow-hidden rounded-xl border border-hairline bg-surface-2"
    >
      <div data-weekly-count={weekly} className="h-full">
        <div className="flex min-h-[96px] flex-col items-center justify-center gap-1 px-2 py-4 text-center">
          <span className="font-display text-3xl font-medium tabular-nums">{weekly}</span>
          <span className="section-label">
            this week
          </span>
        </div>
      </div>
      <div data-monthly-count={monthly} className="h-full">
        <div className="flex min-h-[96px] flex-col items-center justify-center gap-1 px-2 py-4 text-center">
          <span className="font-display text-3xl font-medium tabular-nums">{monthly}</span>
          <span className="section-label">
            this month
          </span>
        </div>
      </div>
      <div data-streak-count={streak} className="h-full">
        <div className="flex min-h-[96px] flex-col items-center justify-center gap-1 px-2 py-4 text-center">
          {streak > 0 ? (
            <>
              <span className="font-display text-3xl font-medium tabular-nums">
                {streak}
              </span>
              <span className="section-label">
                week streak
              </span>
            </>
          ) : (
            <>
              <span className="text-sm font-medium leading-snug">
                New week. Let&apos;s go!
              </span>
              <span className="text-xs leading-tight text-muted-foreground">
                Your streak starts with the next task you finish.
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
