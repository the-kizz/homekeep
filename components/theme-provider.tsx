'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';
import {
  DEFAULT_PALETTE,
  PALETTE_COOKIE,
  PALETTE_COOKIE_MAX_AGE,
  PALETTE_STORAGE_KEY,
  isPalette,
  type Palette,
} from '@/lib/palette';

type PaletteContextValue = {
  palette: Palette;
  setPalette: (next: Palette) => void;
};

const PaletteContext = createContext<PaletteContextValue>({
  palette: DEFAULT_PALETTE,
  setPalette: () => {},
});

export function usePalette(): PaletteContextValue {
  return useContext(PaletteContext);
}

function readStoredPalette(): Palette | null {
  try {
    const v = window.localStorage.getItem(PALETTE_STORAGE_KEY);
    return isPalette(v) ? v : null;
  } catch {
    return null;
  }
}

function hasPaletteCookie(): boolean {
  try {
    return document.cookie
      .split(';')
      .some((c) => c.trim().startsWith(`${PALETTE_COOKIE}=`));
  } catch {
    return false;
  }
}

/** Mirror a palette choice to <html>, localStorage and the cookie. */
function persistPalette(next: Palette): void {
  document.documentElement.setAttribute('data-palette', next);
  try {
    window.localStorage.setItem(PALETTE_STORAGE_KEY, next);
  } catch {
    /* storage blocked: the cookie still carries the choice */
  }
  try {
    document.cookie = `${PALETTE_COOKIE}=${next}; path=/; max-age=${PALETTE_COOKIE_MAX_AGE}; samesite=lax`;
  } catch {
    /* cookies blocked: the choice lasts for this page */
  }
}

/**
 * Palette (Notebook / Bold) state. The server reads the `hk_palette` cookie
 * and passes it in as `initialPalette`, so the first paint already carries
 * the right `data-palette`. If the cookie is gone but localStorage still
 * remembers a choice, that choice is restored and the cookie rewritten.
 * With neither, the palette is DEFAULT_PALETTE (Bold).
 */
export function PaletteProvider({
  initialPalette = DEFAULT_PALETTE,
  children,
}: {
  initialPalette?: Palette;
  children: React.ReactNode;
}) {
  // On the client, a localStorage choice wins when the cookie is missing.
  // Only the (closed) menu reads this state, so the first client render
  // can differ from the server's without a hydration mismatch.
  const [palette, setPaletteState] = useState<Palette>(() => {
    if (typeof window === 'undefined' || hasPaletteCookie()) return initialPalette;
    return readStoredPalette() ?? initialPalette;
  });

  const setPalette = useCallback((next: Palette) => {
    persistPalette(next);
    setPaletteState(next);
  }, []);

  // Restored from storage: put it back on <html> and in the cookie.
  useEffect(() => {
    if (palette !== initialPalette && !hasPaletteCookie()) persistPalette(palette);
    // Run once on mount; later changes persist through setPalette.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo(() => ({ palette, setPalette }), [palette, setPalette]);
  return <PaletteContext.Provider value={value}>{children}</PaletteContext.Provider>;
}

/**
 * App-wide theme provider. `class` strategy so the `.dark` token block in
 * globals.css applies; defaults to the OS preference so nobody is
 * surprised by a theme they never chose. Transitions are suppressed on
 * switch so every surface flips at once instead of fading unevenly.
 */
export function ThemeProvider({
  palette,
  children,
}: {
  palette?: Palette;
  children: React.ReactNode;
}) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <PaletteProvider initialPalette={palette}>{children}</PaletteProvider>
    </NextThemesProvider>
  );
}
