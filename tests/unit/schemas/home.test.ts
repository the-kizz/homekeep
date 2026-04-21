import { describe, test, expect } from 'vitest';
import { homeSchema } from '@/lib/schemas/home';

/**
 * 02-04 Task 1 RED → GREEN: homeSchema validation (D-09).
 *
 * Cross-referenced with RESEARCH §Security Domain (T-02-04-01 — name length caps
 * help neutralise SQL/filter injection surface even though filters are only
 * parameterised via authStore-derived ids in this plan).
 */

describe('homeSchema', () => {
  test('accepts name + optional address', () => {
    expect(
      homeSchema.safeParse({ name: 'House', timezone: 'Australia/Perth' }).success,
    ).toBe(true);
    expect(
      homeSchema.safeParse({
        name: 'House',
        address: '1 St',
        timezone: 'Australia/Perth',
      }).success,
    ).toBe(true);
  });

  test('accepts empty-string address (optional)', () => {
    expect(
      homeSchema.safeParse({
        name: 'House',
        address: '',
        timezone: 'Australia/Perth',
      }).success,
    ).toBe(true);
  });

  test('rejects empty name', () => {
    const r = homeSchema.safeParse({ name: '', timezone: 'Australia/Perth' });
    expect(r.success).toBe(false);
  });

  test('rejects name over 100 chars', () => {
    const r = homeSchema.safeParse({
      name: 'a'.repeat(101),
      timezone: 'Australia/Perth',
    });
    expect(r.success).toBe(false);
  });

  test('rejects address over 200 chars', () => {
    const r = homeSchema.safeParse({
      name: 'n',
      address: 'a'.repeat(201),
      timezone: 'Australia/Perth',
    });
    expect(r.success).toBe(false);
  });

  test('rejects missing timezone', () => {
    const r = homeSchema.safeParse({ name: 'House' });
    expect(r.success).toBe(false);
  });

  test('rejects timezone shorter than 3 chars', () => {
    const r = homeSchema.safeParse({ name: 'House', timezone: 'UT' });
    expect(r.success).toBe(false);
  });
});
