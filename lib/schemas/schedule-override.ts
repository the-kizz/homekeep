import { z } from 'zod';

/**
 * Schedule override write schema (10-01 Plan, D-11).
 *
 * Shared client + server. Past-date snooze rejected at the app layer —
 * PocketBase DateField allows any value, so the zod `.refine()` here is
 * the source of truth for "snooze_until must be in the future". Phase
 * 15's action-sheet UI will use a date picker that disallows past
 * dates too (defense in depth).
 *
 * Phase 15 imports this schema without churn — the server action there
 * will `.safeParse(formData)` and route refine errors to the snooze-
 * date field via `path: ['snooze_until']`.
 *
 * Clock-skew fudge (CLOCK_SKEW_SECS): a 30-second leeway so a user
 * submitting "snooze until now" doesn't get rejected by a 1-2s request
 * latency pushing their "future" date into the past on the server.
 * 30s is tight enough that a genuine minutes-in-the-past submission
 * still fails (Test F in the unit suite asserts a `now - 5min` fails).
 *
 * Fields NOT in this schema:
 *   - id / created / consumed_at — server-controlled or absent at create.
 *   - created_by_id — server-set from `pb.authStore.record.id` in the
 *     Phase 15 server action (mirrors the completions pattern where the
 *     caller never trusts client-supplied IDs for authorship fields).
 */

const CLOCK_SKEW_SECS = 30;

export const scheduleOverrideSchema = z
  .object({
    task_id: z.string().min(1, 'task_id is required'),
    snooze_until: z.string().min(1, 'snooze_until is required'), // ISO 8601 UTC
  })
  .refine(
    (d) => {
      const snooze = new Date(d.snooze_until);
      if (Number.isNaN(snooze.getTime())) return false;
      const threshold = Date.now() - CLOCK_SKEW_SECS * 1000;
      return snooze.getTime() > threshold;
    },
    {
      message: 'Snooze date must be in the future',
      path: ['snooze_until'],
    },
  );

export type ScheduleOverrideInput = z.infer<typeof scheduleOverrideSchema>;
