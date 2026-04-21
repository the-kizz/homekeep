import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Geist } from 'next/font/google';
import { cn } from '@/lib/utils';
import { Toaster } from '@/components/ui/sonner';

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'HomeKeep',
  description: 'Household maintenance, visible and evenly distributed.',
  // 07-01 (D-01, D-03): PWA manifest + iOS install affordance.
  // Next 16 emits `<link rel="manifest" href="/manifest.webmanifest">`
  // for the manifest field and `<link rel="apple-touch-icon">` for
  // icons.apple. The apple entry MUST be the 192px icon per D-03 —
  // iOS ignores the manifest icons[] for home-screen installs and
  // reads the apple-touch-icon link instead.
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/icon-192.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'HomeKeep',
  },
};

// 07-01 (D-01, D-03): Next 16 moved themeColor out of `metadata` and
// into a dedicated `viewport` export. Emits
// `<meta name="theme-color" content="#D4A574">` — browsers colour the
// address bar + PWA splash screen chrome with this value.
export const viewport: Viewport = {
  themeColor: '#D4A574',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn('font-sans', geist.variable)}>
      <body className="min-h-screen antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
