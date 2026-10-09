import { AppearanceMenu } from '@/components/appearance-menu';

/**
 * Public pages (login, signup, reset-password, invite) share one wrapper
 * so the Appearance control sits in the same corner on each of them.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      <AppearanceMenu />
      {children}
    </div>
  );
}
