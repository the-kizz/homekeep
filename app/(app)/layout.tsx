import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/pocketbase-server';
import { AccountMenu } from '@/components/account-menu';
import { HomeSwitcher } from '@/components/home-switcher';

/**
 * Protected layout for the `(app)` route group (02-03 + 02-04).
 *
 * Defense-in-depth after proxy.ts: if the cookie somehow reaches here
 * without a valid authStore (e.g. cookie present but the encoded JSON is
 * malformed), we redirect at the Server Component level before any page
 * render.
 *
 * Fetches three things server-side and passes them down as props:
 *   - userName       → AccountMenu display
 *   - homes[]        → HomeSwitcher list (02-04)
 *   - currentHomeId  → HomeSwitcher selected row (users.last_viewed_home_id)
 *
 * The HttpOnly pb_auth cookie can't be read in the browser (RESEARCH
 * Pitfall 5) — that's why every per-request read happens in Server
 * Components and props flow down.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pb = await createServerClient();
  if (!pb.authStore.isValid) {
    redirect('/login');
  }

  const cookieRecord = pb.authStore.record;
  const userId = cookieRecord?.id as string;

  // pb.authStore.record reflects the cookie snapshot from login/signup —
  // it does NOT auto-refresh when the server later updates users.*
  // (e.g. last_viewed_home_id on switchHome). Fetch a fresh user record
  // so the HomeSwitcher's "current" indicator and the /h last-viewed
  // redirect both see the latest value. One extra DB read per (app)
  // request is a fair cost for correctness.
  let freshRecord = cookieRecord;
  try {
    freshRecord = await pb.collection('users').getOne(userId, {
      fields: 'id,name,last_viewed_home_id',
    });
  } catch {
    // Fall through to the cookie snapshot if the fresh read fails.
  }

  const userName =
    typeof freshRecord?.name === 'string' && freshRecord.name.length > 0
      ? freshRecord.name
      : undefined;

  const lastViewedRaw = freshRecord?.last_viewed_home_id;
  const currentHomeId =
    typeof lastViewedRaw === 'string' && lastViewedRaw.length > 0
      ? lastViewedRaw
      : null;

  // 04-03 RESEARCH Pattern 11: swap the Phase 2 homes-by-owner query for
  // a home_members-by-user query + expand. Same SAFE userId (authStore-
  // derived, not client input). Returns homes the user is a member of,
  // regardless of ownership role. Owner badge is derived from r.role.
  const membershipRows = await pb.collection('home_members').getFullList({
    filter: pb.filter('user_id = {:uid}', { uid: userId }),
    sort: 'home_id.name',
    fields:
      'id,role,home_id,expand.home_id.id,expand.home_id.name,expand.home_id.owner_id',
    expand: 'home_id',
  });
  type HomeEntry = {
    id: string;
    name: string;
    role: 'owner' | 'member';
  };
  const homes: HomeEntry[] = membershipRows
    .map((r) => {
      const home = (
        r.expand as Record<string, { id?: string; name?: string }> | undefined
      )?.home_id;
      if (!home?.id) return null;
      return {
        id: home.id,
        name: (home.name as string) ?? '',
        role: r.role as 'owner' | 'member',
      };
    })
    .filter((h): h is HomeEntry => h !== null);

  // Owned home ids drive the AccountMenu's conditional Leave Home item.
  // The client derives the current homeId from usePathname().
  const ownedHomeIds = homes
    .filter((h) => h.role === 'owner')
    .map((h) => h.id);

  return (
    <div className="min-h-screen">
      {/* Mobile nav density (Phase 9 UX audit): on small screens the
          in-page h1 already identifies the home, so we hide the
          wordmark + switcher in the top bar and leave only the
          AccountMenu. Desktop keeps the full "HomeKeep [switcher]
          … AccountMenu" header for quick navigation. */}
      <header className="flex items-center justify-between gap-3 border-b p-3">
        <div className="flex items-center gap-3">
          <Link href="/h" className="hidden font-semibold sm:inline">
            HomeKeep
          </Link>
          <div className="hidden sm:block">
            <HomeSwitcher homes={homes} currentHomeId={currentHomeId} />
          </div>
        </div>
        <AccountMenu userName={userName} ownedHomeIds={ownedHomeIds} />
      </header>
      <main>{children}</main>
    </div>
  );
}
