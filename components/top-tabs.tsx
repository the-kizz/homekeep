'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, LayoutGrid, User, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * TopTabs — desktop/tablet primary navigation (05-01 Task 3, D-17).
 *
 * Renders 4 tabs identical to BottomNav's destinations. Shown only at
 * `md:` breakpoint and up (hidden on mobile where BottomNav takes over).
 *
 * Implementation note: shadcn's Tabs primitive (components/ui/tabs.tsx) is
 * optimised for state-driven content swapping — we need route-driven
 * active state + <Link> semantics for accessibility and prefetch. A plain
 * horizontal row of styled <Link>s matches the shadcn look (`border-b-2
 * border-primary` on active), preserves full-link semantics (Cmd-click to
 * open a tab still works), and avoids the radix state machine that would
 * fight the router.
 *
 * The match logic is identical to BottomNav to guarantee visual
 * consistency between breakpoints.
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

export function TopTabs({ homeId }: { homeId: string }) {
  const pathname = usePathname() ?? '';
  const items = buildItems(homeId);

  return (
    <nav
      aria-label="Primary"
      data-top-tabs
      className="hidden md:flex sticky top-0 z-30 border-b bg-background/95 backdrop-blur"
    >
      <div className="mx-auto flex w-full max-w-4xl items-center gap-1 px-6">
        {items.map(({ href, icon: Icon, label, dataKey, match }) => {
          const active = match(pathname);
          return (
            <Link
              key={href}
              href={href}
              data-nav-item={dataKey}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
