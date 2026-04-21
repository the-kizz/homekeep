import { Flame } from 'lucide-react';

/**
 * HouseholdStreakBadge (06-03 Task 2, D-11, D-16, GAME-01).
 *
 * Pure presentational badge for the dashboard header. Reads a
 * pre-computed streak number from the Server Component (see
 * app/(app)/h/[homeId]/page.tsx + lib/household-streak.ts).
 *
 * Copy matrix (warm policy, mirrors PersonalStats):
 *   - streak === 0 → "Fresh week"  (calm, no shame)
 *   - streak === 1 → "1-week streak"
 *   - streak >= 2  → "{N}-week streak"
 *
 * CONTEXT §specifics calls out "not yellow-trophy loud" — we use the
 * warm primary token (same palette as CoverageRing) rather than any
 * saturated yellow. The Flame icon is aria-hidden so the visible
 * copy owns the label.
 */
export function HouseholdStreakBadge({ streak }: { streak: number }) {
  const copy =
    streak === 0
      ? 'Fresh week'
      : streak === 1
        ? '1-week streak'
        : `${streak}-week streak`;

  return (
    <span
      data-household-streak-badge
      data-streak-count={streak}
      className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
    >
      <Flame className="size-3.5" aria-hidden="true" />
      <span>{copy}</span>
    </span>
  );
}
