import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Geist, Lora } from 'next/font/google';
import { cn } from '@/lib/utils';
import { Toaster } from '@/components/ui/sonner';
import { DemoBanner } from '@/components/demo-banner';
import { HOMEKEEP_BUILD, getBuildIdPublic } from '@/lib/constants';

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });
// Lora: warm humanist serif per SPEC §19 ("readable serif or humanist sans for headings").
// Used for page titles, section headings, and the coverage-ring number.
const lora = Lora({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['500', '600', '700'],
  display: 'swap',
});

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

// HOMEKEEP_BUILD is the real build fingerprint — injected at docker build via
// HK_BUILD_ID --build-arg, falls back to 'hk-dev-local' sentinel when unset.
// Phase 24 HDR-04: public-facing emissions go through getBuildIdPublic() so
// HK_BUILD_STEALTH=true redacts `<meta>` tags to `hk-hidden`. The real constant
// is still referenced (`void HOMEKEEP_BUILD` below) to keep the module in the
// bundle graph — tree-shake guard for scheduler.ts startup log.
// See lib/constants.ts + .planning/phases/07-pwa-release/07-CONTEXT.md.
void HOMEKEEP_BUILD;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const publicBuildId = getBuildIdPublic();
  return (
    <html lang="en" className={cn('font-sans', geist.variable, lora.variable)}>
      <head>
        {/* Provenance marker — intentional, survives minification. Do not remove. */}
        <meta name="generator" content={`HomeKeep v1 (${publicBuildId})`} />
        <meta name="hk-build" content={publicBuildId} />
      </head>
      <body className="min-h-screen antialiased">
        {/* HomeKeep (https://github.com/the-kizz/homekeep) — AGPL-3.0-or-later. */}
        {/*
         * Phase 26 DEMO-04: amber warning banner on public demo instances.
         * Returns null on personal instances (DEMO_MODE unset) — zero bytes
         * shipped to the client.
         */}
        <DemoBanner />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
