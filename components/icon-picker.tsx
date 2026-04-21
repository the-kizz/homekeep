'use client';

import * as Icons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AREA_ICONS } from '@/lib/area-palette';
import { cn } from '@/lib/utils';

/**
 * Icon picker for area forms (D-19).
 *
 * Stores the kebab-case Lucide name as a string (e.g. 'utensils-crossed');
 * looks up the matching PascalCase export at render time. The dynamic
 * lookup is safe here — inputs are bounded by AREA_ICONS (zod-enforced
 * client+server), so the attacker surface for prototype-pollution-via-dynamic-key
 * is nil.
 *
 * HelpCircle is the fallback glyph if a name is accidentally added to
 * AREA_ICONS that doesn't resolve — surfaces visually in dev instead of
 * crashing.
 */

function kebabToPascal(s: string): string {
  return s
    .split('-')
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : ''))
    .join('');
}

// Typed narrow for the lucide namespace — keys are arbitrary exports (icons
// + helpers); we only read the ones we've whitelisted in AREA_ICONS.
const IconModule = Icons as unknown as Record<string, LucideIcon | undefined>;

export function IconPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Area icon"
      className="grid grid-cols-6 gap-2"
    >
      {AREA_ICONS.map((name) => {
        const Icon = IconModule[kebabToPascal(name)] ?? Icons.HelpCircle;
        return (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={value === name}
            aria-label={name}
            onClick={() => onChange(name)}
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-md border transition-colors',
              value === name
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border hover:bg-muted',
            )}
          >
            <Icon className="h-5 w-5" />
          </button>
        );
      })}
    </div>
  );
}
