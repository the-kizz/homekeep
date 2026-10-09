import { describe, test, expect } from 'vitest';
import { completionSchema } from '@/lib/schemas/completion';

/**
 * 03-01 Task 1 (RED→GREEN): completionSchema zod validation (D-01, Pitfall 13).
 *
 * Six cases per plan <behavior>:
 *  - Valid input with via='tap' passes.
 *  - via defaults to 'tap' when omitted.
 *  - via='manual-date' accepted.
 *  - via='invalid' rejected.
 *  - task_id empty string rejected.
 *  - notes >2000 chars rejected.
 *  - completed_at must be a non-empty string (ISO 8601).
 */

const base = {
  task_id: 'task-123',
  completed_by_id: 'user-abc',
  completed_at: '2026-04-20T12:00:00.000Z',
  notes: '',
  via: 'tap' as const,
};

describe('completionSchema', () => {
  test('accepts valid input with via=tap', () => {
    const r = completionSchema.safeParse(base);
    expect(r.success).toBe(true);
  });

  test('via defaults to tap when omitted', () => {
    const { task_id, completed_by_id, completed_at, notes } = base;
    const r = completionSchema.safeParse({
      task_id,
      completed_by_id,
      completed_at,
      notes,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.via).toBe('tap');
    }
  });

  test('accepts via=manual-date', () => {
    const r = completionSchema.safeParse({ ...base, via: 'manual-date' });
    expect(r.success).toBe(true);
  });

  test('rejects via=invalid', () => {
    const r = completionSchema.safeParse({
      ...base,
      via: 'invalid' as unknown as 'tap',
    });
    expect(r.success).toBe(false);
  });

  test('rejects empty task_id', () => {
    const r = completionSchema.safeParse({ ...base, task_id: '' });
    expect(r.success).toBe(false);
  });

  test('rejects notes over 2000 chars', () => {
    const r = completionSchema.safeParse({
      ...base,
      notes: 'x'.repeat(2001),
    });
    expect(r.success).toBe(false);
  });

  test('accepts notes at exactly 2000 chars', () => {
    const r = completionSchema.safeParse({
      ...base,
      notes: 'x'.repeat(2000),
    });
    expect(r.success).toBe(true);
  });

  test('rejects empty completed_at', () => {
    const r = completionSchema.safeParse({ ...base, completed_at: '' });
    expect(r.success).toBe(false);
  });

  test('rejects empty completed_by_id', () => {
    const r = completionSchema.safeParse({ ...base, completed_by_id: '' });
    expect(r.success).toBe(false);
  });
});
