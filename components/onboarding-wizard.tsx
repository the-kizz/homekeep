'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  SeedTaskCard,
  encodeSeedArea,
  type SeedAreaOption,
  type SeedSelectionState,
} from '@/components/seed-task-card';
import { batchCreateSeedTasks } from '@/lib/actions/seed';
import { skipOnboarding } from '@/lib/actions/onboarding';
import {
  SUGGESTED_AREA_DEFAULTS,
  hemisphereFromTimezone,
  type SeedTask,
  type SeedAreaSuggestion,
} from '@/lib/seed-library';
import type { SeedAreaInput } from '@/lib/schemas/seed';
import { areaColor } from '@/lib/area-palette';

/**
 * OnboardingWizard — first-run seed library wizard.
 *
 * Displays SEED_LIBRARY grouped by suggested area. Each seed defaults to its
 * suggested area: an existing area with the same name if the home already
 * has one, otherwise a placeholder that the server creates on submit
 * ("Kitchen (will be created)"). That way By Area is useful the moment the
 * wizard finishes, without the user having to build areas first. Edit on a
 * card lets the user rename, retime or move a seed.
 *
 * Submit sends only seed ids, overrides and area choices; the server fills
 * in everything else from the library.
 *
 * E2E hooks: data-onboarding-wizard, data-selected-count, data-skip-all,
 * data-submit-seeds, data-hemisphere-note
 */

type WizardArea = { id: string; name: string; is_whole_home_system: boolean };

// Render order for the suggested_area sections.
const AREA_ORDER: readonly SeedAreaSuggestion[] = [
  'kitchen',
  'bathroom',
  'living',
  'yard',
  'whole_home',
];

const AREA_LABELS: Record<SeedAreaSuggestion, string> = {
  kitchen: SUGGESTED_AREA_DEFAULTS.kitchen.name,
  bathroom: SUGGESTED_AREA_DEFAULTS.bathroom.name,
  living: SUGGESTED_AREA_DEFAULTS.living.name,
  yard: SUGGESTED_AREA_DEFAULTS.yard.name,
  whole_home: 'Whole Home',
};

/** The existing area a suggested key will land on, if there is one. */
function matchExistingArea(
  key: SeedAreaSuggestion,
  areas: WizardArea[],
): WizardArea | undefined {
  if (key === 'whole_home') return areas.find((a) => a.is_whole_home_system);
  const label = AREA_LABELS[key].toLowerCase();
  return areas.find(
    (a) => !a.is_whole_home_system && a.name.trim().toLowerCase() === label,
  );
}

export function OnboardingWizard({
  home,
  areas,
  seeds,
}: {
  home: { id: string; name: string; timezone: string };
  areas: WizardArea[];
  seeds: ReadonlyArray<SeedTask>;
}) {
  const router = useRouter();
  const [isSubmitting, startSubmit] = useTransition();
  const [isSkipping, startSkip] = useTransition();

  const hemisphere = hemisphereFromTimezone(home.timezone);

  // Existing areas first (in the home's order), then one "will be created"
  // option for each suggested area the home doesn't have yet.
  const areaOptions = useMemo<SeedAreaOption[]>(() => {
    const opts: SeedAreaOption[] = areas.map((a) => ({
      area: { kind: 'existing', id: a.id },
      label: a.name,
    }));
    for (const key of AREA_ORDER) {
      if (key === 'whole_home' || matchExistingArea(key, areas)) continue;
      opts.push({
        area: { kind: 'suggested', key },
        label: `${AREA_LABELS[key]} (will be created)`,
      });
    }
    return opts;
  }, [areas]);

  const [selections, setSelections] = useState<
    Record<string, SeedSelectionState>
  >(() =>
    Object.fromEntries(
      seeds.map((s) => {
        const existing = matchExistingArea(s.suggested_area, areas);
        const area: SeedAreaInput = existing
          ? { kind: 'existing', id: existing.id }
          : { kind: 'suggested', key: s.suggested_area };
        return [
          s.id,
          {
            action: 'add',
            name: s.name,
            frequency_days: s.frequency_days,
            area,
          } satisfies SeedSelectionState,
        ];
      }),
    ),
  );

  // Each seed's starting area, encoded: the row hides its area chip while
  // it still matches the section it sits in.
  const defaultAreaKeys = useMemo(
    () =>
      Object.fromEntries(
        seeds.map((s) => {
          const existing = matchExistingArea(s.suggested_area, areas);
          const area: SeedAreaInput = existing
            ? { kind: 'existing', id: existing.id }
            : { kind: 'suggested', key: s.suggested_area };
          return [s.id, encodeSeedArea(area)];
        }),
      ) as Record<string, string>,
    [seeds, areas],
  );
  const sectionIsNew = (key: SeedAreaSuggestion) =>
    !matchExistingArea(key, areas);
  // The colour a suggested area is created with (Whole Home: the default).
  const sectionColor = (key: SeedAreaSuggestion) =>
    areaColor(key === 'whole_home' ? undefined : SUGGESTED_AREA_DEFAULTS[key].color);

  const selectedCount = useMemo(
    () => Object.values(selections).filter((s) => s.action === 'add').length,
    [selections],
  );

  const groupedSeeds = useMemo(() => {
    const map = new Map<SeedAreaSuggestion, SeedTask[]>();
    for (const a of AREA_ORDER) map.set(a, []);
    for (const s of seeds) {
      const bucket = map.get(s.suggested_area);
      if (bucket) bucket.push(s);
    }
    return map;
  }, [seeds]);

  function patchSelection(seedId: string, patch: Partial<SeedSelectionState>) {
    setSelections((prev) => ({
      ...prev,
      [seedId]: { ...prev[seedId], ...patch },
    }));
  }

  function handleSubmit() {
    const payload = Object.entries(selections)
      .filter(([, sel]) => sel.action === 'add')
      .map(([seed_id, sel]) => ({
        seed_id,
        name: sel.name.trim(),
        frequency_days: sel.frequency_days,
        area: sel.area,
      }));

    if (payload.length === 0) {
      toast.error('Select at least one task or use Skip all');
      return;
    }

    startSubmit(async () => {
      const r = await batchCreateSeedTasks({
        home_id: home.id,
        selections: payload,
      });
      if (!r.ok) {
        toast.error(r.formError || 'Could not create tasks');
        return;
      }
      // Count the areas the new tasks landed in so the toast matches By
      // Area: existing picks, plus areas created now. Suggested areas that
      // could not be created (area quota) fell back to Whole Home.
      const existingIds = new Set(
        payload.flatMap((p) => (p.area.kind === 'existing' ? [p.area.id] : [])),
      );
      const suggestedKeys = new Set(
        payload.flatMap((p) => (p.area.kind === 'suggested' ? [p.area.key] : [])),
      );
      const wholeHomeId = areas.find((a) => a.is_whole_home_system)?.id;
      if (suggestedKeys.has('whole_home') && wholeHomeId) {
        existingIds.add(wholeHomeId);
        suggestedKeys.delete('whole_home');
      }
      if (r.areasCreated < suggestedKeys.size && wholeHomeId) {
        existingIds.add(wholeHomeId);
      }
      const areaCount = existingIds.size + r.areasCreated;
      toast.success(
        `${r.count} ${r.count === 1 ? 'task' : 'tasks'} added across ${areaCount} ${
          areaCount === 1 ? 'area' : 'areas'
        } — welcome in.`,
      );
      router.push(`/h/${home.id}?welcome=1`);
      router.refresh();
    });
  }

  function handleSkipAll() {
    startSkip(async () => {
      const r = await skipOnboarding(home.id);
      if (!r.ok) {
        toast.error(r.formError || 'Could not skip onboarding');
        return;
      }
      toast.success('Skipped — you can add tasks any time.');
      router.push(`/h/${home.id}`);
      router.refresh();
    });
  }

  return (
    <div
      className="mx-auto max-w-3xl space-y-8 px-4 pt-6 pb-32 sm:px-6"
      data-onboarding-wizard
      data-home-id={home.id}
      data-selected-count={selectedCount}
    >
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="page-title">
            Welcome to {home.name}
          </h1>
          <p className="pt-1 text-[15px] leading-6 text-foreground/80">
            Here are some starter tasks, already sorted into rooms. Keep what
            fits and skip the rest. You can change the name, how often, or the
            area on any of them.
          </p>
          <p
            className="text-[13px] leading-5 text-muted-foreground"
            data-hemisphere-note={hemisphere}
          >
            {`Seasonal tasks use ${hemisphere === 'south' ? 'southern' : 'northern'}-hemisphere seasons based on your home's timezone (${home.timezone}).`}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleSkipAll}
          disabled={isSkipping || isSubmitting}
          data-skip-all
        >
          {isSkipping ? 'Skipping…' : 'Skip all'}
        </Button>
      </header>

      <div className="space-y-8">
        {AREA_ORDER.map((areaKey) => {
          const areaSeeds = groupedSeeds.get(areaKey) ?? [];
          if (areaSeeds.length === 0) return null;
          return (
            <section
              key={areaKey}
              data-seed-section={areaKey}
              className="space-y-3"
              // Section colour for the row discs (solid in Bold).
              style={{ '--area': sectionColor(areaKey) } as React.CSSProperties}
            >
              <div className="flex items-baseline justify-between gap-3 px-1">
                <h2 className="font-display text-lg font-medium tracking-tight">
                  {AREA_LABELS[areaKey]}
                </h2>
                <span className="text-[13px] tabular-nums text-muted-foreground">
                  {sectionIsNew(areaKey) ? 'New area, ' : ''}
                  {areaSeeds.length} {areaSeeds.length === 1 ? 'task' : 'tasks'}
                </span>
              </div>
              <div className="divide-y divide-hairline overflow-hidden rounded-xl border border-hairline bg-surface-2">
                {areaSeeds.map((seed) => (
                  <SeedTaskCard
                    key={seed.id}
                    seed={seed}
                    areaOptions={areaOptions}
                    selection={selections[seed.id]}
                    onChange={(patch) => patchSelection(seed.id, patch)}
                    sectionAreaKey={defaultAreaKeys[seed.id]}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-surface-2 md:static md:border-0 md:bg-transparent">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6 pb-[max(env(safe-area-inset-bottom),0.75rem)] md:py-0 md:pb-0">
          <p className="text-[13px] tabular-nums text-muted-foreground">
            {selectedCount === 0
              ? 'Everything is skipped. Add at least one back, or use Skip all.'
              : `${selectedCount} ${selectedCount === 1 ? 'task' : 'tasks'} selected`}
          </p>
          <div className="flex items-center gap-2">
            {/* No invite link here: leaving would discard every choice
                above. The welcome card offers it after submit. */}
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || isSkipping || selectedCount === 0}
              data-submit-seeds
            >
              {isSubmitting
                ? 'Adding…'
                : `Add ${selectedCount} ${selectedCount === 1 ? 'task' : 'tasks'}`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
