import { z } from 'zod';
import { AREA_COLORS, AREA_ICONS } from '@/lib/area-palette';

/**
 * Area form schema (02-04 Plan, CONTEXT D-10 + D-19).
 *
 * `icon` and `color` are z.enum over the AREA_ICONS / AREA_COLORS constants
 * so any client bypass attempting to POST an off-palette value is rejected
 * at the server re-parse — T-02-04-01 defence against arbitrary string
 * injection into the PB `color` / `icon` text columns (also pattern-guarded
 * at PB schema level for color).
 *
 * `home_id` is required on the schema because both create and update forms
 * need to route the mutation to a specific home. The server action still
 * verifies home ownership via PB's API rules before persisting.
 *
 * `default_assignee_id` is optional + nullable for forward compat with
 * Phase 4 (multi-member) even though Phase 2 is single-user.
 */

// zod's z.enum requires a non-empty readonly string tuple. AREA_ICONS /
// AREA_COLORS are `as const` tuples; the cast is safe by construction.
const iconEnum = z.enum(AREA_ICONS as unknown as [string, ...string[]]);
const colorEnum = z.enum(AREA_COLORS as unknown as [string, ...string[]]);

export const areaSchema = z.object({
  home_id: z.string().min(1, 'home_id is required'),
  name: z
    .string()
    .min(1, 'Name is required')
    .max(60, 'Name too long'),
  icon: iconEnum,
  color: colorEnum,
  sort_order: z.number().int().min(0),
  scope: z.enum(['location', 'whole_home']),
  default_assignee_id: z.string().nullish(),
});

export type AreaInput = z.infer<typeof areaSchema>;
