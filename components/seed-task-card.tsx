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
}: {
  seed: SeedTask;
  areaOptions: SeedAreaOption[];
  selection: Selection;
  onChange: (patch: Partial<Selection>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<Selection>(selection);

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
    setExpanded(true);
  }

  function saveEdit() {
    onChange({
      name: draft.name,
      frequency_days: draft.frequency_days,
      area: draft.area,
      action: 'add',
    });
    setExpanded(false);
  }

  function cancelEdit() {
    // Revert draft without emitting any changes to parent selection.
    setDraft(selection);
    setExpanded(false);
  }

  return (
    <div
      data-seed-id={seed.id}
      data-seed-action={selection.action}
      data-seed-area={areaKey}
      data-seed-area-id={
        selection.area.kind === 'existing' ? selection.area.id : ''
      }
      data-frequency-days={selection.frequency_days}
      className={cn(
        'rounded-md border bg-background p-3 transition-opacity',
        isSkipped && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-3">
        <Icon
          className={cn(
            'size-5 shrink-0',
            isSkipped ? 'text-muted-foreground' : 'text-primary',
          )}
          aria-hidden={true}
        />
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              'truncate text-sm font-medium',
              isSkipped && 'line-through',
            )}
          >
            {selection.name}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            Every {selection.frequency_days}{' '}
            {selection.frequency_days === 1 ? 'day' : 'days'} · in {areaName}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {isSkipped ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onChange({ action: 'add' })}
              data-seed-restore
            >
              Add
            </Button>
          ) : (
            <>
              <span
                className="hidden rounded-full bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-primary sm:inline"
                aria-hidden={true}
              >
                Added
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={openEdit}
                data-seed-edit
              >
                Edit
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onChange({ action: 'skip' })}
                data-seed-skip
              >
                Skip
              </Button>
            </>
          )}
        </div>
      </div>

      {expanded && !isSkipped && (
        <div className="mt-3 space-y-3 border-t pt-3">
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
                value={draft.frequency_days}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    frequency_days: Math.max(
                      1,
                      Math.min(365, Number(e.target.value) || 1),
                    ),
                  }))
                }
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
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
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
