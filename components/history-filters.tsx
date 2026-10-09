'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback, useTransition } from 'react';
import { cn } from '@/lib/utils';
import type { HistoryRange } from '@/lib/history-filter';

/**
 * HistoryFilters — URL-param-backed filter bar for the History view
 * (05-02 Task 3, D-10, HIST-02).
 *
 * Writes to the current path's `?person=` / `?area=` / `?range=` query
 * params via `router.push()`. Reading in a Server Component side
 * (history/page.tsx) via `searchParams` drives the `filterCompletions`
 * predicate — no client-side list shrinking, which means server-rendered
 * data stays authoritative and deep-links round-trip.
 *
 * Default cleanliness: empty person / area / range-of-'month' strip from
 * the URL so reset-to-default produces a clean `/history` URL.
 *
 * T-05-02-03 mitigation: the server-side page validates range via an
 * `includes(...) ? sp.range : 'month'` gate before passing to
 * filterCompletions; this client only WRITES the four canonical range
 * values and never accepts raw text input — nothing flows through to PB
 * filters.
 */

const RANGE_OPTIONS: Array<{ value: HistoryRange; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'all', label: 'All' },
];

export function HistoryFilters({
  members,
  areas,
  initial,
}: {
  members: Array<{ id: string; name: string }>;
  areas: Array<{ id: string; name: string }>;
  initial: { personId: string | null; areaId: string | null; range: HistoryRange };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const pushWith = useCallback(
    (patch: { person?: string; area?: string; range?: HistoryRange }) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '');

      // Normalize each control. Empty value → remove from URL.
      if ('person' in patch) {
        if (patch.person && patch.person.length > 0)
          params.set('person', patch.person);
        else params.delete('person');
      }
      if ('area' in patch) {
        if (patch.area && patch.area.length > 0) params.set('area', patch.area);
        else params.delete('area');
      }
      if ('range' in patch) {
        // Month is the default; don't persist it. Other values keep URL explicit.
        if (patch.range && patch.range !== 'month')
          params.set('range', patch.range);
        else params.delete('range');
      }

      const qs = params.toString();
      const target = qs.length > 0 ? `${pathname}?${qs}` : pathname;
      startTransition(() => {
        router.push(target);
      });
    },
    [pathname, router, searchParams],
  );

  return (
    <div
      data-history-filters
      aria-busy={isPending || undefined}
      className="flex flex-wrap items-end gap-3 rounded border p-3"
    >
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Person</span>
        <select
          data-filter-person
          defaultValue={initial.personId ?? ''}
          onChange={(e) => pushWith({ person: e.target.value })}
          className="min-w-[8rem] rounded border bg-background px-2 py-1 text-sm"
        >
          <option value="">Anyone</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Area</span>
        <select
          data-filter-area
          defaultValue={initial.areaId ?? ''}
          onChange={(e) => pushWith({ area: e.target.value })}
          className="min-w-[10rem] rounded border bg-background px-2 py-1 text-sm"
        >
          <option value="">All areas</option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>

      <div
        className="flex flex-col gap-1 text-xs"
        data-filter-range-group
      >
        <span className="text-muted-foreground">Range</span>
        {/* Phase 9 UX audit: equal-width segmented control. grid-cols-4
            gives every pill the exact same width so switching active
            doesn't nudge its neighbours. min-w-[4rem] floors the cell
            in case the grid ever lives inside an extra-narrow parent.
            Divide-x draws a single internal separator line per shadcn's
            usual segmented style. */}
        <div
          role="group"
          aria-label="Time range"
          className="grid w-fit grid-cols-4 divide-x overflow-hidden rounded border"
        >
          {RANGE_OPTIONS.map((opt) => {
            const active = initial.range === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                data-filter-range={opt.value}
                aria-pressed={active}
                onClick={() => pushWith({ range: opt.value })}
                className={cn(
                  'min-w-[4rem] px-3 py-1 text-center text-sm transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground hover:text-foreground',
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
