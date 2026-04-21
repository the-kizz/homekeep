import { describe, test, expect } from 'vitest';
import { taskSchema } from '@/lib/schemas/task';

/**
 * 02-05 Task 2 RED → GREEN: taskSchema validation (D-12).
 *
 * The zod schema is the defensive boundary for createTask / updateTask:
 *   - Rejects anchored tasks missing an anchor_date (refine → fieldError
 *     path ['anchor_date'] so the UI can surface it correctly per Pitfall
 *     12).
 *   - Rejects non-positive-integer frequencies (defence in depth alongside
 *     computeNextDue's own throw).
 *   - Caps name / notes lengths to sane bounds.
 *   - Rejects unknown schedule_mode enum values.
 */

const base = {
  home_id: 'h1',
  area_id: 'a1',
  name: 'Wipe benches',
  frequency_days: 7,
  schedule_mode: 'cycle' as const,
  anchor_date: null,
  notes: '',
};

describe('taskSchema', () => {
  test('accepts valid cycle task', () => {
    expect(taskSchema.safeParse(base).success).toBe(true);
  });

  test('accepts valid anchored task with anchor_date', () => {
    const r = taskSchema.safeParse({
      ...base,
      schedule_mode: 'anchored',
      anchor_date: '2026-04-01',
    });
    expect(r.success).toBe(true);
  });

  test('rejects anchored task missing anchor_date', () => {
    const r = taskSchema.safeParse({
      ...base,
      schedule_mode: 'anchored',
      anchor_date: null,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const errors = r.error.flatten().fieldErrors;
      expect(errors.anchor_date?.[0]).toMatch(/anchor/i);
    }
  });

  test('rejects empty name', () => {
    expect(taskSchema.safeParse({ ...base, name: '' }).success).toBe(false);
  });

  test('rejects name over 120 chars', () => {
    expect(taskSchema.safeParse({ ...base, name: 'x'.repeat(121) }).success).toBe(
      false,
    );
  });

  test('rejects frequency_days < 1', () => {
    expect(taskSchema.safeParse({ ...base, frequency_days: 0 }).success).toBe(
      false,
    );
  });

  test('rejects non-integer frequency_days', () => {
    expect(taskSchema.safeParse({ ...base, frequency_days: 1.5 }).success).toBe(
      false,
    );
  });

  test('rejects unknown schedule_mode', () => {
    expect(
      taskSchema.safeParse({
        ...base,
        schedule_mode: 'weekly' as unknown as 'cycle',
      }).success,
    ).toBe(false);
  });

  test('accepts optional notes up to 2000 chars; rejects 2001', () => {
    expect(
      taskSchema.safeParse({ ...base, notes: 'x'.repeat(2000) }).success,
    ).toBe(true);
    expect(
      taskSchema.safeParse({ ...base, notes: 'x'.repeat(2001) }).success,
    ).toBe(false);
  });
});
