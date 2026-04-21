import { BottomNav } from './bottom-nav';
import { TopTabs } from './top-tabs';

/**
 * NavShell — wraps every page under /h/[homeId]/* with the primary nav
 * chrome (05-01 Task 3).
 *
 * Composition:
 *   - `TopTabs` above children — `hidden md:flex`, so mobile sees nothing.
 *   - `BottomNav` absolute-positioned below — `md:hidden`, so desktop
 *     sees only the top tabs. Mobile adds bottom padding to the content
 *     wrapper so the last item isn't hidden under the fixed nav (56px
 *     nav + safe-area-inset).
 *
 * Both child components are client-side because they consume
 * `usePathname()`. NavShell itself stays a Server Component so that the
 * server-rendered /h/[homeId]/layout.tsx can pass it through without a
 * "use client" boundary leak.
 *
 * Scope note (T-05-01-05): NavShell is intentionally ALSO rendered on
 * `/h/[homeId]/onboarding` (Phase 5 wizard). Per D-13 the wizard needs a
 * "Skip all" escape hatch — keeping the nav visible provides that via the
 * Home tab. If onboarding is made a true fullscreen takeover later, move
 * the layout one segment deeper (e.g. /h/[homeId]/(framed)/layout.tsx)
 * rather than branching on pathname here.
 */
export function NavShell({
  homeId,
  children,
}: {
  homeId: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <TopTabs homeId={homeId} />
      {/* pb-20 keeps the last ~5 lines of content above the mobile bottom
       * nav (56px nav + 24px margin). md:pb-6 restores normal spacing
       * where the bottom nav is hidden. */}
      <div className="pb-20 md:pb-6">{children}</div>
      <BottomNav homeId={homeId} />
    </>
  );
}
