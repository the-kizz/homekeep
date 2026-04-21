'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, LayoutGrid, User, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * BottomNav — mobile-first primary navigation bar (05-01 Task 3, D-16 + D-20).
 *
 * 4 destinations in the user-visible order from SPEC §8:
 *   Home (three-band dashboard) / By Area / Person / History
 *
 * - Fixed to the bottom of the viewport, safe-area-inset-bottom padding
 *   so iOS home-indicator doesn't overlap labels (D-20).
 * - `md:hidden` removes it on wider screens where `TopTabs` takes over.
 * - Active segment is derived from `usePathname()` — the matcher is
 *   prefix-based for nested routes (e.g. `/by-area/kitchen` activates
 *   "By Area"). The dashboard's "Home" match is strict-equals because a
 *   prefix match would also fire on /by-area, /person, /history.
 * - `data-bottom-nav` + `data-nav-item` are load-bearing for E2E suites
 *   added in 05-02 / 05-03 — do NOT rename without updating playwright.
 *
 * NOTE: also active on /areas/* — the Phase 2 /h/[id]/areas pages live
 * under the "By Area" conceptual umbrella; activating the tab keeps the
 * mental model consistent even though the URL predates Phase 5.
 */

type NavItem = {
  href: string;
  icon: typeof Home;
  label: string;
  dataKey: string;
  match: (pathname: string) => boolean;
};

function buildItems(homeId: string): NavItem[] {
  const root = `/h/${homeId}`;
  return [
    {
      href: root,
      icon: Home,
      label: 'Home',
      dataKey: 'home',
      match: (p) => p === root,
    },
    {
      href: `${root}/by-area`,
      icon: LayoutGrid,
      label: 'By Area',
      dataKey: 'by-area',
      match: (p) =>
        p.startsWith(`${root}/by-area`) || p.startsWith(`${root}/areas`),
    },
    {
      href: `${root}/person`,
      icon: User,
      label: 'Person',
      dataKey: 'person',
      match: (p) => p.startsWith(`${root}/person`),
    },
    {
      href: `${root}/history`,
      icon: Clock,
      label: 'History',
      dataKey: 'history',
      match: (p) => p.startsWith(`${root}/history`),
    },
  ];
}

export function BottomNav({ homeId }: { homeId: string }) {
  const pathname = usePathname() ?? '';
  const items = buildItems(homeId);

  // 05-03: hide the nav chrome on /onboarding. Every nav link points at
  // /h/[id] or a tab under it, and the dashboard now redirects back to
  // /onboarding while onboarded=false — without this guard the user would
  // be trapped in a Home-tap → dashboard → /onboarding loop. The "Skip
  // all" escape hatch lives inside the wizard itself (D-13).
  if (pathname.endsWith('/onboarding')) return null;

  return (
    <nav
      aria-label="Primary"
      data-bottom-nav
      className="fixed inset-x-0 bottom-0 z-40 flex h-14 items-center justify-around border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {items.map(({ href, icon: Icon, label, dataKey, match }) => {
        const active = match(pathname);
        return (
          <Link
            key={href}
            href={href}
            data-nav-item={dataKey}
            aria-current={active ? 'page' : undefined}
            aria-label={label}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'text-primary border-t-2 border-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-5" aria-hidden="true" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
