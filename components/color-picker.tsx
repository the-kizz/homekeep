'use client';

import { AREA_COLORS } from '@/lib/area-palette';
import { cn } from '@/lib/utils';

/**
 * Fixed 8-swatch color picker for area forms (D-19).
 *
 * Controlled by the parent form via value/onChange; the AreaForm wires this
 * into react-hook-form's setValue so the hidden input submits the selected
 * hex to the server action which re-validates via the AREA_COLORS enum.
 *
 * Accessibility: renders as a radiogroup of role="radio" buttons so
 * keyboard users Tab in, Space/Enter to pick. aria-label on each swatch
 * names the color for screen readers.
 */
export function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Area color"
      className="flex flex-wrap gap-2"
    >
      {AREA_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className={cn(
            'h-8 w-8 rounded-full border-2 transition-colors',
            value === c
              ? 'border-foreground ring-2 ring-offset-2 ring-offset-background'
              : 'border-transparent',
          )}
          style={{ background: c }}
        />
      ))}
    </div>
  );
}
