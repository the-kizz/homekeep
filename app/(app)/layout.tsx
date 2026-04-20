import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/pocketbase-server';
import { AccountMenu } from '@/components/account-menu';

/**
 * Protected layout for the `(app)` route group. Defense-in-depth after
 * proxy.ts — if the cookie somehow reaches here without a valid authStore
 * (e.g. cookie present but the encoded JSON is malformed), we redirect at
 * the Server Component level before any page render.
 *
 * Fetches the authed user's `name` server-side (the browser cannot read
 * the HttpOnly cookie, per RESEARCH Pitfall 5) and passes it down to the
 * AccountMenu for display.
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

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b p-3">
        <Link href="/h" className="font-semibold">
          HomeKeep
        </Link>
        <AccountMenu userName={userName} />
      </header>
      <main>{children}</main>
    </div>
  );
}
