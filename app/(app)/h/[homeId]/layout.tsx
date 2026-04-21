import { NavShell } from '@/components/nav-shell';

/**
 * Per-home segment layout (05-01 Task 3).
 *
 * Wraps every page under /h/[homeId]/* — dashboard, areas, tasks,
 * members, settings, leave — plus the Wave-2/3 additions (by-area,
 * person, history, onboarding) — in the primary NavShell chrome.
 *
 * Scope: placing the layout at this segment (rather than higher at
 * app/(app)/layout.tsx) ensures it does NOT leak onto /h (homes list),
 * /h/new (create-home form), /login, /signup, or /invite/[token].
 *
 * Next 16 async params contract: `params: Promise<{ homeId }>`. The
 * layout awaits once to extract the id and hands it to NavShell; the
 * NavShell's client sub-components read the id from props, not from
 * `useParams()`, so there's a single server-trusted source of truth.
 */
export default async function HomeSegmentLayout({
  params,
  children,
}: {
  params: Promise<{ homeId: string }>;
  children: React.ReactNode;
}) {
  const { homeId } = await params;
  return <NavShell homeId={homeId}>{children}</NavShell>;
}
