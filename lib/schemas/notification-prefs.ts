import { z } from 'zod';

/**
 * Notification preferences schema (06-02 Task 2, D-15, NOTF-01 / 05 / 06).
 *
 * Consumed by both `lib/actions/notification-prefs.ts` (server-side
 * safeParse of FormData) and the Wave 3 Person-view Notifications form
 * (react-hook-form + zodResolver). Empty-topic is allowed — it maps to
 * the user's "not configured yet" state; the scheduler's eligibility
 * filter skips users with empty topics so the no-topic row costs nothing
 * at tick time.
 *
 * Phase 25 RATE-06 — topic hardening:
 *   - Minimum length raised 4 → 12 chars (a 12-char random topic lives
 *     in a ~10^21-item keyspace, outside practical enumeration).
 *   - Must contain at least one digit (raises entropy floor; rejects
 *     English-word-only topics like "kitchen" or "alicealice" which a
 *     targeted guesser could enumerate from common nouns + names).
 *
 * Existing users with pre-RATE-06 topics are grandfathered — their
 * rows stay as-is; only NEW updates routed through this schema must
 * satisfy the tightened rule. See 25-01-SUMMARY §Deviations for the
 * PB-migration tradeoff (no DB-layer regex is enforced).
 *
 * Regex: `^[A-Za-z0-9_-]{12,64}$` + `.regex(/\d/)` refinement keeps
 * URL-safety (matches `lib/ntfy.ts` at send time) while adding the
 * min-length + digit floor.
 */
export const notificationPrefsSchema = z.object({
  ntfy_topic: z
    .string()
    .trim()
    .max(64)
    .refine(
      (v) => v === '' || /^[A-Za-z0-9_-]{12,64}$/.test(v),
      { message: 'Topic must be 12-64 URL-safe characters' },
    )
    .refine(
      (v) => v === '' || /\d/.test(v),
      { message: 'Topic must contain at least one digit' },
    ),
  notify_overdue: z.boolean(),
  notify_assigned: z.boolean(),
  notify_partner_completed: z.boolean(),
  notify_weekly_summary: z.boolean(),
  weekly_summary_day: z.enum(['sunday', 'monday']),
});

export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>;
