'use client';

import { useState } from 'react';
import * as LucideIcons from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { SeedTask } from '@/lib/seed-library';
import type { SeedAreaInput } from '@/lib/schemas/seed';

/**
 * SeedTaskCard — per-seed row in the onboarding wizard (05-03 Task 2).
 *
 * Controlled by its parent (OnboardingWizard): the selection state lives
 * in the wizard's useState map, so this component just renders the current
 * selection and emits patch events via `onChange`.
 *
 * Three visual modes:
 *   1. Collapsed + action='add' — shows seed name, freq, area with [Added]
 *      indicator + [Edit] + [Skip] buttons.
 *   2. Collapsed + action='skip' — muted/strikethrough with [Add] button
 *      to restore.
 *   3. Edit mode (action='add' + expanded) — inline form with
 *      name text input, freq number input, native area select.
 *      [Save] collapses; [Cancel] discards the draft.
 *
 * The area select lists the home's existing areas plus any suggested area
 * that doesn't exist yet ("Kitchen (will be created)"); the server creates
 * those on submit.
 *
 * E2E hooks (Suite A):
 *   data-seed-id, data-seed-action, data-seed-area (encoded choice),
 *   data-seed-area-id (existing area id, '' for a to-be-created area),
 *   data-frequency-days
 */

export type SeedSelectionState = {
  action: 'add' | 'skip';
  name: string;
  frequency_days: number;
  area: SeedAreaInput;
};

export type SeedAreaOption = { area: SeedAreaInput; label: string };

type Selection = SeedSelectionState;

/** Stable string form of an area choice, used as the <select> value. */
export function encodeSeedArea(area: SeedAreaInput): string {
  return area.kind === 'existing'
    ? `existing:${area.id}`
    : `suggested:${area.key}`;
}

export function SeedTaskCard({
  seed,
  areaOptions,
  selection,
  onChange,
  sectionAreaKey,
}: {
  /** Encoded area of the section this row sits in. When the row's area
   * matches it, the chip is redundant and only read to screen readers. */
  sectionAreaKey?: string;
  seed: SeedTask;
  areaOptions: SeedAreaOption[];
  selection: Selection;
  onChange: (patch: Partial<Selection>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<Selection>(selection);
  // Free-text mirror of frequency_days while the edit panel is open; clamped
  // on blur and on save so the user can clear the box and type a new number.
  const [freqText, setFreqText] = useState(String(selection.frequency_days));

  const pascalIcon = toPascalCase(seed.icon);
  const LucideMap = LucideIcons as unknown as Record<
    string,
    | React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
    | undefined
  >;
  const Icon = LucideMap[pascalIcon] ?? LucideIcons.Home;

  const areaKey = encodeSeedArea(selection.area);
  const areaOption = areaOptions.find((o) => encodeSeedArea(o.area) === areaKey);
  const areaName =
    selection.area.kind === 'suggested'
      ? (areaOption?.label.replace(/ \(will be created\)$/, ' (new)') ?? 'a new area')
      : (areaOption?.label ?? 'Whole Home');

  const isSkipped = selection.action === 'skip';

  function openEdit() {
    setDraft(selection);
    setFreqText(String(selection.frequency_days));
    setExpanded(true);
  }

  function saveEdit() {
    const freq = Math.max(1, Math.min(365, Number(freqText) || draft.frequency_days));
    onChange({
      name: draft.name,
      frequency_days: freq,
      area: draft.area,
      action: 'add',
    });
    setExpanded(false);
  }

  function cancelEdit() {
    // Revert draft without emitting any changes to parent selection.
    setDraft(selection);
    setFreqText(String(selection.frequency_days));
    setExpanded(false);
  }

  // Strip the "(new)" suffix into its own quiet marker for the chip.
  const isNewArea = selection.area.kind === 'suggested';
  const chipName = areaName.replace(/ \(new\)$/, '');

  return (
    <div
      data-seed-id={seed.id}
      data-seed-action={selection.action}
      data-seed-area={areaKey}
      data-seed-area-id={
        selection.area.kind === 'existing' ? selection.area.id : ''
      }
      data-frequency-days={selection.frequency_days}
      className="px-3 py-2.5 sm:px-4"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden={true}
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-full motion-safe:transition-colors motion-safe:duration-150',
            isSkipped
              ? 'bg-muted text-muted-foreground'
              : 'bg-status-soon/15 text-status-soon-deep bold:bg-(--area) bold:text-on-status',
          )}
        >
          <Icon className="size-[18px]" aria-hidden={true} />
        </span>
        <div
          className={cn(
            'min-w-0 flex-1 motion-safe:transition-opacity motion-safe:duration-150',
            isSkipped && 'opacity-60',
          )}
        >
          <div className="line-clamp-2 break-words text-[15px] leading-[22px] font-medium">
            {selection.name}
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-5 text-muted-foreground">
            <span className="shrink-0 tabular-nums">
              Every {selection.frequency_days}{' '}
              {selection.frequency_days === 1 ? 'day' : 'days'}
            </span>
            <span
              className={cn(
                'max-w-full truncate rounded-full border border-hairline px-2 text-xs leading-[18px]',
                areaKey === sectionAreaKey && 'sr-only',
              )}
            >
              <span className="sr-only">in </span>
              {chipName}
              {isNewArea && (
                <span className="text-link"> (new)</span>
              )}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center">
          {!isSkipped && (
            <button
              type="button"
              onClick={openEdit}
              data-seed-edit
              aria-label={`Edit ${selection.name}`}
              aria-expanded={expanded}
              className="flex size-11 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring motion-safe:transition-colors"
            >
              <LucideIcons.Pencil className="size-[18px]" strokeWidth={1.75} aria-hidden={true} />
            </button>
          )}
          {/* Add/skip is one switch. data-seed-skip / data-seed-restore
              stay on the control so existing hooks keep working. */}
          <button
            type="button"
            role="switch"
            aria-checked={!isSkipped}
            aria-label={`Add ${selection.name}`}
            onClick={() => onChange({ action: isSkipped ? 'add' : 'skip' })}
            data-seed-skip={isSkipped ? undefined : ''}
            data-seed-restore={isSkipped ? '' : undefined}
            className="group flex h-11 w-12 items-center justify-center rounded-full outline-none"
          >
            <span
              aria-hidden="true"
              className={cn(
                'relative inline-flex h-6 w-10 items-center rounded-full border motion-safe:transition-colors motion-safe:duration-150',
                'group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-surface-2',
                isSkipped
                  ? 'border-input bg-muted'
                  : 'border-status-healthy bg-status-healthy',
              )}
            >
              <span
                className={cn(
                  'absolute size-[18px] rounded-full bg-surface-2 shadow-sm motion-safe:transition-transform motion-safe:duration-150',
                  isSkipped ? 'translate-x-[2px]' : 'translate-x-[18px]',
                )}
              />
            </span>
          </button>
        </div>
      </div>

      {expanded && !isSkipped && (
        <div className="mt-3 space-y-3 rounded-lg border border-hairline bg-background/60 p-3">
          <div className="space-y-1">
            <Label htmlFor={`seed-name-${seed.id}`} className="text-xs">
              Name
            </Label>
            <Input
              id={`seed-name-${seed.id}`}
              name="name"
              value={draft.name}
              onChange={(e) =>
                setDraft((d) => ({ ...d, name: e.target.value }))
              }
              maxLength={100}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label
                htmlFor={`seed-freq-${seed.id}`}
                className="text-xs"
              >
                Every N days
              </Label>
              <Input
                id={`seed-freq-${seed.id}`}
                name="frequency_days"
                type="number"
                min={1}
                max={365}
                value={freqText}
                inputMode="numeric"
                onChange={(e) => setFreqText(e.target.value)}
                onBlur={() => {
                  // Clamp only once the user is done typing, so clearing
                  // the box to type "30" does not snap to "1" mid-keystroke.
                  const n = Math.max(1, Math.min(365, Number(freqText) || 1));
                  setFreqText(String(n));
                  setDraft((d) => ({ ...d, frequency_days: n }));
                }}
              />
            </div>
            <div className="space-y-1">
              <Label
                htmlFor={`seed-area-${seed.id}`}
                className="text-xs"
              >
                Area
              </Label>
              <select
                id={`seed-area-${seed.id}`}
                name="area"
                data-seed-area-select
                value={encodeSeedArea(draft.area)}
                onChange={(e) => {
                  const picked = areaOptions.find(
                    (o) => encodeSeedArea(o.area) === e.target.value,
                  );
                  if (picked) setDraft((d) => ({ ...d, area: picked.area }));
                }}
                className="flex h-11 w-full rounded-lg border border-input bg-surface-2 px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                {areaOptions.map((o) => {
                  const value = encodeSeedArea(o.area);
                  return (
                    <option key={value} value={value}>
                      {o.label}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={cancelEdit}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={saveEdit}
              disabled={draft.name.trim().length === 0}
              data-seed-save
            >
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Convert kebab-case icon name to PascalCase for lucide-react lookup.
 * Mirrors the same helper in area-card.tsx.
 */
function toPascalCase(kebab: string): string {
  return kebab
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}
