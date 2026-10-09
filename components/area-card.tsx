import Link from 'next/link';
import * as LucideIcons from 'lucide-react';
import { cn } from '@/lib/utils';
import { areaColor } from '@/lib/area-palette';

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
 *   - Header row: icon + name. (Previous iterations had a "Whole Home"
 *     pill on `is_whole_home_system` rows; dropped in Phase 9 as the
 *     card title already carries that label — the pill was redundant.)
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
  const accent = areaColor(area.color);

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
      className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <div className="flex flex-col gap-3 rounded-xl border border-hairline bg-surface-2 p-4 motion-safe:transition-colors motion-safe:duration-150 group-hover:border-foreground/20">
        <div className="flex items-center gap-3 min-w-0">
          {/* Icon disc in the area colour (a runtime value, passed as the
              --area custom property): a 15% tint in Notebook, a solid
              disc in Bold. */}
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--area)_15%,transparent)] text-(--area) bold:bg-(--area) bold:text-on-status"
            style={{ '--area': accent } as React.CSSProperties}
          >
            <Icon className="size-5" aria-hidden={true} />
          </span>
          <span className="truncate font-display text-lg font-medium tracking-tight text-foreground">
            {area.name}
          </span>
        </div>

        {/* "3 overdue, 2 this week, 2 upcoming": each number in its
            status colour; zeroes stay quiet. */}
        <p className="text-[13px] leading-5 text-muted-foreground">
          <span className="whitespace-nowrap">
            <span
              className={cn(
                'tabular-nums',
                counts.overdue > 0 && 'font-semibold text-status-overdue',
              )}
            >
              {counts.overdue}
            </span>{' '}
            overdue,
          </span>{' '}
          <span className="whitespace-nowrap">
            <span
              className={cn(
                'tabular-nums',
                counts.thisWeek > 0 && 'font-semibold text-status-soon-deep',
              )}
            >
              {counts.thisWeek}
            </span>{' '}
            this week,
          </span>{' '}
          <span className="whitespace-nowrap">
            <span
              className={cn(
                'tabular-nums font-medium text-foreground/80',
                counts.upcoming > 0 && 'bold:font-semibold bold:text-status-upcoming',
              )}
            >
              {counts.upcoming}
            </span>{' '}
            upcoming
          </span>
        </p>

        <div className="flex items-center gap-3">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={`Coverage ${coveragePct}%`}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${coveragePct}%`,
                backgroundColor: accent,
              }}
            />
          </div>
          <span className="w-9 text-right text-[13px] font-medium tabular-nums text-foreground/80">
            {coveragePct}%
          </span>
        </div>
      </div>
    </Link>
  );
}

function toPascalCase(kebab: string): string {
  return kebab
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}
