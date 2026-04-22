/**
 * Seed task library — static manifest for first-run onboarding wizard
 * (05-01 Task 2, D-12, ONBD-04).
 *
 * PURE DATA module: no functions, no I/O. The onboarding wizard in 05-03
 * maps these entries to draft tasks, bucketing by `suggested_area`, and
 * batch-creates them via a server action when the user clicks "Add N
 * tasks". All seeds default to `schedule_mode: 'cycle'` at task-create
 * time (cycle is the common case per SPEC §8.5 + D-12 — anchored is for
 * calendar-pinned events which don't fit the "starter kit" framing).
 *
 * Icon names are kebab-case Lucide identifiers. Every icon in this
 * manifest has been verified to exist in lucide-react@1.8.0 (the version
 * pinned in package.json). Missing icons would crash the wizard at render
 * time — see area-palette.ts for the same invariant applied to area icons.
 *
 * Slug ids are load-bearing: they double as React keys AND Playwright
 * selectors (`data-seed-id="seed-wipe-benches"`). DO NOT rename existing
 * slugs — add new ones, deprecate by removal.
 *
 * Size target: ~30 entries (D-12). Rebalance across areas if this grows
 * so every area still has at least one seed (the test suite enforces the
 * ≥1-per-area invariant).
 *
 * Frequency rationale: rough first approximations from D-12 + SPEC §11.
 * Users can tweak each frequency in the wizard's "Edit" expand before
 * committing; these are the defaults.
 */

export type SeedAreaSuggestion =
  | 'kitchen'
  | 'bathroom'
  | 'living'
  | 'yard'
  | 'whole_home';

export type SeedTask = {
  id: string;
  name: string;
  frequency_days: number;
  suggested_area: SeedAreaSuggestion;
  icon: string;
  description: string;
  // Phase 14 (SEAS-09, D-11, D-12): optional seasonal window.
  // Both set = seasonal; both omitted = year-round (backward-compat
  // for the 30 existing entries). Values are 1..12 month indices.
  // Northern-hemisphere convention per D-12 (warm = Apr-Sep,
  // cool = Oct-Mar). Hemisphere-aware labels deferred to v1.2.
  active_from_month?: number;
  active_to_month?: number;
};

export const SEED_LIBRARY: ReadonlyArray<SeedTask> = [
  // ─── Kitchen (7) ──────────────────────────────────────────────────────
  {
    id: 'seed-wipe-benches',
    name: 'Wipe kitchen benches',
    frequency_days: 3,
    suggested_area: 'kitchen',
    icon: 'wind',
    description: 'Clear and wipe down all bench surfaces.',
  },
  {
    id: 'seed-clean-sink',
    name: 'Clean kitchen sink',
    frequency_days: 7,
    suggested_area: 'kitchen',
    icon: 'droplet',
    description: 'Scrub, rinse and dry the sink basin and tap fittings.',
  },
  {
    id: 'seed-mop-kitchen-floor',
    name: 'Mop kitchen floor',
    frequency_days: 14,
    suggested_area: 'kitchen',
    icon: 'grid-2x2',
    description: 'Sweep then mop the kitchen floor.',
  },
  {
    id: 'seed-clean-oven',
    name: 'Clean oven',
    frequency_days: 90,
    suggested_area: 'kitchen',
    icon: 'flame',
    description: 'Deep-clean the oven interior, racks and door glass.',
  },
  {
    id: 'seed-deep-clean-fridge',
    name: 'Deep-clean fridge',
    frequency_days: 90,
    suggested_area: 'kitchen',
    icon: 'refrigerator',
    description: 'Empty, wipe shelves, check expiries and restock.',
  },
  {
    id: 'seed-clean-microwave',
    name: 'Clean microwave',
    frequency_days: 14,
    suggested_area: 'kitchen',
    icon: 'microwave',
    description: 'Wipe interior and plate; remove food splatters.',
  },
  {
    id: 'seed-empty-kitchen-bin',
    name: 'Empty kitchen bin',
    frequency_days: 3,
    suggested_area: 'kitchen',
    icon: 'trash-2',
    description: 'Replace liner and wipe lid.',
  },

  // ─── Bathroom (5) ─────────────────────────────────────────────────────
  {
    id: 'seed-wipe-vanity',
    name: 'Wipe bathroom vanity',
    frequency_days: 7,
    suggested_area: 'bathroom',
    icon: 'droplet',
    description: 'Wipe counters, taps, mirror and splash zones.',
  },
  {
    id: 'seed-clean-toilet',
    name: 'Clean toilet',
    frequency_days: 7,
    suggested_area: 'bathroom',
    icon: 'toilet',
    description: 'Scrub bowl, wipe seat, lid and exterior.',
  },
  {
    id: 'seed-scrub-shower',
    name: 'Scrub shower',
    frequency_days: 14,
    suggested_area: 'bathroom',
    icon: 'shower-head',
    description: 'Clean shower floor, walls, door and fittings.',
  },
  {
    id: 'seed-wash-bath-mat',
    name: 'Wash bath mat',
    frequency_days: 30,
    suggested_area: 'bathroom',
    icon: 'shirt',
    description: 'Launder the bath mat along with towels.',
  },
  {
    id: 'seed-clean-bathroom-floor',
    name: 'Mop bathroom floor',
    frequency_days: 14,
    suggested_area: 'bathroom',
    icon: 'grid-2x2',
    description: 'Sweep and mop including behind the toilet.',
  },

  // ─── Living areas (5) ─────────────────────────────────────────────────
  {
    id: 'seed-vacuum-living',
    name: 'Vacuum living areas',
    frequency_days: 7,
    suggested_area: 'living',
    icon: 'brush',
    description: 'Vacuum carpets, rugs and under furniture.',
  },
  {
    id: 'seed-dust-surfaces',
    name: 'Dust surfaces',
    frequency_days: 14,
    suggested_area: 'living',
    icon: 'sparkles',
    description: 'Dust shelves, TV unit, side tables and picture frames.',
  },
  {
    id: 'seed-wash-cushions',
    name: 'Wash cushion covers and throws',
    frequency_days: 90,
    suggested_area: 'living',
    icon: 'sofa',
    description: 'Launder removable cushion covers and throw blankets.',
  },
  {
    id: 'seed-wipe-lightswitches',
    name: 'Wipe light switches and door handles',
    frequency_days: 30,
    suggested_area: 'living',
    icon: 'lightbulb',
    description: 'Disinfect high-touch points.',
  },
  {
    id: 'seed-clean-windows',
    name: 'Clean interior windows',
    frequency_days: 90,
    suggested_area: 'living',
    icon: 'door-open',
    description: 'Wash glass and wipe window sills.',
  },

  // ─── Yards (5) ────────────────────────────────────────────────────────
  {
    id: 'seed-mow-lawn',
    name: 'Mow lawn',
    frequency_days: 14,
    suggested_area: 'yard',
    icon: 'sprout',
    description: 'Mow front and back lawns; edge if time permits.',
  },
  {
    id: 'seed-weed-beds',
    name: 'Weed garden beds',
    frequency_days: 30,
    suggested_area: 'yard',
    icon: 'flower',
    description: 'Hand-weed garden beds and paths.',
  },
  {
    id: 'seed-prune-shrubs',
    name: 'Prune shrubs',
    frequency_days: 90,
    suggested_area: 'yard',
    icon: 'trees',
    description: 'Prune shrubs and tidy hedges.',
  },
  {
    id: 'seed-water-pots',
    name: 'Water pot plants',
    frequency_days: 3,
    suggested_area: 'yard',
    icon: 'droplet',
    description: 'Water all pot plants and check saucers.',
  },
  {
    id: 'seed-sweep-outdoor',
    name: 'Sweep outdoor paths',
    frequency_days: 14,
    suggested_area: 'yard',
    icon: 'wind',
    description: 'Sweep verandahs, paths and outdoor tiles.',
  },

  // ─── Whole Home / Safety (8) ──────────────────────────────────────────
  {
    id: 'seed-smoke-alarm-batteries',
    name: 'Change smoke-alarm batteries',
    frequency_days: 365,
    suggested_area: 'whole_home',
    icon: 'battery',
    description: 'Replace 9V batteries in every smoke alarm.',
  },
  {
    id: 'seed-test-rcd',
    name: 'Test RCD safety switch',
    frequency_days: 180,
    suggested_area: 'whole_home',
    icon: 'zap',
    description: 'Press the Test button on your switchboard RCDs.',
  },
  {
    id: 'seed-check-gutters',
    name: 'Check and clear gutters',
    frequency_days: 180,
    suggested_area: 'whole_home',
    icon: 'home',
    description: 'Clear leaves and check downpipes.',
  },
  {
    id: 'seed-pest-control',
    name: 'Book pest control',
    frequency_days: 365,
    suggested_area: 'whole_home',
    icon: 'bug',
    description: 'Annual pest inspection and treatment.',
  },
  {
    id: 'seed-fire-extinguisher-check',
    name: 'Fire-extinguisher pressure check',
    frequency_days: 365,
    suggested_area: 'whole_home',
    icon: 'shield-check',
    description: 'Check gauge is in the green; replace or service if not.',
  },
  {
    id: 'seed-change-aircon-filter',
    name: 'Clean air-con filters',
    frequency_days: 90,
    suggested_area: 'whole_home',
    icon: 'wind',
    description: 'Rinse or replace split-system filters.',
  },
  {
    id: 'seed-flush-hot-water',
    name: 'Flush hot-water service',
    frequency_days: 180,
    suggested_area: 'whole_home',
    icon: 'droplet',
    description: 'Lift the PTR valve to flush sediment.',
  },
  {
    id: 'seed-wash-windows-exterior',
    name: 'Wash exterior windows',
    frequency_days: 180,
    suggested_area: 'whole_home',
    icon: 'home',
    description: 'Wash accessible outside window glass.',
  },

  // ─── Seasonal pairs (4) — Phase 14 SEAS-09 ────────────────────────
  // Hemisphere convention: Northern (warm = Apr-Sep). v1.2 will invert
  // labels by home.timezone region; for v1.1 the labels may feel
  // inverted for Southern-hemisphere users (noted as D-12 deferred).
  {
    id: 'seed-mow-lawn-warm',
    name: 'Mow lawn (warm season)',
    frequency_days: 14,
    suggested_area: 'yard',
    icon: 'sprout',
    description: 'Mow front and back lawns through the warm growing season.',
    active_from_month: 4,
    active_to_month: 9,
  },
  {
    id: 'seed-mow-lawn-cool',
    name: 'Mow lawn (cool season)',
    frequency_days: 30,
    suggested_area: 'yard',
    icon: 'sprout',
    description: 'Occasional mow through the cool season — grass grows slower.',
    active_from_month: 10,
    active_to_month: 3,
  },
  {
    id: 'seed-service-ac',
    name: 'Service air conditioner',
    frequency_days: 365,
    suggested_area: 'whole_home',
    icon: 'wind',
    description: 'Pre-summer service of the cooling system.',
    active_from_month: 10,
    active_to_month: 3,
  },
  {
    id: 'seed-service-heater',
    name: 'Service heater',
    frequency_days: 365,
    suggested_area: 'whole_home',
    icon: 'flame',
    description: 'Pre-winter service of the heating system.',
    active_from_month: 4,
    active_to_month: 9,
  },
];
