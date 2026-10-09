'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';

const ORDER = ['system', 'light', 'dark'] as const;
type ThemeChoice = (typeof ORDER)[number];

const LABEL: Record<ThemeChoice, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

const ICON: Record<ThemeChoice, typeof Sun> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

function asChoice(theme: string | undefined): ThemeChoice {
  return (ORDER as readonly string[]).includes(theme ?? '')
    ? (theme as ThemeChoice)
    : 'system';
}

/**
 * Account-menu item that cycles system → light → dark. The menu stays
 * open on select so the label visibly confirms each step; one control
 * instead of three keeps the menu short.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const current = asChoice(theme);
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
  const Icon = ICON[current];

  return (
    <DropdownMenuItem
      data-theme-toggle
      data-theme-current={current}
      onSelect={(e) => {
        e.preventDefault();
        setTheme(next);
      }}
    >
      <Icon className="size-4" aria-hidden="true" />
      <span>Appearance: {LABEL[current]}</span>
    </DropdownMenuItem>
  );
}
