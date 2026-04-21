import { describe, test, expect } from 'vitest';
import { notificationPrefsSchema } from '@/lib/schemas/notification-prefs';

/**
 * 06-02 Task 2 — zod validation for updateNotificationPrefsAction input
 * (D-15, NOTF-01 / NOTF-05 / NOTF-06).
 *
 * Pure schema test — no PB, no fetch. The real roundtrip (server action
 * writes to users.ntfy_topic etc.) belongs to the Wave 3 E2E suite.
 *
 * 8 cases covering the topic regex + enum constraints + boolean
 * strictness. Empty topic is explicitly allowed (means "not configured"
 * — scheduler skips users with empty topic so the unconfigured default
 * is a no-op rather than an error).
 */

const baseValid = {
  ntfy_topic: 'alice-test-abc123',
  notify_overdue: true,
  notify_assigned: true,
  notify_partner_completed: false,
  notify_weekly_summary: false,
  weekly_summary_day: 'sunday' as const,
};

describe('notificationPrefsSchema', () => {
  test('accepts a fully-valid payload', () => {
    const r = notificationPrefsSchema.safeParse(baseValid);
    expect(r.success).toBe(true);
  });

  test('rejects topic shorter than 4 chars', () => {
    const r = notificationPrefsSchema.safeParse({
      ...baseValid,
      ntfy_topic: 'abc',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.ntfy_topic).toBeDefined();
    }
  });

  test('rejects topic containing a slash', () => {
    const r = notificationPrefsSchema.safeParse({
      ...baseValid,
      ntfy_topic: 'alice/home',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.ntfy_topic).toBeDefined();
    }
  });

  test('rejects topic longer than 64 chars', () => {
    const long = 'a'.repeat(65);
    const r = notificationPrefsSchema.safeParse({
      ...baseValid,
      ntfy_topic: long,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.ntfy_topic).toBeDefined();
    }
  });

  test('accepts empty topic (means not configured)', () => {
    const r = notificationPrefsSchema.safeParse({
      ...baseValid,
      ntfy_topic: '',
    });
    expect(r.success).toBe(true);
  });

  test('rejects weekly_summary_day outside enum', () => {
    const r = notificationPrefsSchema.safeParse({
      ...baseValid,
      // @ts-expect-error — intentional invalid enum member for test
      weekly_summary_day: 'tuesday',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.weekly_summary_day).toBeDefined();
    }
  });

  test('rejects missing boolean field', () => {
    const { notify_overdue: _drop, ...rest } = baseValid;
    void _drop;
    const r = notificationPrefsSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });

  test('rejects topic with percent-encoded char', () => {
    const r = notificationPrefsSchema.safeParse({
      ...baseValid,
      ntfy_topic: 'alice%20home',
    });
    expect(r.success).toBe(false);
  });
});
