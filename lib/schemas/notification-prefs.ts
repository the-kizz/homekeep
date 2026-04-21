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
 * Topic regex: `^[A-Za-z0-9_-]{4,64}$` matches `lib/ntfy.ts` at send
 * time. Intentionally stricter than ntfy.sh's server-side accept — no
 * dots, no percent-encoding. See 06-01-SUMMARY §Decisions for rationale.
 */
export const notificationPrefsSchema = z.object({
  ntfy_topic: z
    .string()
    .trim()
    .max(64)
    .refine((v) => v === '' || /^[A-Za-z0-9_-]{4,64}$/.test(v), {
      message: 'Topic must be 4-64 URL-safe characters',
    }),
  notify_overdue: z.boolean(),
  notify_assigned: z.boolean(),
  notify_partner_completed: z.boolean(),
  notify_weekly_summary: z.boolean(),
  weekly_summary_day: z.enum(['sunday', 'monday']),
});

export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>;
