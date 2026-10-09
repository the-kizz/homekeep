'use client';

import { Monitor, Moon, Palette as PaletteIcon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import clsx from 'clsx';
import {
  DropdownMenuItem,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { usePalette } from '@/components/theme-provider';
import { PALETTES, PALETTE_LABEL, type Palette } from '@/lib/palette';

const MODES = ['system', 'light', 'dark'] as const;
type ThemeChoice = (typeof MODES)[number];

const MODE_LABEL: Record<ThemeChoice, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

const MODE_ICON: Record<ThemeChoice, typeof Sun> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

function asChoice(theme: string | undefined): ThemeChoice {
  return (MODES as readonly string[]).includes(theme ?? '')
    ? (theme as ThemeChoice)
    : 'system';
}

/**
 * One segment of a segmented row. Inside a menu, the right role for "one
 * of these is chosen" is menuitemradio + aria-checked (aria-pressed is not
 * allowed on menu items). The menu stays open on select so the change is
 * visible straight away.
 */
function Segment({
  checked,
  onSelect,
  children,
  ...rest
}: {
  checked: boolean;
  onSelect: () => void;
  children: React.ReactNode;
} & Record<`data-${string}`, string>) {
  return (
    <DropdownMenuItem
      role="menuitemradio"
      aria-checked={checked}
      onSelect={(e) => {
        e.preventDefault();
        onSelect();
      }}
      className={clsx(
        'min-h-9 flex-1 justify-center gap-1.5 rounded-md px-2 py-1.5 text-[13px]',
        checked
          ? 'bg-primary text-primary-foreground focus:bg-primary focus:text-primary-foreground'
          : 'text-foreground',
      )}
      {...rest}
    >
      {children}
    </DropdownMenuItem>
  );
}

/**
 * Account-menu "Appearance" section: two segmented rows, the palette
 * (Notebook / Bold) and the light/dark mode (System / Light / Dark).
 * Inline in the menu rather than a flyout submenu: on a phone the
 * flyout had no room beside the menu and was cut off at the screen edge.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { palette, setPalette } = usePalette();
  const current = asChoice(theme);

  return (
    <div className="px-1 pt-1 pb-1.5">
      <DropdownMenuLabel className="flex items-center gap-2 px-1 pt-0.5 pb-2 text-sm font-medium">
        <PaletteIcon className="size-4 text-muted-foreground" aria-hidden="true" />
        Appearance
      </DropdownMenuLabel>
      <div
        role="group"
        aria-label="Theme"
        className="flex gap-1 rounded-lg bg-muted p-1"
      >
        {PALETTES.map((p: Palette) => (
          <Segment
            key={p}
            checked={palette === p}
            onSelect={() => setPalette(p)}
            data-palette-option={p}
          >
            {PALETTE_LABEL[p]}
          </Segment>
        ))}
      </div>
      <div
        role="group"
        aria-label="Mode"
        data-theme-toggle
        data-theme-current={current}
        className="mt-1.5 flex gap-1 rounded-lg bg-muted p-1"
      >
        {MODES.map((m) => {
          const ModeIcon = MODE_ICON[m];
          return (
            <Segment
              key={m}
              checked={current === m}
              onSelect={() => setTheme(m)}
              data-mode-option={m}
            >
              <ModeIcon className="size-3.5 text-current" aria-hidden="true" />
              {MODE_LABEL[m]}
            </Segment>
          );
        })}
      </div>
    </div>
  );
}
