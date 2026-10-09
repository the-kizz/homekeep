/**
 * Colour palettes (DESIGN-2026-10-09-round2). The palette is independent of
 * light/dark (next-themes owns that); it is stored as `data-palette` on
 * <html>, in localStorage, and in a cookie so the server can render the
 * right attribute on first paint.
 */
export const PALETTES = ['notebook', 'bold'] as const;
export type Palette = (typeof PALETTES)[number];

/** Used when no cookie or localStorage choice exists (round 4: Bold). */
export const DEFAULT_PALETTE: Palette = 'bold';
export const PALETTE_COOKIE = 'hk_palette';
export const PALETTE_STORAGE_KEY = 'hk_palette';
/** One year, in seconds. */
export const PALETTE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const PALETTE_LABEL: Record<Palette, string> = {
  notebook: 'Notebook',
  bold: 'Bold',
};

export function parsePalette(value: string | null | undefined): Palette {
  return (PALETTES as readonly string[]).includes(value ?? '')
    ? (value as Palette)
    : DEFAULT_PALETTE;
}

export function isPalette(value: unknown): value is Palette {
  return typeof value === 'string' && (PALETTES as readonly string[]).includes(value);
}
