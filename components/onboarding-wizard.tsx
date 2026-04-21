'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { SeedTaskCard } from '@/components/seed-task-card';
import { batchCreateSeedTasks } from '@/lib/actions/seed';
import { skipOnboarding } from '@/lib/actions/onboarding';
import type { SeedTask, SeedAreaSuggestion } from '@/lib/seed-library';

/**
 * OnboardingWizard — first-run seed library wizard (05-03 Task 2, D-13).
 *
 * Client Component. Displays the SEED_LIBRARY grouped by suggested_area,
 * each seed rendered as a SeedTaskCard with Add/Edit/Skip controls. Per
 * CONTEXT bottom note + 05-03 mapping decision: every seed DEFAULTS to the
 * Whole Home area (always exists via the Phase 2 hook). The Edit control
 * lets the user pick a different existing area.
 *
 * Submit flow:
 *   1. Click "Add N tasks" → collects all selections with action='add' →
 *      calls batchCreateSeedTasks({home_id, selections}) inside a useTransition.
 *   2. On success: toast + router.push('/h/[id]') + router.refresh().
 *   3. On failure: toast.error + stay on wizard.
 *
 * Skip-all flow:
 *   1. Click "Skip all" → calls skipOnboarding(home_id).
 *   2. On success: router.push('/h/[id]') + router.refresh().
 *
 * E2E hooks:
 *   data-onboarding-wizard, data-selected-count, data-skip-all
 */

type SeedAction = 'add' | 'skip';

type Selection = {
  action: SeedAction;
  name: string;
  frequency_days: number;
  area_id: string;
};

// Order used for rendering the suggested_area sections per CONTEXT D-13.
const AREA_ORDER: readonly SeedAreaSuggestion[] = [
  'kitchen',
  'bathroom',
  'living',
  'yard',
  'whole_home',
];

const AREA_LABELS: Record<SeedAreaSuggestion, string> = {
  kitchen: 'Kitchen',
  bathroom: 'Bathroom',
  living: 'Living areas',
  yard: 'Yard',
  whole_home: 'Whole Home',
};

export function OnboardingWizard({
  home,
  areas,
  seeds,
}: {
  home: { id: string; name: string };
  areas: Array<{ id: string; name: string; is_whole_home_system: boolean }>;
  seeds: ReadonlyArray<SeedTask>;
}) {
  const router = useRouter();
  const [isSubmitting, startSubmit] = useTransition();
  const [isSkipping, startSkip] = useTransition();

  // Every home has Whole Home via the Phase 2 hook — safe to assume.
  const wholeHomeArea =
    areas.find((a) => a.is_whole_home_system) ?? areas[0];
  const wholeHomeId = wholeHomeArea?.id ?? '';

  const [selections, setSelections] = useState<Record<string, Selection>>(
    () =>
      Object.fromEntries(
        seeds.map((s) => [
          s.id,
          {
            action: 'add' as SeedAction,
            name: s.name,
            frequency_days: s.frequency_days,
            area_id: wholeHomeId,
          },
        ]),
      ),
  );

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

  function patchSelection(seedId: string, patch: Partial<Selection>) {
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
        area_id: sel.area_id,
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
      toast.success(
        `${r.count} task${r.count === 1 ? '' : 's'} added — welcome in.`,
      );
      router.push(`/h/${home.id}`);
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
      className="mx-auto max-w-3xl space-y-6 p-6 pb-32"
      data-onboarding-wizard
      data-home-id={home.id}
      data-selected-count={selectedCount}
    >
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">
            Welcome to {home.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            Let&apos;s seed some starter tasks — skip anything that
            doesn&apos;t fit. You can edit the name, frequency, or area on
            each one.
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

      <div className="space-y-6">
        {AREA_ORDER.map((areaKey) => {
          const areaSeeds = groupedSeeds.get(areaKey) ?? [];
          if (areaSeeds.length === 0) return null;
          return (
            <section
              key={areaKey}
              data-seed-section={areaKey}
              className="space-y-2"
            >
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {AREA_LABELS[areaKey]} ({areaSeeds.length}{' '}
                {areaSeeds.length === 1 ? 'task' : 'tasks'})
              </h2>
              <div className="space-y-2">
                {areaSeeds.map((seed) => (
                  <SeedTaskCard
                    key={seed.id}
                    seed={seed}
                    areas={areas}
                    selection={selections[seed.id]}
                    onChange={(patch) => patchSelection(seed.id, patch)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur md:static md:border-0 md:bg-transparent md:backdrop-blur-none">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-6 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] md:py-0 md:pb-0">
          <p className="text-xs text-muted-foreground">
            {selectedCount === 0
              ? 'All skipped — use Skip all above or add at least one back.'
              : `${selectedCount} ${selectedCount === 1 ? 'task' : 'tasks'} selected`}
          </p>
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
  );
}
