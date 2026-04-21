import Link from 'next/link';
import * as LucideIcons from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * AreaCard — By Area view grid tile (05-02 Task 1, D-04 + D-21, AREA-V-01/02/03).
 *
 * Presentational. Props carry everything needed so the server page can
 * compute counts + coverage once and pass them inline — no data fetching
 * inside the card.
 *
 * Layout:
 *   - Left accent border at area.color via inline `style` (Tailwind cannot
 *     take a dynamic hex at build time; 4px via `border-l-4`).
 *   - Header row: icon + name + optional "Whole Home" pill.
 *   - Counts row: overdue · this week · upcoming. Overdue uses warm-accent
 *     `text-primary` when > 0 (SPEC §19 — warm, not panic-red).
 *   - Coverage row: small flat bar + percentage. Reusing the big
 *     CoverageRing would dominate the card; a flat inline bar keeps the
 *     grid scannable.
 *   - Entire card wrapped in <Link> to `/h/[homeId]/areas/[areaId]` per
 *     D-06 (reuses the existing Phase 2 area detail route).
 *
 * Icon resolution: `area.icon` is stored as kebab-case per Phase 2
 * AreaIcon enum. Convert to PascalCase and look up on lucide-react; fall
 * back to `Home` if missing (defense for legacy data or icons dropped
 * from lucide between versions).
 *
 * Data attributes for Phase 5 E2E (Suite B):
 *   data-area-card, data-area-id, data-area-name, data-coverage,
 *   data-overdue-count, data-this-week-count, data-upcoming-count,
 *   data-is-whole-home.
 */
export function AreaCard({
  area,
  coverage,
  counts,
  homeId,
}: {
  area: {
    id: string;
    name: string;
    icon: string;
    color: string;
    is_whole_home_system: boolean;
  };
  coverage: number;
  counts: { overdue: number; thisWeek: number; upcoming: number };
  homeId: string;
}) {
  const coveragePct = Math.max(0, Math.min(100, Math.round(coverage * 100)));
  const pascalIcon = toPascalCase(area.icon);
  const LucideMap = LucideIcons as unknown as Record<
    string,
    React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }> | undefined
  >;
  const Icon = LucideMap[pascalIcon] ?? LucideIcons.Home;

  // Accent hex: prefer area.color; fall back to the warm primary token
  // if it's absent or empty (edge case for legacy rows pre-palette
  // enforcement). The fallback matches the #D4A574 accent so the card
  // still reads as warm rather than defaulting to a cool border.
  const accent =
    typeof area.color === 'string' && area.color.length > 0
      ? area.color
      : '#D4A574';

  return (
    <Link
      href={`/h/${homeId}/areas/${area.id}`}
      data-area-card
      data-area-id={area.id}
      data-area-name={area.name}
      data-coverage={coveragePct}
      data-overdue-count={counts.overdue}
      data-this-week-count={counts.thisWeek}
      data-upcoming-count={counts.upcoming}
      data-is-whole-home={area.is_whole_home_system ? 'true' : 'false'}
      className="block transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
    >
      <Card
        className="border-l-4"
        style={{ borderLeftColor: accent }}
      >
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Icon className="size-5 shrink-0" aria-hidden={true} />
              <span className="font-medium truncate">{area.name}</span>
            </div>
          </div>

          {/* Counter row: each counter is whitespace-nowrap so the label
              never splits mid-phrase ("1 this\nweek"). On narrow cards the
              row stacks vertically (flex-col), expanding to a single
              horizontal row once >= sm. */}
          <div className="flex flex-col gap-1 text-xs sm:flex-row sm:items-center sm:gap-2">
            <span
              className={cn(
                'whitespace-nowrap tabular-nums',
                counts.overdue > 0 ? 'text-primary font-medium' : 'text-muted-foreground',
              )}
            >
              {counts.overdue} overdue
            </span>
            <span className="hidden text-muted-foreground sm:inline">·</span>
            <span
              className={cn(
                'whitespace-nowrap tabular-nums',
                counts.thisWeek > 0 ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {counts.thisWeek} this week
            </span>
            <span className="hidden text-muted-foreground sm:inline">·</span>
            <span className="whitespace-nowrap tabular-nums text-muted-foreground">
              {counts.upcoming} upcoming
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div
              className="h-1.5 flex-1 rounded-full bg-muted"
              role="img"
              aria-label={`Coverage ${coveragePct}%`}
            >
              {/* Fill tint is driven from the same accent as the left
                  border so each card reads as a unified color block.
                  We use the hex directly (Tailwind can't compute a
                  dynamic hex) at full opacity — the surrounding bg-muted
                  track gives enough contrast without needing alpha. */}
              <div
                className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500"
                style={{
                  width: `${coveragePct}%`,
                  backgroundColor: accent,
                }}
              />
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">
              {coveragePct}%
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

/**
 * Convert kebab-case icon name to PascalCase for lucide-react lookup.
 * e.g. 'utensils-crossed' -> 'UtensilsCrossed', 'home' -> 'Home'.
 */
function toPascalCase(kebab: string): string {
  return kebab
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}
