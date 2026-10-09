import { z } from 'zod';

/**
 * Task schema (02-05 Plan, D-12; 11-01 Plan extends with OOFT/PREF/SEAS).
 *
 * Shared client + server. The `.refine()` on (schedule_mode, anchor_date)
 * carries `path: ['anchor_date']` per Pitfall 12 so the error surfaces
 * under the anchor_date field in RHF / fieldErrors — not under the
 * mystery top-level '' key.
 *
 * Defence in depth: createTask / updateTask server actions re-parse the
 * formData through this same schema. The computeNextDue pure function also
 * validates `frequency_days` as a positive integer and throws — a belt-
 * and-braces mitigation for T-02-05-03.
 *
 * Phase 11 extensions (D-01, D-03, D-07, D-11, D-21, D-22):
 *   - `frequency_days` is now nullable (OOFT-01). One-off tasks carry a
 *     null frequency + a concrete `due_date` (D-01 user-locked 2026-04-22).
 *   - `due_date`, `preferred_days`, `active_from_month`,
 *     `active_to_month` added as optional fields.
 *   - 3 new `.refine(...)` calls enforce cross-field invariants, each
 *     with an explicit `path:` per Pitfall 2:
 *       1. OOFT shape requires a `due_date` (path: ['due_date']).
 *       2. Seasonal months paired — both set or both null
 *          (path: ['active_from_month']).
 *       3. OOFT + anchored incompatible (defense-in-depth for OOFT-04
 *          form UI that lands in Phase 15) (path: ['schedule_mode']).
 *   - D-22: no past-date refine on `due_date` — legitimate "I forgot
 *     this, do it ASAP" pattern; task renders overdue immediately.
 *
 * Fields NOT in this schema:
 *   - `archived` / `archived_at` — server-controlled; never accepted from
 *     client formData (T-02-05-08). createTask always sets archived=false;
 *     archiveTask sets archived=true + archived_at=nowISO.
 *   - `owner_id` equivalent — home_id is the ownership handle, validated
 *     via pb.collection('homes').getOne() preflight in the action.
 */

export const scheduleModeEnum = z.enum(['cycle', 'anchored']);
export const preferredDaysEnum = z.enum(['any', 'weekend', 'weekday']);

export const taskSchema = z
  .object({
    home_id: z.string().min(1, 'home_id is required'),
    area_id: z.string().min(1, 'area_id is required'),
    name: z
      .string()
      .min(1, 'Name is required')
      .max(120, 'Name too long'),
    description: z.string().max(5000, 'Description too long').optional().or(z.literal('')),
    // Phase 11 (OOFT-01, D-02): nullable — one-off tasks carry null
    // frequency + a concrete due_date.
    frequency_days: z
      .number()
      .int('Frequency must be a whole number')
      .min(1, 'Frequency must be at least 1 day')
      .nullable(),
    schedule_mode: scheduleModeEnum,
    // ISO date string or null; when schedule_mode === 'anchored', refine
    // below requires it to be non-null + non-empty.
    anchor_date: z.string().nullable(),
    icon: z.string().max(40).optional().or(z.literal('')),
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid color')
      .optional()
      .or(z.literal('')),
    assigned_to_id: z.string().nullish(),
    notes: z.string().max(2000, 'Notes too long').optional().or(z.literal('')),
    // Phase 11 (D-03): OOFT explicit "do by" date. Required when
    // frequency_days is null — enforced by cross-field refine below.
    // Phase 15 Plan 02 (T-15-02-02): tighten regex to mirror last_done
    // (WR-01 from Phase 13). An HTML <input type="date"> always emits
    // YYYY-MM-DD; crafted form POSTs with garbage ("<script>", etc.)
    // trip a fieldError here instead of flowing through as Invalid Date
    // downstream. Keeps optional/nullable so the field may be omitted
    // for recurring tasks without error.
    due_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}/, 'Due date must be a valid date')
      .nullable()
      .optional(),
    // Phase 11 (D-07): preferred_days enum. Null reads as 'any' via
    // effectivePreferredDays helper.
    preferred_days: preferredDaysEnum.nullable().optional(),
    // Phase 11 (D-11): paired seasonal window. Both set or both null.
    active_from_month: z.number().int().min(1).max(12).nullable().optional(),
    active_to_month: z.number().int().min(1).max(12).nullable().optional(),
    // Phase 12 (D-01, LOAD-01): smoothed date written by placeNextDue
    // on completion (Plan 12-03) or on task creation (Phase 13 TCSEM).
    // Null for v1.0 holdover rows; read-time falls through to natural
    // cadence per D-02.
    next_due_smoothed: z.string().nullable().optional(),
    // Phase 13 (TCSEM-01, TCSEM-02): optional last-done date from the
    // task-form Advanced collapsible. Cycle mode only — anchored and
    // OOFT bypass smoothing entirely (D-03, D-04). Null = use TCSEM-03
    // smart default at placement time. The server action in
    // lib/actions/tasks.ts converts the string → Date and passes to
    // computeFirstIdealDate.
    //
    // Phase 13 review WR-01: tighten to ISO-date shape (YYYY-MM-DD...)
    // so a crafted form POST with garbage (e.g. "not-a-date") surfaces
    // a fieldError instead of silently dropping through to Invalid Date
    // and being swallowed by the outer try/catch. Regex matches the
    // leading date part only — an HTML `<input type="date">` always
    // emits YYYY-MM-DD; an ISO datetime is also accepted. Keeps
    // optional/nullable so the form may omit the field entirely and
    // the smart-default (TCSEM-03) branch still runs.
    last_done: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}/, 'Last done must be a valid date')
      .nullable()
      .optional(),
    // Phase 15 (D-07, SNZE-07): server-set marker. When the user picks
    // "From now on" via RescheduleActionSheet, rescheduleTaskAction sets
    // this to now.toISOString(). Phase 17 REBAL preservation rules read
    // a non-null marker as "user intent wins over recompute."
    // Raw-parse passthrough only — never accepted from client formData
    // (server action sets it directly on pb.update, bypassing form
    // serialization). Listed here so updateTask's safeParse doesn't trip
    // on unknown keys if a future edit-form path exposes it.
    reschedule_marker: z.string().nullable().optional(),
  })
  .refine(
    (d) =>
      d.schedule_mode === 'cycle' ||
      (d.schedule_mode === 'anchored' &&
        typeof d.anchor_date === 'string' &&
        d.anchor_date.length > 0),
    {
      message: 'Anchor date required for anchored tasks',
      path: ['anchor_date'],
    },
  )
  // Phase 11 refine 1 (D-01, D-21): OOFT requires due_date.
  .refine(
    (d) =>
      d.frequency_days !== null ||
      (typeof d.due_date === 'string' && d.due_date.length > 0),
    {
      message: 'Due date required for one-off tasks',
      path: ['due_date'],
    },
  )
  // Phase 11 refine 2 (D-11, D-21): paired seasonal months.
  .refine(
    (d) => (d.active_from_month == null) === (d.active_to_month == null),
    {
      message: 'Active from/to months must be set together',
      path: ['active_from_month'],
    },
  )
  // Phase 11 refine 3 (defense-in-depth): anchored + OOFT incompatible.
  // OOFT-04 form UI lands in Phase 15; schema-layer guard avoids bad
  // rows reaching storage if the form ever drifts.
  .refine(
    (d) => d.frequency_days !== null || d.schedule_mode !== 'anchored',
    {
      message: 'One-off tasks cannot use anchored mode',
      path: ['schedule_mode'],
    },
  );

export type TaskInput = z.infer<typeof taskSchema>;
