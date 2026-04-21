/**
 * Area palette constants (02-04 Plan, D-18 + D-19).
 *
 * A *fixed* palette — not a color wheel — is the explicit product choice
 * (CONTEXT D-19). Eight warm tones anchored on the SPEC §19 terracotta-sand
 * accent #D4A574 (which is ALSO the Tailwind `--primary` set in 02-02
 * globals.css at hsl(30 45% 65%)). First entry is the default.
 *
 * Icons are the strings (kebab-case) we store in the PB `areas.icon` text
 * column. The IconPicker UI turns each into the matching lucide-react
 * PascalCase export at render time (e.g. `utensils-crossed` → `UtensilsCrossed`).
 *
 * DEVIATION note: the plan's proposed icon list referenced `vacuum` and
 * (fallback) `broom`. Neither ships in lucide-react@1.8.0 — verified via
 * `typeof require('lucide-react').Vacuum === 'undefined'` and same for Broom.
 * Substituted `brush` (Brush exists) as the nearest semantic match (D-19
 * "common to homes"). Documented in the plan summary.
 */

export const AREA_COLORS = [
  '#D4A574', // terracotta-sand — primary accent, default for new areas
  '#C87E5C', // terracotta
  '#9B6B3E', // earth brown
  '#B88A6A', // warm sand (replaced '#6B8E5A' sage — cool, broke palette)
  '#8F6B55', // warm cocoa (replaced '#4F6D7A' slate — cool, broke palette)
  '#A67C52', // warm taupe
  '#BF8F4C', // mustard amber
  '#8A6F5C', // walnut
] as const;

export const AREA_ICONS = [
  'home',
  'bed',
  'utensils-crossed',
  'bath',
  'sofa',
  'shirt',
  'car',
  'trees',
  'flower',
  'wrench',
  'washing-machine',
  'refrigerator',
  'microwave',
  'toilet',
  'lightbulb',
  'fence',
  'sprout',
  'paintbrush',
  'hammer',
  'trash-2',
  'brush',       // substituted for 'vacuum' — lucide-react@1.8.0 has no Vacuum/Broom exports
  'door-open',
  'tent',
  'baby',
  'dog',
] as const;

export type AreaColor = (typeof AREA_COLORS)[number];
export type AreaIcon = (typeof AREA_ICONS)[number];
