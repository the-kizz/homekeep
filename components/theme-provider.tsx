'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';

/**
 * App-wide theme provider. `class` strategy so the `.dark` token block in
 * globals.css applies; defaults to the OS preference so nobody is
 * surprised by a theme they never chose. Transitions are suppressed on
 * switch so every surface flips at once instead of fading unevenly.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
