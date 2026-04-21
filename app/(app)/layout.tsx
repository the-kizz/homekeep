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

  const record = pb.authStore.record;
  const userName =
    typeof record?.name === 'string' && record.name.length > 0
      ? record.name
      : undefined;
  const userId = record?.id as string;

  const lastViewedRaw = record?.last_viewed_home_id;
  const currentHomeId =
    typeof lastViewedRaw === 'string' && lastViewedRaw.length > 0
      ? lastViewedRaw
      : null;

  // SAFE filter — userId is from the trusted authStore, not client input
  // (RESEARCH §Security Domain line 1766). Future user-input filters must
  // use pb.filter(). Cast to HomeEntry-compatible shape for the client.
  const homesRaw = await pb.collection('homes').getFullList({
    filter: `owner_id = "${userId}"`,
    sort: 'name',
    fields: 'id,name',
  });
  const homes = homesRaw.map((h) => ({
    id: h.id,
    name: (h.name as string) ?? '',
  }));

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between gap-3 border-b p-3">
        <div className="flex items-center gap-3">
          <Link href="/h" className="font-semibold">
            HomeKeep
          </Link>
          <HomeSwitcher homes={homes} currentHomeId={currentHomeId} />
        </div>
        <AccountMenu userName={userName} />
      </header>
      <main>{children}</main>
    </div>
  );
}
