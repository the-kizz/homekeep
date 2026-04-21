import { describe, test, expect } from 'vitest';
import {
  buildOverdueRefCycle,
  buildAssignedRefCycle,
  buildWeeklyRefCycle,
  buildPartnerRefCycle,
} from '@/lib/notifications';

/**
 * 06-01 Task 2 RED→GREEN: ref_cycle builders (D-05).
 *
 * These are deterministic string formatters — the only security-relevant
 * property is that they produce the SAME key for the SAME logical event
 * so the unique (user_id, ref_cycle) index dedupes correctly. The async
 * data-access fns (hasNotified, recordNotification) are exercised end-to-end
 * by tests/unit/hooks-notifications-idempotency.test.ts (Task 1) and Wave 2.
 */

describe('ref_cycle builders', () => {
  test('buildOverdueRefCycle formats as task:{id}:overdue:{iso}', () => {
    expect(
      buildOverdueRefCycle('task-abc', '2026-04-20T00:00:00.000Z'),
    ).toBe('task:task-abc:overdue:2026-04-20T00:00:00.000Z');
  });

  test('buildAssignedRefCycle formats as task:{id}:assigned:{iso}', () => {
    expect(
      buildAssignedRefCycle('task-xyz', '2026-04-22T12:00:00.000Z'),
    ).toBe('task:task-xyz:assigned:2026-04-22T12:00:00.000Z');
  });

  test('buildWeeklyRefCycle formats as user:{id}:weekly:{weekStartIso}', () => {
    expect(
      buildWeeklyRefCycle('user-alice', '2026-04-19T00:00:00.000Z'),
    ).toBe('user:user-alice:weekly:2026-04-19T00:00:00.000Z');
  });

  test('buildPartnerRefCycle formats as completion:{id}:partner', () => {
    expect(buildPartnerRefCycle('comp-123')).toBe(
      'completion:comp-123:partner',
    );
  });
});
